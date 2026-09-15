-- Proposal payloads are server-authored. Users may only confirm/reject their own.
revoke insert,update,delete on public.ai_actions from authenticated;
grant update(status,confirmed_at) on public.ai_actions to authenticated;
revoke insert,update,delete on public.voice_transcriptions from authenticated;
create or replace function private.ai_confirmation_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in('authenticated','anon') then
 if auth.uid() is null or auth.uid()<>old.user_id or not private.is_pro(old.business_id) or old.status<>'proposed' or new.status not in('confirmed','rejected') then raise exception 'Only your own pending Pro proposals can be confirmed or rejected' using errcode='42501';end if;
 if old.parsed_payload->>'clarification_question' is not null and new.status='confirmed' then raise exception 'Clarify this command before confirming';end if;
 end if;return new;
end $$;
create trigger ai_confirmation_guard before update on public.ai_actions for each row execute function private.ai_confirmation_guard();
create or replace function private.execute_confirmed_action(target_action_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.ai_actions%rowtype;f jsonb;r jsonb;customer uuid;matches integer;requested text;obj uuid;job uuid;doc jsonb;item jsonb;k integer:=0;kind text;start_at timestamptz;end_at timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in to continue' using errcode='42501';end if;
 select * into a from public.ai_actions where id=target_action_id and user_id=auth.uid() for update;
 if not found or not private.can_write_business(a.business_id) or not private.is_pro(a.business_id) then raise exception 'This action requires Pro and access to the business' using errcode='42501';end if;
 if a.status='executed' then return jsonb_build_object('action_id',a.id,'status','executed','result',a.parsed_payload->'execution_result','already_executed',true);end if;
 if a.parsed_payload->>'clarification_question' is not null then raise exception 'Clarify the command before executing';end if;
 if a.intent in('list_unpaid_invoices','customer_history','business_summary') then
 if a.status not in('proposed','confirmed') then raise exception 'Action is not ready';end if;
 elsif a.status<>'confirmed' then raise exception 'Review and confirm this action first';end if;
 f:=a.parsed_payload->'fields';
 if a.intent in('create_job','create_invoice','create_estimate','schedule_job','create_change_order','customer_history') then
 requested:=lower(regexp_replace(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'\s+',' ','g'));
 if requested='' then raise exception 'Specify the customer name';end if;
 select count(*),min(id::text)::uuid into matches,customer from public.customers where business_id=a.business_id and not archived and (lower(regexp_replace(btrim(concat_ws(' ',first_name,last_name)),'\s+',' ','g'))=requested or lower(regexp_replace(btrim(coalesce(company,'')),'\s+',' ','g'))=requested);
 if matches<>1 then raise exception 'Found % matching customers. Use the manual form to select the correct customer.',matches;end if;
 end if;
 case a.intent
 when 'create_customer' then
  if nullif(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'') is null then raise exception 'Customer name required';end if;
  insert into public.customers(business_id,first_name,last_name,company,email,phone,notes) values(a.business_id,nullif(split_part(coalesce(f->>'customer_name',''),' ',1),''),nullif(regexp_replace(coalesce(f->>'customer_name',''),'^[^ ]+\s*',''),''),f->>'company_name',f->>'email',f->>'phone',f->>'notes') returning id into obj;
  select jsonb_build_object('customer',to_jsonb(c)) into r from public.customers c where id=obj;
 when 'create_invoice','create_estimate' then
  kind:=case when a.intent='create_invoice' then 'invoice' else 'estimate' end;
  doc:=public.create_document(a.business_id,kind,a.id,jsonb_build_object('customer_id',customer,'items',f->'line_items','due_date',case when kind='invoice' then f->>'due_date_text' else null end,'notes',f->>'notes'));
  r:=jsonb_build_object(kind,doc);
 when 'record_payment' then
  select count(*),min(id::text)::uuid into matches,obj from public.invoices where business_id=a.business_id and invoice_number=f->>'invoice_number';
  if matches<>1 then raise exception 'Specify the exact invoice number';end if;
  doc:=public.record_manual_payment(a.business_id,obj,a.id,(f->>'payment_amount')::numeric,coalesce(f->>'payment_method','other'),coalesce(f->>'notes','Manually verified payment, entered with AI assistance'));
  r:=jsonb_build_object('payment',doc);
 when 'create_job','schedule_job' then
  if nullif(btrim(coalesce(f->>'job_title',f->>'job_description','')),'') is null then raise exception 'Job title required';end if;
  if a.intent='schedule_job' then
   start_at:=(f->>'scheduled_at_text')::timestamptz;end_at:=(f->>'scheduled_end_text')::timestamptz;
   if start_at is null or start_at<now() or(end_at is not null and end_at<start_at) then raise exception 'Use a future start time and a valid end time';end if;
  end if;
  insert into public.jobs(business_id,customer_id,title,description,status,scheduled_start,scheduled_end) values(a.business_id,customer,coalesce(f->>'job_title',f->>'job_description'),f->>'job_description',case when a.intent='schedule_job' then 'scheduled' else 'lead' end,start_at,end_at) returning id into job;
  if a.intent='schedule_job' then insert into public.appointments(business_id,customer_id,job_id,title,starts_at,ends_at,status) values(a.business_id,customer,job,coalesce(f->>'job_title',f->>'job_description'),start_at,end_at,'scheduled');end if;
  select jsonb_build_object('job',to_jsonb(j)) into r from public.jobs j where id=job;
 when 'create_change_order' then
  select count(*),min(id::text)::uuid into matches,job from public.jobs where business_id=a.business_id and customer_id=customer and status not in('canceled','completed') and (nullif(f->>'job_title','') is null or lower(btrim(title))=lower(btrim(f->>'job_title')));
  if matches<>1 then raise exception 'Specify exactly one active job for this customer';end if;
  if jsonb_typeof(f->'line_items') is distinct from 'array' or jsonb_array_length(f->'line_items') not between 1 and 50 then raise exception 'Add 1 to 50 change-order line items';end if;
  insert into public.change_orders(business_id,customer_id,job_id,title,description,reason,schedule_impact_days,schedule_note,status) values(a.business_id,customer,job,coalesce(f->>'change_order_title',f->>'job_description','Change order'),f->>'job_description',f->>'notes',coalesce((f->>'schedule_impact_days')::integer,0),f->>'schedule_note','draft') returning id into obj;
  for item in select value from jsonb_array_elements(f->'line_items') loop
  insert into public.change_order_items(business_id,change_order_id,description,quantity,unit_price,tax_rate,sort_order) values(a.business_id,obj,item->>'description',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,coalesce((item->>'tax_rate')::numeric,0),k);k:=k+1;end loop;
  select jsonb_build_object('change_order',to_jsonb(c)) into r from public.change_orders c where id=obj;
 when 'business_summary' then
  r:=public.get_dashboard_metrics(a.business_id);
  r:=r||jsonb_build_object('customers',r->'customer_count','active_jobs',(select count(*) from public.jobs where business_id=a.business_id and status not in('completed','canceled')));
 when 'list_unpaid_invoices' then
  r:=public.get_dashboard_metrics(a.business_id);
  r:=jsonb_build_object('count',r->'open_count','total_outstanding',r->'outstanding','invoices',coalesce((select jsonb_agg(to_jsonb(i)) from(select id,invoice_number,balance_due,due_date from public.invoices where business_id=a.business_id and status not in('draft','void') and balance_due>0 order by due_date nulls last limit 50)i),'[]'::jsonb),'list_limit',50);
 when 'customer_history' then
  r:=jsonb_build_object('customer_id',customer,'invoices',coalesce((select jsonb_agg(to_jsonb(i)) from(select id,invoice_number,status,total,balance_due from public.invoices where business_id=a.business_id and customer_id=customer order by created_at desc limit 20)i),'[]'::jsonb),'jobs',coalesce((select jsonb_agg(to_jsonb(j)) from(select id,title,status from public.jobs where business_id=a.business_id and customer_id=customer order by created_at desc limit 20)j),'[]'::jsonb));
 else raise exception 'This action is not supported';
 end case;
 update public.ai_actions set status='executed',executed_at=now(),parsed_payload=parsed_payload||jsonb_build_object('execution_result',r) where id=a.id;
 return jsonb_build_object('action_id',a.id,'status','executed','result',r);
end $$;
revoke all on function private.execute_confirmed_action(uuid),private.ai_confirmation_guard() from public,anon;
grant execute on function private.execute_confirmed_action(uuid) to authenticated;
create or replace function public.execute_confirmed_action(target_action_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.execute_confirmed_action(target_action_id)$$;
revoke all on function public.execute_confirmed_action(uuid) from public,anon;
grant execute on function public.execute_confirmed_action(uuid) to authenticated;
alter table public.messages add column if not exists email_payload_hash text;
-- Free plans cannot create hosted approval links via an API bypass.
create policy approval_pro_only on public.document_approval_links as restrictive for insert to authenticated with check(private.is_pro(business_id));
-- Remove unused DDL-style privileges; RLS does not protect TRUNCATE.
do $$declare t record;begin for t in select tablename from pg_tables where schemaname='public' loop execute format('revoke truncate, references, trigger on public.%I from anon, authenticated',t.tablename);end loop;end$$;
revoke all on public.ai_actions,public.voice_transcriptions from anon;

create or replace function private.commerce_business_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and auth.uid() is not null then
 perform pg_advisory_xact_lock(hashtextextended('business-owner-'||auth.uid()::text,0));
 if exists(select 1 from public.businesses where created_by_user_id=auth.uid()) then raise exception 'One workspace per account is supported in this version';end if;
 new.created_by_user_id:=auth.uid();
 elsif tg_op='UPDATE' and new.created_by_user_id is distinct from old.created_by_user_id then raise exception 'Workspace creator cannot be changed';end if;
 if length(btrim(new.name)) not between 1 and 120 then raise exception 'Business name must be 1 to 120 characters';end if;
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Invalid business timezone';end if;
 return new;
end$$;
create trigger commerce_business_guard before insert or update on public.businesses for each row execute function private.commerce_business_guard();
revoke all on function private.commerce_business_guard() from public,anon,authenticated;

-- Bound non-document storage too, so free plans cannot use ancillary tables as
-- unlimited storage. Historical data is retained; new inserts stop at the cap.
create or replace function private.commerce_auxiliary_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare n bigint;lim integer;b uuid;
begin
 b:=new.business_id;
 if pg_column_size(to_jsonb(new))>(case when private.is_pro(b) then 65536 else 16384 end) then raise exception 'Record is too large for this plan';end if;
 if tg_op='UPDATE' then if new.business_id<>old.business_id then raise exception 'Records cannot move between workspaces';end if;return new;end if;
 lim:=case when tg_table_name='business_members' then(case when private.is_pro(b) then 5 else 1 end) when private.is_pro(b) then 20000 else 1000 end;
 perform pg_advisory_xact_lock(hashtextextended('storage-'||b::text||tg_table_name,0));
 execute format('select count(*) from public.%I where business_id=$1',tg_table_name) into n using b;
 if n>=lim then raise exception 'Stored % limit reached (%)',tg_table_name,lim;end if;
 return new;
end$$;
do $$declare name text;begin foreach name in array array['properties','jobs','appointments','reminders','messages','business_members'] loop execute format('create trigger commerce_auxiliary_limit before insert or update on public.%I for each row execute function private.commerce_auxiliary_limit()',name);end loop;end$$;
revoke all on function private.commerce_auxiliary_limit() from public,anon,authenticated;
