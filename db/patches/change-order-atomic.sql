alter table public.change_orders add column request_id uuid;
alter table public.change_orders add column request_fingerprint text;
create unique index change_order_request_unique on public.change_orders(business_id,request_id) where request_id is not null;
create or replace function public.create_change_order_document(target_business_id uuid,request_id uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;cid uuid;x jsonb;k integer:=0;fp text;
begin
 if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 if request_id is null then raise exception 'Request ID is required';end if;
 fp:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));
 select to_jsonb(c) into r from public.change_orders c where business_id=target_business_id and c.request_id=create_change_order_document.request_id;
 if r is not null then if r->>'request_fingerprint'<>fp then raise exception 'This request saved different content. Open the saved change order first.';end if;return r;end if;
 if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 or length(btrim(coalesce(payload->>'title',''))) not between 1 and 200 or pg_column_size(payload)>65536 then raise exception 'Use a title and 1 to 50 line items within the size limit';end if;
 if abs(coalesce((payload->>'schedule_impact_days')::integer,0))>3650 then raise exception 'Schedule impact is outside the supported range';end if;
 insert into public.change_orders(business_id,customer_id,job_id,estimate_id,title,description,reason,schedule_impact_days,schedule_note,notes,customer_message,request_id,request_fingerprint,status) values(target_business_id,(payload->>'customer_id')::uuid,(payload->>'job_id')::uuid,nullif(payload->>'estimate_id','')::uuid,btrim(payload->>'title'),payload->>'description',payload->>'reason',coalesce((payload->>'schedule_impact_days')::integer,0),payload->>'schedule_note',payload->>'notes',payload->>'customer_message',request_id,fp,'draft') returning id into cid;
 for x in select value from jsonb_array_elements(payload->'items') loop insert into public.change_order_items(business_id,change_order_id,description,quantity,unit_price,tax_rate,sort_order) values(target_business_id,cid,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);k:=k+1;end loop;
 select to_jsonb(c) into r from public.change_orders c where id=cid;return r;
end$$;
revoke all on function public.create_change_order_document(uuid,uuid,jsonb) from public,anon;
grant execute on function public.create_change_order_document(uuid,uuid,jsonb) to authenticated;
create or replace function private.commerce_change_item_guard() returns trigger language plpgsql security definer set search_path='' as $$declare s text;cid uuid;begin
 cid:=case when tg_op='DELETE' then old.change_order_id else new.change_order_id end;select status into s from public.change_orders where id=cid for update;if s is not null and s<>'draft' then raise exception 'Only draft change-order lines can change';end if;
 if tg_op='DELETE' then return old;end if;
 if tg_op='UPDATE' and(new.change_order_id<>old.change_order_id or new.business_id<>old.business_id) then raise exception 'Line ownership cannot change';end if;
 if length(btrim(new.description)) not between 1 and 1000 or new.quantity<=0 or new.quantity>100000 or new.quantity<>round(new.quantity,2) or new.unit_price<0 or new.unit_price>10000000 or new.unit_price<>round(new.unit_price,2) or new.tax_rate<0 or new.tax_rate>100 or new.tax_rate<>round(new.tax_rate,2) then raise exception 'Invalid change-order line item';end if;
 if tg_op='INSERT' and(select count(*) from public.change_order_items where change_order_id=cid)>=50 then raise exception 'Maximum 50 lines';end if;return new;
end$$;
create trigger commerce_change_item_guard before insert or update or delete on public.change_order_items for each row execute function private.commerce_change_item_guard();
revoke all on function private.commerce_change_item_guard() from public,anon,authenticated;
