alter table public.invoices add column request_fingerprint text;
alter table public.estimates add column request_fingerprint text;
create or replace function public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare new_id uuid; result jsonb; x jsonb; k integer:=0; customer uuid; dt date; fingerprint text;
begin
 if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 if document_kind not in('invoice','estimate') or request_id is null then raise exception 'Invalid document request';end if;
 fingerprint:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));
 if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where business_id=target_business_id and i.request_id=create_document.request_id;
 else select to_jsonb(e) into result from public.estimates e where business_id=target_business_id and e.request_id=create_document.request_id;end if;
 if result is not null then if result->>'request_fingerprint' is distinct from fingerprint then raise exception 'This request already saved different content. Open the saved document before starting another.' using errcode='23505';end if;return result;end if;
 if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items' using errcode='23514';end if;
 if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;
 customer:=(payload->>'customer_id')::uuid;
 dt:=nullif(coalesce(payload->>'due_date',payload->>'expires_on'),'')::date;
 if dt is not null and dt<(now() at time zone (select timezone from public.businesses where id=target_business_id))::date then raise exception 'Choose today or a future due/expiration date';end if;
 if document_kind='invoice' then
 insert into public.invoices(business_id,customer_id,due_date,notes,customer_message,request_id,request_fingerprint,payment_links,payment_instructions)
 values(target_business_id,customer,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint,coalesce((select payment_links from public.business_settings where business_id=target_business_id),'[]'::jsonb),coalesce((select payment_instructions from public.business_settings where business_id=target_business_id),'')) returning id into new_id;
 else
 insert into public.estimates(business_id,customer_id,expires_on,notes,customer_message,request_id,request_fingerprint) values(target_business_id,customer,dt,payload->>'notes',payload->>'customer_message',request_id,fingerprint) returning id into new_id;
 end if;
 for x in select value from jsonb_array_elements(payload->'items') loop
 if document_kind='invoice' then insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);
 else insert into public.estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);end if;k:=k+1;
 end loop;
 if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where id=new_id;else select to_jsonb(e) into result from public.estimates e where id=new_id;end if;
 return result;
end $$;

create or replace function private.commerce_identity_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.request_id is distinct from old.request_id or new.request_fingerprint is distinct from old.request_fingerprint or coalesce(to_jsonb(new)->>'invoice_number',to_jsonb(new)->>'estimate_number') is distinct from coalesce(to_jsonb(old)->>'invoice_number',to_jsonb(old)->>'estimate_number') then raise exception 'Document identity and request history cannot change';end if;
 if tg_table_name='invoices' then
  if new.estimate_id is distinct from old.estimate_id then raise exception 'Invoice conversion history cannot change';end if;
  if old.status<>'draft' and(new.payment_links<>old.payment_links or new.payment_instructions<>old.payment_instructions or new.due_date is distinct from old.due_date) then raise exception 'Issued payment instructions and due dates are locked. Create a revised document instead.';end if;
 else
  if new.status in('accepted','declined') and old.status<>new.status and new.expires_on<(now() at time zone(select timezone from public.businesses where id=new.business_id))::date then raise exception 'The estimate has expired. Duplicate it and issue a new estimate.';end if;
 end if;
 return new;
end$$;
create trigger commerce_identity_guard before update on public.invoices for each row execute function private.commerce_identity_guard();
create trigger commerce_identity_guard before update on public.estimates for each row execute function private.commerce_identity_guard();
revoke all on function private.commerce_identity_guard() from public,anon,authenticated;
-- This release is USD-only. Do not silently relabel historical dollar amounts.
alter table public.businesses add constraint commerce_currency_usd check(currency='USD');
-- One bounded user record; arbitrary profile blobs cannot bypass storage limits.
alter table public.customers add constraint commerce_customer_fields check(length(coalesce(first_name,''))<=200 and length(coalesce(last_name,''))<=200 and length(coalesce(company,''))<=200 and length(coalesce(email,''))<=320 and length(coalesce(phone,''))<=80 and length(coalesce(notes,''))<=4000);
