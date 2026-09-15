-- Do not ignore a customer name when an AI payment command supplies both name and invoice.
do $migration$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('private.execute_confirmed_action(uuid)'::regprocedure);
 needle:=$needle$where business_id=a.business_id and invoice_number=f->>'invoice_number'$needle$;
 replacement:=$replacement$where business_id=a.business_id and invoice_number=f->>'invoice_number' and(nullif(btrim(coalesce(f->>'customer_name',f->>'company_name','')),'') is null or customer_id in(select id from public.customers where business_id=a.business_id and(lower(btrim(concat_ws(' ',first_name,last_name)))=lower(btrim(coalesce(f->>'customer_name',f->>'company_name'))) or lower(btrim(company))=lower(btrim(coalesce(f->>'customer_name',f->>'company_name'))))))$replacement$;
 if strpos(definition,needle)=0 then raise exception 'Unexpected AI executor version; no change applied';end if;
 execute replace(definition,needle,replacement);
end$migration$;
