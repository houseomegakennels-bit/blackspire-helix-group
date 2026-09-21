-- Demo sessions may only use server-scoped demo APIs, never direct production tables.
-- Restrictive policies combine with existing policies; other roles retain their prior access.
do $$
declare t record;
begin
  for t in
    select n.nspname,c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
  loop
    execute format('create policy blackspire_deny_demo_direct_access on %I.%I as restrictive for all to authenticated using (coalesce((select auth.jwt()) -> ''app_metadata'' ->> ''blackspire_role'', '''') not in (''demo_viewer'', ''demo_operator'')) with check (coalesce((select auth.jwt()) -> ''app_metadata'' ->> ''blackspire_role'', '''') not in (''demo_viewer'', ''demo_operator''))',t.nspname,t.relname);
  end loop;
end $$;
create policy blackspire_deny_demo_storage_access on storage.objects
as restrictive for all to authenticated
using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'blackspire_role', '') not in ('demo_viewer','demo_operator'))
with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'blackspire_role', '') not in ('demo_viewer','demo_operator'));
