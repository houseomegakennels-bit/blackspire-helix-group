-- Independent candidate. Production application requires separate approval.
-- All referenced relations/types and auth.uid() are schema-qualified.
-- now(), arithmetic and GREATEST resolve through pg_catalog.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
declare f record;
begin
  for f in select * from (values
      ('current_admin_id', '42ad92c9ea40d2a69973cedf887c2cb5'),
      ('current_admin_role', 'a3540b18bb3751a19fb12c9ba8c8d517'),
      ('decrement_special_package_slots', '248460a6a556878a541188ef03c6317d'),
      ('set_updated_at', '523f04a6c0705442d52a0ffbe694d41b')
    ) as reviewed(name, definition_md5)
  loop
    if not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='ember_halo' and p.proname=f.name and p.pronargs=0
      and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=f.definition_md5
      and p.proconfig is null and p.proacl is null and pg_catalog.pg_get_userbyid(p.proowner)='postgres') then
      raise exception 'Audited function definition or attributes changed: ember_halo.%()', f.name;
    end if;
  end loop;
end $guard$;
alter function ember_halo.current_admin_id() set search_path to pg_catalog;
alter function ember_halo.current_admin_role() set search_path to pg_catalog;
alter function ember_halo.decrement_special_package_slots() set search_path to pg_catalog;
alter function ember_halo.set_updated_at() set search_path to pg_catalog;
commit;
