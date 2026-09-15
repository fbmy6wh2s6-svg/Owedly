create or replace function public.update_draft_document(target_business_id uuid,document_kind text,document_id uuid,expected_updated_at timestamptz,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d jsonb;t text;it text;fk text;x jsonb;k integer:=0;result jsonb;dt date;
begin
 if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 if document_kind not in('invoice','estimate') then raise exception 'Invalid document type';end if;
 t:=case when document_kind='invoice' then 'invoices' else 'estimates' end;it:=case when document_kind='invoice' then 'invoice_items' else 'estimate_items' end;fk:=document_kind||'_id';
 execute format('select to_jsonb(d) from public.%I d where id=$1 and business_id=$2 for update',t) into d using document_id,target_business_id;
 if d is null or d->>'status'<>'draft' then raise exception 'Only an available draft can be edited';end if;
 if expected_updated_at is null or(d->>'updated_at')::timestamptz<>expected_updated_at then raise exception 'This draft changed in another session. Reload it before saving.' using errcode='40001';end if;
 if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items';end if;
 if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;
 dt:=nullif(coalesce(payload->>'due_date',payload->>'expires_on'),'')::date;
 if dt is not null and dt<(now() at time zone(select timezone from public.businesses where id=target_business_id))::date then raise exception 'Use today or a future due date';end if;
 execute format('update public.%I set customer_id=$1,%I=$2,notes=$3,customer_message=$4 where id=$5 and business_id=$6',t,case when document_kind='invoice' then 'due_date' else 'expires_on' end) using(payload->>'customer_id')::uuid,dt,payload->>'notes',payload->>'customer_message',document_id,target_business_id;
 execute format('delete from public.%I where %I=$1 and business_id=$2',it,fk) using document_id,target_business_id;
 for x in select value from jsonb_array_elements(payload->'items') loop
 execute format('insert into public.%I(%I,business_id,description,quantity,unit_price,tax_rate,sort_order) values($1,$2,$3,$4,$5,$6,$7)',it,fk) using document_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k;k:=k+1;
 end loop;
 execute format('select to_jsonb(d) from public.%I d where id=$1',t) into result using document_id;
 return result;
end$$;
revoke all on function public.update_draft_document(uuid,text,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.update_draft_document(uuid,text,uuid,timestamptz,jsonb) to authenticated;

-- Preserve posted financial history. Record a full manual reversal explicitly,
-- never delete a payment or silently move it to another invoice.
create or replace function private.commerce_payment_guard() returns trigger language plpgsql set search_path='' as $$
declare s text;
begin
 if tg_op='DELETE' then raise exception 'Payment records cannot be deleted';end if;
 if tg_op='UPDATE' and(new.invoice_id<>old.invoice_id or new.business_id<>old.business_id or new.amount<>old.amount or new.paid_at<>old.paid_at) then raise exception 'Posted payment details are immutable';end if;
 select status into s from public.invoices where id=new.invoice_id and business_id=new.business_id for update;
 if s is null or s in('draft','void') then raise exception 'Payments require an issued non-void invoice';end if;
 if new.amount<>round(new.amount,2) or new.amount>1000000000 then raise exception 'Invalid payment amount';end if;
 if new.status='partially_refunded' then raise exception 'Partial refunds require a dedicated refund ledger and are not supported yet';end if;
 return new;
end$$;
create trigger commerce_payment_guard before insert or update or delete on public.payments for each row execute function private.commerce_payment_guard();
revoke all on function private.commerce_payment_guard() from public,anon,authenticated;
