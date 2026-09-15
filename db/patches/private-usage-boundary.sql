-- The public RPC remains available, but only a private helper reads protected usage.
alter function public.get_plan_usage(uuid) set schema private;
create function public.get_plan_usage(target_business_id uuid) returns jsonb
language sql stable security invoker set search_path=''
as $$select private.get_plan_usage(target_business_id)$$;
revoke all on function public.get_plan_usage(uuid) from public,anon;
grant execute on function public.get_plan_usage(uuid) to authenticated;
create policy entitlements_deny_client on private.business_entitlements for all to anon,authenticated using(false) with check(false);
create policy usage_deny_client on private.monthly_usage for all to anon,authenticated using(false) with check(false);
create policy requests_deny_client on private.feature_requests for all to anon,authenticated using(false) with check(false);
