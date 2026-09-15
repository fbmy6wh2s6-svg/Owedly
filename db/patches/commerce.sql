-- Owedly commerce foundation. Apply in a transaction; no account data is deleted.
create schema if not exists private;

create table if not exists private.business_entitlements (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 plan text not null default 'free' check(plan in ('free','pro')),
 valid_until timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists private.monthly_usage (
 business_id uuid not null references public.businesses(id) on delete cascade,
 month date not null,
 documents integer not null default 0, ai integer not null default 0,
 voice integer not null default 0, email integer not null default 0,
 primary key(business_id,month)
);
create table if not exists private.feature_requests (
 business_id uuid not null references public.businesses(id) on delete cascade,
 feature text not null, request_id uuid not null, created_at timestamptz not null default now(),
 primary key(business_id,feature,request_id)
);
alter table private.business_entitlements enable row level security;
alter table private.monthly_usage enable row level security;
alter table private.feature_requests enable row level security;
revoke all on private.business_entitlements, private.monthly_usage, private.feature_requests from public,anon,authenticated;

create or replace function private.is_pro(b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.business_entitlements where business_id=b and plan='pro' and (valid_until is null or valid_until>now()));
$$;
revoke all on function private.is_pro(uuid) from public,anon;
grant execute on function private.is_pro(uuid) to authenticated,service_role;

create or replace function public.get_plan_usage(target_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pro boolean; u private.monthly_usage%rowtype; stored bigint; people bigint;
begin
 if auth.uid() is null or not private.is_business_member(target_business_id) then raise exception 'Not authorized' using errcode='42501'; end if;
 pro:=private.is_pro(target_business_id);
 select * into u from private.monthly_usage where business_id=target_business_id and month=date_trunc('month',now() at time zone 'UTC')::date;
 select (select count(*) from public.invoices where business_id=target_business_id)+(select count(*) from public.estimates where business_id=target_business_id)+(select count(*) from public.change_orders where business_id=target_business_id) into stored;
 select count(*) into people from public.customers where business_id=target_business_id;
 return jsonb_build_object('plan',case when pro then 'pro' else 'free' end,'period_end',(date_trunc('month',now() at time zone 'UTC')+interval '1 month')::date,
 'documents_used',coalesce(u.documents,0),'documents_limit',case when pro then 1000 else 100 end,
 'stored_documents',stored,'stored_limit',case when pro then 20000 else 1000 end,
 'customers_used',people,'customers_limit',case when pro then 5000 else 250 end,
 'ai_used',coalesce(u.ai,0),'ai_limit',case when pro then 50 else 0 end,
 'voice_used',coalesce(u.voice,0),'voice_limit',case when pro then 50 else 0 end,
 'email_used',coalesce(u.email,0),'email_limit',case when pro then 250 else 0 end,
 'logo_bytes_limit',case when pro then 131072 else 0 end);
end $$;
revoke all on function public.get_plan_usage(uuid) from public,anon;
grant execute on function public.get_plan_usage(uuid) to authenticated;

-- Only a verified server may reserve chargeable usage. Requests are counted before
-- calling a provider, including unsuccessful attempts. Email retries reuse a key.
create or replace function public.reserve_feature(target_business_id uuid, target_user_id uuid, feature text, request_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',now() at time zone 'UTC')::date; used integer; lim integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server authorization required' using errcode='42501'; end if;
 if not exists(select 1 from public.business_members where business_id=target_business_id and user_id=target_user_id and role in('owner','admin','office','technician')) then raise exception 'Not authorized' using errcode='42501'; end if;
 if not private.is_pro(target_business_id) then raise exception 'Pro is required for this feature' using errcode='42501'; end if;
 if feature not in('ai','voice','email') or request_id is null then raise exception 'Invalid feature request' using errcode='22023'; end if;
 insert into private.monthly_usage(business_id,month) values(target_business_id,m) on conflict do nothing;
 perform 1 from private.monthly_usage where business_id=target_business_id and month=m for update;
 if exists(select 1 from private.feature_requests r where r.business_id=target_business_id and r.feature=reserve_feature.feature and r.request_id=reserve_feature.request_id) then
  if feature='email' then return false; end if;
  raise exception 'This AI request has already been used; refresh the result rather than repeating it' using errcode='23505';
 end if;
 select case feature when 'ai' then ai when 'voice' then voice else email end into used from private.monthly_usage where business_id=target_business_id and month=m;
 lim:=case when feature='email' then 250 else 50 end;
 if used>=lim then raise exception 'Monthly % limit reached (%). Resets next UTC calendar month.',feature,lim using errcode='P0001'; end if;
 insert into private.feature_requests(business_id,feature,request_id) values(target_business_id,feature,request_id);
 update private.monthly_usage set ai=ai+case when feature='ai' then 1 else 0 end,voice=voice+case when feature='voice' then 1 else 0 end,email=email+case when feature='email' then 1 else 0 end where business_id=target_business_id and month=m;
 return true;
end $$;
revoke all on function public.reserve_feature(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_feature(uuid,uuid,text,uuid) to service_role;

create or replace function private.valid_payment_links(links jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare x jsonb; u text; p text;
begin
 if jsonb_typeof(links)<>'array' or jsonb_array_length(links)>5 then return false; end if;
 for x in select value from jsonb_array_elements(links) loop
  if jsonb_typeof(x)<>'object' then return false; end if;
  u:=x->>'url'; p:=x->>'provider';
  if u is null or p is null or length(u)>1000 or u ~ '[[:space:]<>"\\]' or u ~* '%(0a|0d|09|00)' then return false; end if;
  if not (case p
   when 'stripe' then u ~ '^https://(buy\.stripe\.com|invoice\.stripe\.com|checkout\.stripe\.com)/[A-Za-z0-9/?&=_%.~+:#-]+$'
   when 'venmo' then u ~ '^https://(www\.|account\.)?venmo\.com/[A-Za-z0-9/?&=_%.~+:#-]+$'
   when 'paypal' then u ~ '^https://(paypal\.me|www\.paypal\.com|paypal\.com)/[A-Za-z0-9/?&=_%.~+:#-]+$'
   when 'square' then u ~ '^https://(square\.link|invoice\.squareup\.com)/[A-Za-z0-9/?&=_%.~+:#-]+$'
   when 'cashapp' then u ~ '^https://cash\.app/\$[A-Za-z0-9_-]+/?$'
   else false end) then return false; end if;
 end loop;
 return (select count(*)=count(distinct value->>'provider') from jsonb_array_elements(links));
end $$;
revoke all on function private.valid_payment_links(jsonb) from public,anon;
grant execute on function private.valid_payment_links(jsonb) to authenticated,service_role;

create table public.business_settings (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 payment_links jsonb not null default '[]'::jsonb check(private.valid_payment_links(payment_links)),
 payment_instructions text not null default '' check(length(payment_instructions)<=2000),
 updated_at timestamptz not null default now()
);
create table public.business_branding (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 logo_data_url text not null check(length(logo_data_url)<=174800 and logo_data_url ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'),
 updated_at timestamptz not null default now()
);
alter table public.business_settings enable row level security;
alter table public.business_branding enable row level security;
grant select,insert,update,delete on public.business_settings,public.business_branding to authenticated;
create policy settings_read on public.business_settings for select to authenticated using(private.is_business_member(business_id));
create policy settings_insert on public.business_settings for insert to authenticated with check(private.has_business_role(business_id,array['owner','admin']));
create policy settings_update on public.business_settings for update to authenticated using(private.has_business_role(business_id,array['owner','admin'])) with check(private.has_business_role(business_id,array['owner','admin']));
create policy settings_delete on public.business_settings for delete to authenticated using(private.has_business_role(business_id,array['owner','admin']));
create policy branding_read on public.business_branding for select to authenticated using(private.is_business_member(business_id) and private.is_pro(business_id));
create policy branding_insert on public.business_branding for insert to authenticated with check(private.has_business_role(business_id,array['owner','admin']) and private.is_pro(business_id));
create policy branding_update on public.business_branding for update to authenticated using(private.has_business_role(business_id,array['owner','admin']) and private.is_pro(business_id)) with check(private.has_business_role(business_id,array['owner','admin']) and private.is_pro(business_id));
create policy branding_delete on public.business_branding for delete to authenticated using(private.has_business_role(business_id,array['owner','admin']));

alter table public.invoices add column if not exists payment_links jsonb not null default '[]'::jsonb check(private.valid_payment_links(payment_links));
alter table public.invoices add column if not exists payment_instructions text not null default '' check(length(payment_instructions)<=2000);
alter table public.invoices add column if not exists request_id uuid;
alter table public.estimates add column if not exists request_id uuid;
alter table public.payments add column if not exists request_id uuid;
create unique index if not exists invoice_request_unique on public.invoices(business_id,request_id) where request_id is not null;
create unique index if not exists estimate_request_unique on public.estimates(business_id,request_id) where request_id is not null;
create unique index if not exists payment_request_unique on public.payments(business_id,request_id) where request_id is not null;
create unique index if not exists invoice_single_conversion on public.invoices(estimate_id) where estimate_id is not null;
alter table public.invoice_items add constraint invoice_item_tax_percent check(tax_rate<=100 and tax_rate<>'NaN'::numeric);
alter table public.estimate_items add constraint estimate_item_tax_percent check(tax_rate<=100 and tax_rate<>'NaN'::numeric);

-- Same trigger functions on Test and Production; percent convention is 7 = 7%.
create or replace function private.commerce_recalc() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent uuid; b uuid; st numeric(12,2); tx numeric(12,2); kind text;
begin
 if tg_op='DELETE' then parent:=coalesce(to_jsonb(old)->>'invoice_id',to_jsonb(old)->>'estimate_id')::uuid;b:=old.business_id;
 else parent:=coalesce(to_jsonb(new)->>'invoice_id',to_jsonb(new)->>'estimate_id')::uuid;b:=new.business_id; end if;
 kind:=case when tg_table_name='invoice_items' then 'invoices' else 'estimates' end;
 execute format('select coalesce(sum(line_total),0),coalesce(sum(round(line_total*tax_rate/100,2)),0) from public.%I where %I=$1 and business_id=$2',tg_table_name,case when kind='invoices' then 'invoice_id' else 'estimate_id' end) into st,tx using parent,b;
 execute format('update public.%I set subtotal=$1,tax_amount=$2,total=$1+$2 where id=$3 and business_id=$4',kind) using st,tx,parent,b;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
-- Replace every existing item recalculation trigger regardless of the earlier name.
do $$ declare t record; begin
 for t in select c.relname,g.tgname from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('invoice_items','estimate_items') and not g.tgisinternal loop
  execute format('drop trigger %I on public.%I',t.tgname,t.relname);
 end loop;
end $$;
create trigger commerce_items_recalc after insert or update or delete on public.invoice_items for each row execute function private.commerce_recalc();
create trigger commerce_items_recalc after insert or update or delete on public.estimate_items for each row execute function private.commerce_recalc();

create or replace function private.commerce_item_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare s text; par uuid; cnt integer;
begin
 if tg_op='DELETE' then par:=coalesce(to_jsonb(old)->>'invoice_id',to_jsonb(old)->>'estimate_id')::uuid;
 else par:=coalesce(to_jsonb(new)->>'invoice_id',to_jsonb(new)->>'estimate_id')::uuid;end if;
 execute format('select status from public.%I where id=$1 for update',case when tg_table_name='invoice_items' then 'invoices' else 'estimates' end) into s using par;
 if s is not null and s<>'draft' then raise exception 'Only draft line items can be changed. Duplicate the document to revise it.' using errcode='23514';end if;
 if tg_op='DELETE' then return old;end if;
 if tg_op='UPDATE' and (new.business_id<>old.business_id or par<>coalesce(to_jsonb(old)->>'invoice_id',to_jsonb(old)->>'estimate_id')::uuid) then raise exception 'Line items cannot move between documents' using errcode='23514';end if;
 if length(btrim(new.description)) not between 1 and 1000 or new.quantity<=0 or new.quantity>100000 or new.quantity<>round(new.quantity,2) or new.unit_price<0 or new.unit_price>10000000 or new.unit_price<>round(new.unit_price,2) or new.tax_rate<0 or new.tax_rate>100 or new.tax_rate<>round(new.tax_rate,2) then raise exception 'Invalid line item; use two decimal places and a tax percentage from 0 to 100' using errcode='23514';end if;
 if tg_op='INSERT' then
 execute format('select count(*) from public.%I where %I=$1',tg_table_name,case when tg_table_name='invoice_items' then 'invoice_id' else 'estimate_id' end) into cnt using par;
 if cnt>=50 then raise exception 'Maximum 50 lines per document' using errcode='23514';end if;
 end if;
 return new;
end $$;
create trigger commerce_item_guard before insert or update or delete on public.invoice_items for each row execute function private.commerce_item_guard();
create trigger commerce_item_guard before insert or update or delete on public.estimate_items for each row execute function private.commerce_item_guard();

create or replace function private.commerce_number() returns trigger language plpgsql security definer set search_path='' as $$
declare num bigint; prefix text;
begin
 if tg_table_name='invoices' then
 update public.businesses set next_invoice_number=next_invoice_number+1 where id=new.business_id returning next_invoice_number-1,invoice_prefix into num,prefix;
 new.invoice_number:=prefix||'-'||case when length(num::text)<4 then lpad(num::text,4,'0') else num::text end;
 else
 update public.businesses set next_estimate_number=next_estimate_number+1 where id=new.business_id returning next_estimate_number-1,estimate_prefix into num,prefix;
 new.estimate_number:=prefix||'-'||case when length(num::text)<4 then lpad(num::text,4,'0') else num::text end;
 end if;return new;
end $$;
do $$ declare t record; begin
 for t in select c.relname,g.tgname from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_proc p on p.oid=g.tgfoid where c.relnamespace='public'::regnamespace and c.relname in('invoices','estimates') and not g.tgisinternal and p.proname in('assign_document_number','assign_invoice_number','assign_estimate_number') loop execute format('drop trigger %I on public.%I',t.tgname,t.relname);end loop;
end $$;
create trigger commerce_number before insert on public.invoices for each row execute function private.commerce_number();
create trigger commerce_number before insert on public.estimates for each row execute function private.commerce_number();

create or replace function private.commerce_quota() returns trigger language plpgsql security definer set search_path='' as $$
declare pro boolean; m date:=date_trunc('month',now() at time zone 'UTC')::date; n bigint; total bigint; lim integer;
begin
 pro:=private.is_pro(new.business_id);
 insert into private.monthly_usage(business_id,month) values(new.business_id,m) on conflict do nothing;
 perform 1 from private.monthly_usage where business_id=new.business_id and month=m for update;
 if tg_table_name='customers' then
 select count(*) into n from public.customers where business_id=new.business_id;
 lim:=case when pro then 5000 else 250 end;
 if n>=lim then raise exception 'Customer storage limit reached (%)',lim using errcode='23514';end if;
 elsif tg_table_name in('invoices','estimates','change_orders') then
 select documents into n from private.monthly_usage where business_id=new.business_id and month=m;
 lim:=case when pro then 1000 else 100 end;
 if n>=lim then raise exception 'Monthly document limit reached (%). Existing documents remain available.',lim using errcode='23514';end if;
 select (select count(*) from public.invoices where business_id=new.business_id)+(select count(*) from public.estimates where business_id=new.business_id)+(select count(*) from public.change_orders where business_id=new.business_id) into total;
 if total>=(case when pro then 20000 else 1000 end) then raise exception 'Stored document limit reached. Export your records or upgrade.' using errcode='23514';end if;
 update private.monthly_usage set documents=documents+1 where business_id=new.business_id and month=m;
 end if;
 return new;
end $$;
create trigger commerce_quota before insert on public.invoices for each row execute function private.commerce_quota();
create trigger commerce_quota before insert on public.estimates for each row execute function private.commerce_quota();
create trigger commerce_quota before insert on public.change_orders for each row execute function private.commerce_quota();
create trigger commerce_quota before insert on public.customers for each row execute function private.commerce_quota();

-- A full document and its lines are committed together, or not at all.
create or replace function public.create_document(target_business_id uuid, document_kind text, request_id uuid, payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare new_id uuid; result jsonb; x jsonb; k integer:=0; customer uuid; dt date;
begin
 if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 if document_kind not in('invoice','estimate') or request_id is null then raise exception 'Invalid document request';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));
 if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where business_id=target_business_id and i.request_id=create_document.request_id;
 else select to_jsonb(e) into result from public.estimates e where business_id=target_business_id and e.request_id=create_document.request_id;end if;
 if result is not null then return result;end if;
 if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50 then raise exception 'Add 1 to 50 line items' using errcode='23514';end if;
 if length(coalesce(payload->>'notes',''))>4000 or length(coalesce(payload->>'customer_message',''))>4000 then raise exception 'Notes must be at most 4000 characters';end if;
 customer:=(payload->>'customer_id')::uuid;
 dt:=nullif(coalesce(payload->>'due_date',payload->>'expires_on'),'')::date;
 if dt is not null and dt<(now() at time zone (select timezone from public.businesses where id=target_business_id))::date then raise exception 'Choose today or a future due/expiration date';end if;
 if document_kind='invoice' then
 insert into public.invoices(business_id,customer_id,due_date,notes,customer_message,request_id,payment_links,payment_instructions)
 values(target_business_id,customer,dt,payload->>'notes',payload->>'customer_message',request_id,coalesce((select payment_links from public.business_settings where business_id=target_business_id),'[]'::jsonb),coalesce((select payment_instructions from public.business_settings where business_id=target_business_id),'')) returning id into new_id;
 else
 insert into public.estimates(business_id,customer_id,expires_on,notes,customer_message,request_id) values(target_business_id,customer,dt,payload->>'notes',payload->>'customer_message',request_id) returning id into new_id;
 end if;
 for x in select value from jsonb_array_elements(payload->'items') loop
 if document_kind='invoice' then insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);
 else insert into public.estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate,sort_order) values(new_id,target_business_id,btrim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric,coalesce((x->>'tax_rate')::numeric,0),k);end if;k:=k+1;
 end loop;
 if document_kind='invoice' then select to_jsonb(i) into result from public.invoices i where id=new_id;else select to_jsonb(e) into result from public.estimates e where id=new_id;end if;
 return result;
end $$;
revoke all on function public.create_document(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.create_document(uuid,text,uuid,jsonb) to authenticated;

create or replace function public.convert_estimate_to_invoice(target_estimate_id uuid,target_due_date date default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare e public.estimates%rowtype; i uuid;
begin
 select * into e from public.estimates where id=target_estimate_id for update;
 if not found or not private.can_write_business(e.business_id) then raise exception 'Estimate unavailable' using errcode='42501';end if;
 select id into i from public.invoices where estimate_id=e.id;
 if i is not null then return i;end if;
 if e.status<>'accepted' then raise exception 'Accept the estimate before converting it' using errcode='23514';end if;
 if target_due_date is not null and target_due_date<(now() at time zone (select timezone from public.businesses where id=e.business_id))::date then raise exception 'Invoice due date cannot be in the past';end if;
 if not exists(select 1 from public.estimate_items where estimate_id=e.id and business_id=e.business_id) then raise exception 'Estimate has no line items';end if;
 insert into public.invoices(business_id,customer_id,job_id,estimate_id,due_date,notes,customer_message,payment_links,payment_instructions) values(e.business_id,e.customer_id,e.job_id,e.id,target_due_date,e.notes,e.customer_message,coalesce((select payment_links from public.business_settings where business_id=e.business_id),'[]'::jsonb),coalesce((select payment_instructions from public.business_settings where business_id=e.business_id),'')) returning id into i;
 insert into public.invoice_items(invoice_id,business_id,description,quantity,unit_price,tax_rate,sort_order) select i,business_id,description,quantity,unit_price,tax_rate,sort_order from public.estimate_items where estimate_id=e.id and business_id=e.business_id order by sort_order;
 update public.estimates set status='converted' where id=e.id;
 return i;
end $$;
revoke all on function public.convert_estimate_to_invoice(uuid,date) from public,anon;
grant execute on function public.convert_estimate_to_invoice(uuid,date) to authenticated;

create or replace function public.record_manual_payment(target_business_id uuid,invoice_id uuid,request_id uuid,payment_amount numeric,payment_method text,payment_note text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype; old_payment public.payments%rowtype; r jsonb;
begin
 if auth.uid() is null or not private.can_write_business(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 if request_id is null or payment_amount<=0 or payment_amount>1000000000 or payment_amount<>round(payment_amount,2) or payment_method not in('cash','check','card','ach','other') or length(coalesce(payment_note,''))>2000 then raise exception 'Invalid payment; use a positive amount with two decimal places';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_business_id::text||request_id::text,0));
 select * into old_payment from public.payments p where business_id=target_business_id and p.request_id=record_manual_payment.request_id;
 if found then
 if old_payment.invoice_id<>invoice_id or old_payment.amount<>payment_amount or old_payment.method<>payment_method then raise exception 'This retry does not match the original payment';end if;
 return to_jsonb(old_payment);
 end if;
 select * into inv from public.invoices i where i.id=record_manual_payment.invoice_id and business_id=target_business_id for update;
 if not found then raise exception 'Invoice not found';end if;
 if inv.status in('draft','void') then raise exception 'Issue the invoice before recording a payment; void invoices cannot be paid';end if;
 if payment_amount>inv.balance_due then raise exception 'Payment exceeds the remaining balance';end if;
 insert into public.payments(business_id,invoice_id,request_id,amount,method,status,provider,notes) values(target_business_id,invoice_id,request_id,payment_amount,payment_method,'succeeded','manual',payment_note) returning to_jsonb(payments) into r;
 return r;
end $$;
revoke all on function public.record_manual_payment(uuid,uuid,uuid,numeric,text,text) from public,anon;
grant execute on function public.record_manual_payment(uuid,uuid,uuid,numeric,text,text) to authenticated;

create or replace function private.commerce_paid_recalc() returns trigger language plpgsql security definer set search_path='' as $$
declare i uuid; paid numeric(12,2);
begin
 i:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
 select coalesce(sum(amount) filter(where status='succeeded'),0) into paid from public.payments where invoice_id=i;
 update public.invoices set amount_paid=paid,status=case when status='void' then 'void' when total>0 and paid>=total then 'paid' when paid>0 then 'partial' when sent_at is null then 'draft' else 'sent' end,paid_at=case when total>0 and paid>=total then coalesce(paid_at,now()) else null end where id=i;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
do $$ declare t record;begin for t in select g.tgname from pg_trigger g join pg_proc p on p.oid=g.tgfoid where g.tgrelid='public.payments'::regclass and not g.tgisinternal and p.proname in('payments_recalc_trigger','recalc_invoice_payments') loop execute format('drop trigger %I on public.payments',t.tgname);end loop;end $$;
create trigger commerce_paid_recalc after insert or update or delete on public.payments for each row execute function private.commerce_paid_recalc();

-- Issued documents cannot silently change financial history. Calculated totals
-- may change only inside the item/payment triggers, never a direct client update.
create or replace function private.commerce_document_guard() returns trigger language plpgsql set search_path='' as $$
declare has_items boolean;
begin
 if tg_op='INSERT' then
 if new.status<>'draft' or new.subtotal<>0 or new.tax_amount<>0 or new.total<>0 then raise exception 'New documents must start as empty drafts';end if;
 if tg_table_name='invoices' and (to_jsonb(new)->>'amount_paid')::numeric<>0 then raise exception 'Payments must be recorded separately';end if;
 return new;end if;
 if tg_op='DELETE' then if old.status<>'draft' then raise exception 'Issued documents cannot be deleted; void the invoice instead';end if;return old;end if;
 if new.business_id<>old.business_id or new.created_at<>old.created_at or new.issue_date<>old.issue_date then raise exception 'Document ownership and creation date cannot change';end if;
 if pg_trigger_depth()=1 and (new.subtotal<>old.subtotal or new.tax_amount<>old.tax_amount or new.total<>old.total or (tg_table_name='invoices' and (to_jsonb(new)->>'amount_paid') is distinct from (to_jsonb(old)->>'amount_paid'))) then raise exception 'Totals are calculated from line items and verified payment records';end if;
 if old.status<>'draft' and (new.customer_id<>old.customer_id or new.customer_message is distinct from old.customer_message) then raise exception 'Issued customer-facing details cannot be changed';end if;
 if new.status<>old.status then
 if tg_table_name='invoices' then
  if old.status='void' then raise exception 'A void invoice cannot be reopened';end if;
  if new.status='void' and new.amount_paid>0 then raise exception 'An invoice with recorded payments cannot be voided';end if;
  if pg_trigger_depth()=1 and new.status in('paid','partial') then raise exception 'Record a payment instead of changing the payment status';end if;
  if old.status<>'draft' and new.status='draft' and pg_trigger_depth()=1 then raise exception 'An issued invoice cannot become a draft';end if;
  if new.status='sent' and old.status='draft' then new.sent_at:=now();end if;
 else
  if old.status='converted' then raise exception 'Converted estimates cannot change status';end if;
  if new.status='converted' and not exists(select 1 from public.invoices where estimate_id=new.id and business_id=new.business_id) then raise exception 'Use Create invoice to convert an estimate';end if;
  if old.status in('accepted','declined') and new.status<>'converted' then raise exception 'The estimate already has a decision; duplicate it to revise it';end if;
 end if;
 execute format('select exists(select 1 from public.%I where %I=$1)',case when tg_table_name='invoices' then 'invoice_items' else 'estimate_items' end,case when tg_table_name='invoices' then 'invoice_id' else 'estimate_id' end) into has_items using new.id;
 if new.status not in('draft','void','expired') and not has_items then raise exception 'Add line items before issuing a document';end if;
 end if;
 return new;
end $$;
create trigger commerce_document_guard before insert or update or delete on public.invoices for each row execute function private.commerce_document_guard();
create trigger commerce_document_guard before insert or update or delete on public.estimates for each row execute function private.commerce_document_guard();

create or replace function public.get_dashboard_metrics(target_business_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare today date; month_start timestamptz; zone text; r jsonb;
begin
 if auth.uid() is null or not private.is_business_member(target_business_id) then raise exception 'Not authorized' using errcode='42501';end if;
 select timezone into zone from public.businesses where id=target_business_id;
 today:=(now() at time zone zone)::date;month_start:=date_trunc('month',now() at time zone zone) at time zone zone;
 select jsonb_build_object('today',today,'timezone',zone,
 'outstanding',coalesce(sum(balance_due) filter(where status not in('draft','void') and balance_due>0),0),
 'open_count',count(*) filter(where status not in('draft','void') and balance_due>0),
 'overdue',coalesce(sum(balance_due) filter(where status not in('draft','void') and due_date<today and balance_due>0),0),
 'overdue_count',count(*) filter(where status not in('draft','void') and due_date<today and balance_due>0),
 'draft_count',count(*) filter(where status='draft'),
 'aging',jsonb_build_object('current',coalesce(sum(balance_due) filter(where status not in('draft','void') and (due_date is null or due_date>=today)),0),'days_1_30',coalesce(sum(balance_due) filter(where status not in('draft','void') and today-due_date between 1 and 30),0),'days_31_60',coalesce(sum(balance_due) filter(where status not in('draft','void') and today-due_date between 31 and 60),0),'days_61_90',coalesce(sum(balance_due) filter(where status not in('draft','void') and today-due_date between 61 and 90),0),'days_90_plus',coalesce(sum(balance_due) filter(where status not in('draft','void') and today-due_date>90),0))) into r from public.invoices where business_id=target_business_id;
 return r||jsonb_build_object('collected_month',coalesce((select sum(amount) from public.payments where business_id=target_business_id and status='succeeded' and paid_at>=month_start and paid_at<=now()),0),
 'customer_count',(select count(*) from public.customers where business_id=target_business_id and not archived),
 'awaiting_estimates',(select count(*) from public.estimates where business_id=target_business_id and status='sent' and (expires_on is null or expires_on>=today)),
 'accepted_estimates',(select count(*) from public.estimates where business_id=target_business_id and status='accepted'),
 'failed_emails',(select count(*) from public.messages where business_id=target_business_id and channel='email' and status='failed' and created_at>=month_start));
end $$;
revoke all on function public.get_dashboard_metrics(uuid) from public,anon;
grant execute on function public.get_dashboard_metrics(uuid) to authenticated;

-- Function security: private helpers are trigger-only except explicitly granted
-- predicates above. Never expose a browser-writable subscription flag.
revoke all on function private.commerce_recalc(),private.commerce_item_guard(),private.commerce_number(),private.commerce_quota(),private.commerce_paid_recalc(),private.commerce_document_guard() from public,anon,authenticated;
