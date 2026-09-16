-- Explicitly installed, separately reviewed writer schema. NOT a production
-- migration runner input. No login/password provisioning or public RPC surface.
begin;
set local search_path=pg_catalog;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$declare r text; bootstrap oid:=(select oid from pg_roles where rolname='postgres'); expected oid:=current_setting('blackspire.buyer_writer_creator_oid',true)::oid; created boolean; begin
 if bootstrap is null or bootstrap<>(select oid from pg_roles where rolname=current_user)
  or expected is null or bootstrap<>expected
  or bootstrap<>(select datdba from pg_database where datname=current_database()) then
  raise exception 'Trusted writer bootstrap relationship required';
 end if;
 foreach r in array array['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'] loop
  created:=false;
  if not exists(select from pg_roles where rolname=r) then
   -- PostgreSQL17 managed CREATEROLE automatically grants ADMIN to its
   -- creator. Only the trusted installer inherits/sets the NOLOGIN owner for
   -- ownership transfer; runtime/issuer never inherit or assume another role.
   perform set_config('createrole_self_grant',case when r='buyer_writer_owner' then 'set' else '' end,true);
   execute format('create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',r);
   created:=true;
  end if;
  if created and not exists(select from pg_auth_members where roleid=to_regrole(r) and member=bootstrap) then
   execute format('grant %I to postgres with admin true, inherit false, set %s granted by postgres',r,case when r='buyer_writer_owner' then 'true' else 'false' end);
  elsif created and r='buyer_writer_owner' and not exists(select from pg_auth_members where roleid=to_regrole(r) and member=bootstrap and set_option) then
   execute format('grant %I to postgres with admin false, inherit false, set true granted by postgres',r);
  end if;
  if exists(select from pg_roles where rolname=r and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit or (r='buyer_writer_owner' and rolcanlogin))) then
   raise exception 'Unsafe existing writer role';
  end if;
 end loop;
 if (select count(*) from pg_auth_members m join pg_roles p on p.oid=m.roleid where p.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')) not between 3 and 4
  or (select count(distinct p.rolname) from pg_auth_members m join pg_roles p on p.oid=m.roleid
   where p.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') and m.admin_option and not m.inherit_option
   and (p.rolname='buyer_writer_owner' or not m.set_option) and m.grantor=10
   and coalesce((select rolsuper from pg_roles where oid=10),false))<>3
  or not exists(select from pg_auth_members m join pg_roles p on p.oid=m.roleid join pg_roles u on u.oid=m.member
   where p.rolname='buyer_writer_owner' and u.rolname='postgres'
   and u.oid=(select datdba from pg_database where datname=current_database()) and not m.inherit_option and m.set_option)
  or exists(select from pg_auth_members m join pg_roles p on p.oid=m.roleid join pg_roles u on u.oid=m.member
   where (p.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') or u.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))
   and not (p.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') and u.rolname='postgres'
    and u.oid=(select datdba from pg_database where datname=current_database()) and not m.inherit_option
    and ((m.admin_option and not m.set_option and m.grantor=10 and coalesce((select rolsuper from pg_roles where oid=10),false))
     or (p.rolname='buyer_writer_owner' and m.set_option and pg_get_userbyid(m.grantor)='postgres')))) then
  raise exception 'Trusted writer bootstrap relationship required';
 end if;
end$$;
-- Reject namespace collisions and pre-existing privilege outside this component.
do $$declare ns oid; r text; expected oid:=current_setting('blackspire.buyer_writer_creator_oid',true)::oid; begin
 select oid into ns from pg_namespace where nspname='buyer_writer';
 perform set_config('buyer_writer.schema_was_absent',(ns is null)::text,true);
  if ns is not null then
  if obj_description(ns,'pg_namespace') is distinct from
      'blackspire-buyer-writer:v1:creator-oid='||expected::text
   or (select nspowner from pg_namespace where oid=ns)<>(select oid from pg_roles where rolname='buyer_writer_owner')
   or exists(select from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      where n.oid=ns and a.grantee not in(select oid from pg_roles where rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')))
   or exists(select from pg_proc where pronamespace=ns and oid::regprocedure::text not in(
     'buyer_writer.lock_public_scope()',
     'buyer_writer.lock_scope()',
     'buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone)','buyer_writer.issue(uuid,uuid,text,text,boolean)','buyer_writer.issue(uuid,uuid,text,text,jsonb)','buyer_writer.valid_context(jsonb)','buyer_writer.context(text,text,uuid,uuid,bigint)',
     'buyer_writer.criteria(jsonb)','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)',
     'buyer_writer.valid_sale(jsonb)','buyer_writer.eligible(jsonb,jsonb)','buyer_writer.commit_buyers(buyer_writer.dispatches)',
     'buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)'))
   or exists(select from pg_class where relnamespace=ns and relname not in(
     'dispatches','receipts','sales','sales_ordinal_seq','dispatches_pkey','dispatches_permit_digest_key',
     'dispatches_job_id_generation_key','receipts_pkey','sales_pkey'))
   or exists(select from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=ns and not t.tgisinternal)
   or exists(select from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.pronamespace=ns and a.grantee not in(select oid from pg_roles where rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))
       and not(p.oid::regprocedure::text='buyer_writer.lock_public_scope()' and a.grantee=expected)) then
   raise exception 'Unexpected existing writer namespace';
  end if;
  if exists(select from (values
    ('buyer_writer.lock_public_scope()','8653f179e4814e4c73f6c337017ec6d8faa237ec5fe149e5307aebbc31c6d911','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','creator'),
    ('buyer_writer.lock_scope()','d6b012ceae457702e804942d1bb04eeb9c922802de2751ebb56b065758627e39','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.criteria(jsonb)','578a1b4f9820b4380f3b8f2e18a4a9b85d5ad60f0ced1284a9641d1c907e5919','sql',false,array['search_path=pg_catalog'],'i','writer'),
    ('buyer_writer.valid_context(jsonb)','a95cf4477dccce9adca8c52d057cfac50552a4c5be08be00e97f107858d4a7a3','plpgsql',false,array['search_path=pg_catalog'],'i','writer'),
    ('buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','929b93c1d6b48c1ba5078af0881a2aabe515ac633c4bc40f3bfb017c03e7d78e','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.cancel(uuid,uuid,text)','8b67a388bad04646f19977170d209f76ef0d86ace9f351d4599c5ec92ccdd71f','plpgsql',true,array['search_path=pg_catalog'],'v','writer'),
    ('buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)','1c9edca5057194a129e23431ccf0c2d02f296a612e3dd4b9f54f9b1807c9adbe','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.valid_sale(jsonb)','e478ccb56ce5c121a895268c6f44caa7d3cf535306f8f22dd0db92e4fd98f4dd','plpgsql',false,array['search_path=pg_catalog'],'i','writer'),
    ('buyer_writer.eligible(jsonb,jsonb)','3c15ee24e7c2a31adbfe8d39c737ad9560ef09c97c2f6786b848190be245fc05','sql',false,array['search_path=pg_catalog'],'i','writer'),
    ('buyer_writer.commit_buyers(buyer_writer.dispatches)','503f8027fdb2992a466e8271467165a94b3b2b2ed96ff8507c59663cda6ae496','plpgsql',false,array['search_path=pg_catalog'],'v','writer'),
    ('buyer_writer.apply(text,text,jsonb)','784c971700b19f0e2262f67d1e6fc1991079237d2631466f5c823a0b2338fd3c','plpgsql',true,array['search_path=pg_catalog','TimeZone=UTC','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.context(text,text,uuid,uuid,bigint)','44afc911defb0d273553fd78ab06960506257863b4ed392827b98cf689914ff2','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)','3a5f587c8b6ff018ab6d5e91b339fc60b479d0250ea0a74c7d06935035e593de','plpgsql',true,array['search_path=pg_catalog'],'v','writer')
   ) expected(signature,digest,language,security_definer,config,volatility,owner_kind)
   left join pg_namespace pn on pn.nspname='buyer_writer'
   left join pg_proc p on p.pronamespace=pn.oid and p.oid::regprocedure::text=expected.signature
   left join pg_language l on l.oid=p.prolang
   where p.oid is null or p.proowner<>case when expected.owner_kind='creator' then current_setting('blackspire.buyer_writer_creator_oid')::oid else (select oid from pg_roles where rolname='buyer_writer_owner') end
    or p.prosecdef is distinct from expected.security_definer or l.lanname is distinct from expected.language
    or encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') is distinct from expected.digest
    or p.proconfig is distinct from expected.config or p.provolatile::text is distinct from expected.volatility
    or p.prokind<>'f' or p.proisstrict or p.proleakproof or p.proparallel<>'u') then
   raise exception 'Writer routine definition drift';
  end if;
 end if;
 -- Target relations are always private even if schema USAGE is independently
 -- revoked. Unrelated relation ACLs matter only when a writer can reach their
 -- schema; ordinary inaccessible PUBLIC database facilities are out of scope.
 if exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
     and c.relkind in('r','p') and a.grantee=0
     and a.privilege_type in('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
  or exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute x on x.attrelid=c.oid
    cross join lateral aclexplode(x.attacl) a
    where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
     and c.relkind in('r','p') and x.attnum>0 and not x.attisdropped and x.attacl is not null and a.grantee=0
     and a.privilege_type in('SELECT','INSERT','UPDATE','REFERENCES')) then
  raise exception 'Unexpected target PUBLIC privileges';
 end if;
 foreach r in array array['buyer_writer_runtime','buyer_writer_issuer'] loop
  if exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where c.relkind in('r','p','v','m','f') and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
       and has_schema_privilege(r,n.oid,'USAGE')
       and case when c.relkind in('r','p','v','m','f') then
        has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
         or has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') else false end)
    or exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='S' and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
       and has_schema_privilege(r,n.oid,'USAGE')
       and case when c.relkind='S' then has_sequence_privilege(r,c.oid,'SELECT,UPDATE,USAGE') else false end)
     or exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prorettype<>'event_trigger'::regtype
      and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_temp'
      and has_schema_privilege(r,n.oid,'USAGE') and has_function_privilege(r,p.oid,'EXECUTE')
      and not (n.nspname='buyer_writer' and
       ((r='buyer_writer_runtime' and p.oid::regprocedure::text in(
        'buyer_writer.lock_scope()','buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)','buyer_writer.context(text,text,uuid,uuid,bigint)'))
       or (r='buyer_writer_issuer' and p.oid::regprocedure::text in(
        'buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)')))))
     or exists(select from pg_namespace n where n.nspname !~ '^pg_temp' and has_schema_privilege(r,n.oid,'CREATE'))
     or has_database_privilege(r,current_database(),'CREATE') then raise exception 'Unexpected writer role privileges';end if;
 end loop;
 if exists(select from pg_database d cross join (values('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
    where d.datname<>current_database() and d.datallowconn and has_database_privilege(w.role_name,d.oid,'CONNECT')) then
  raise exception 'Unexpected writer cross-database CONNECT privilege';
 end if;
 if exists(select from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'))) then
  raise exception 'Unexpected Buyer Writer relation trigger';
 end if;
 if exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in('r','p','v','m','f') and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
     and has_schema_privilege('buyer_writer_owner',n.oid,'USAGE')
     and case when c.relkind in('r','p','v','m','f') then
      has_table_privilege('buyer_writer_owner',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') else false end
     and n.nspname<>'buyer_writer')
  or exists(select from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privilege(name)
    where a.attnum>0 and not a.attisdropped and c.relkind in('r','p','v','m','f')
     and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
     and has_schema_privilege('buyer_writer_owner',n.oid,'USAGE')
     and case when c.relkind in('r','p','v','m','f') then has_column_privilege('buyer_writer_owner',c.oid,a.attnum,privilege.name) else false end
     and not (n.nspname='buyer_writer' or (n.nspname='public' and case
      when c.relname='SearchJob' then (privilege.name='SELECT' and a.attname=any(array['id','user_id','state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only','status','updated_at'])) or (privilege.name='UPDATE' and a.attname=any(array['status','total_sales_analyzed','total_buyers_found','error_message','updated_at']))
      when c.relname in('RawSale','CleanSale') then privilege.name='INSERT' and a.attname=any(array['search_job_id','buyer_name','seller_name','property_address','mailing_address','county','state','sale_price','sale_date','property_type','parcel_id','deed_type','lender_name'])
      when c.relname='BuyerProfile' then (privilege.name='SELECT' and a.attname=any(array['id','buyer_name','mailing_address','county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at'])) or (privilege.name='INSERT' and a.attname=any(array['buyer_name','mailing_address','county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at'])) or (privilege.name='UPDATE' and a.attname=any(array['county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at']))
      when c.relname='BuyerReport' then privilege.name='INSERT' and a.attname=any(array['search_job_id','buyer_profile_id','buyer_name_snapshot','mailing_address_snapshot','score','purchase_count','total_spend','is_llc','is_cash_buyer'])
      else false end)))
  or exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='S' and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
     and has_schema_privilege('buyer_writer_owner',n.oid,'USAGE')
     and case when c.relkind='S' then has_sequence_privilege('buyer_writer_owner',c.oid,'SELECT,UPDATE,USAGE') else false end
     and n.nspname<>'buyer_writer')
  or exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prorettype<>'event_trigger'::regtype
    and n.nspname not in('pg_catalog','information_schema','buyer_writer') and n.nspname !~ '^pg_temp'
    and has_schema_privilege('buyer_writer_owner',n.oid,'USAGE') and has_function_privilege('buyer_writer_owner',p.oid,'EXECUTE'))
  or exists(select from pg_namespace n where n.nspname !~ '^pg_temp' and n.nspname<>'buyer_writer'
    and has_schema_privilege('buyer_writer_owner',n.oid,'CREATE'))
  or has_database_privilege('buyer_writer_owner',current_database(),'CREATE') then
  raise exception 'Unexpected writer role privileges';
 end if;
end$$;
create schema if not exists buyer_writer authorization buyer_writer_owner;
set local role buyer_writer_owner;
do $$declare expected oid:=current_setting('blackspire.buyer_writer_creator_oid',true)::oid; begin
 if current_setting('buyer_writer.schema_was_absent')::boolean then
  execute format('comment on schema buyer_writer is %L','blackspire-buyer-writer:v1:creator-oid='||expected::text);
 end if;
end$$;
revoke all on schema buyer_writer from public,anon,authenticated;
grant usage on schema buyer_writer to buyer_writer_runtime,buyer_writer_issuer;
reset role;
grant usage on schema public to buyer_writer_owner;

-- The creator owns the public tables and installs their exact owner grants and
-- policies. REFERENCES is needed only while the owner creates its private FK.
grant select(id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,updated_at)
 on public."SearchJob" to buyer_writer_owner;
grant update(status,total_sales_analyzed,total_buyers_found,error_message,updated_at) on public."SearchJob" to buyer_writer_owner;
grant references(id) on public."SearchJob" to buyer_writer_owner;
grant insert(search_job_id,buyer_name,seller_name,property_address,mailing_address,county,state,sale_price,sale_date,property_type,parcel_id,deed_type,lender_name)
 on public."RawSale",public."CleanSale" to buyer_writer_owner;
grant insert(buyer_name,mailing_address,county,state,is_llc,is_cash_buyer,purchase_count,total_spend,first_purchase_date,last_purchase_date,property_types,score,score_breakdown,parcel_ids,updated_at),
 update(county,state,is_llc,is_cash_buyer,purchase_count,total_spend,first_purchase_date,last_purchase_date,property_types,score,score_breakdown,parcel_ids,updated_at),
 select(id,buyer_name,mailing_address,county,state,is_llc,is_cash_buyer,purchase_count,total_spend,first_purchase_date,last_purchase_date,property_types,score,score_breakdown,parcel_ids,updated_at) on public."BuyerProfile" to buyer_writer_owner;
grant insert(search_job_id,buyer_profile_id,buyer_name_snapshot,mailing_address_snapshot,score,purchase_count,total_spend,is_llc,is_cash_buyer)
 on public."BuyerReport" to buyer_writer_owner;
do $$declare t text; begin
 foreach t in array array['SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport'] loop
  execute format('drop policy if exists buyer_writer_internal on public.%I',t);
  execute format('create policy buyer_writer_internal on public.%I to buyer_writer_owner using(true) with check(true)',t);
 end loop;
end$$;

-- All component-owned DDL, including idempotent re-entry, runs as the NOLOGIN
-- owner through the one pinned SET edge.
set local role buyer_writer_owner;

create table if not exists buyer_writer.dispatches (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public."SearchJob"(id),
 owner_id uuid not null,workspace text not null,permit_digest text not null unique check(permit_digest ~ '^[a-f0-9]{64}$'),
 generation bigint not null check(generation>0),criteria jsonb not null,no_cash_data boolean not null,
 state text not null check(state in ('pending','processing','completed','failed','cancelled')),
 expires_at timestamptz not null,issued_at timestamptz not null default clock_timestamp(),
 raw_chunks integer,raw_next integer not null default 0,clean_chunks integer,clean_next integer not null default 0,
 raw_count integer not null default 0,clean_count integer not null default 0,buyer_count integer not null default 0,
 bytes_received bigint not null default 0,buyers_committed boolean not null default false,
 unique(job_id,generation)
);
-- Historical rows are preserved, but context-free permits cannot write again.
alter table buyer_writer.dispatches add column if not exists source_context jsonb;
alter table buyer_writer.dispatches add column if not exists source_context_digest text;
drop function if exists buyer_writer.issue(uuid,uuid,text,text,boolean);
drop function if exists buyer_writer.issue(uuid,uuid,text,text,jsonb);
drop function if exists buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone);
create table if not exists buyer_writer.receipts (
 dispatch_id uuid not null references buyer_writer.dispatches(id),operation text not null,chunk_index integer not null,
 request_digest text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(dispatch_id,operation,chunk_index)
);
create table if not exists buyer_writer.sales (
 dispatch_id uuid not null references buyer_writer.dispatches(id),kind text not null check(kind in ('raw','clean')),
 row_digest text not null,data jsonb not null,ordinal bigint generated always as identity,
 primary key(dispatch_id,kind,row_digest)
);

create or replace function buyer_writer.criteria(j jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('state',j->'state','county',j->'county','property_type',j->'property_type',
 'date_range_start',j->'date_range_start','date_range_end',j->'date_range_end','min_purchases',j->'min_purchases',
 'cash_buyers_only',j->'cash_buyers_only','llc_buyers_only',j->'llc_buyers_only')
$$;

-- Context contains policy references and digests, never URLs, notes or secrets.
-- The authenticated issuer resolves their meaning from its reviewed registry.
create or replace function buyer_writer.valid_context(c jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare s jsonb; b jsonb; r jsonb;
begin
 if c is null or jsonb_typeof(c)<>'object' or octet_length(c::text)>32768
  or (select count(*) from jsonb_object_keys(c))<>5
  or not c ?& array['version','mode','sources','budgets','rawPayload']
  or c->'version' is distinct from '1'::jsonb
  or c->>'mode' not in('county_fetch','frontend_payload') or c->>'mode' is null
  or jsonb_typeof(c->'sources') is distinct from 'array' then return false;end if;
 if jsonb_array_length(c->'sources') not between 1 and 32 then return false;end if;
 for s in select value from jsonb_array_elements(c->'sources') loop
  if jsonb_typeof(s)<>'object' or (select count(*) from jsonb_object_keys(s))<>5
   or not s ?& array['sourceId','sourceType','endpointId','endpointConfigDigest','cashDisabled']
   or jsonb_typeof(s->'sourceId') is distinct from 'string'
   or s->>'sourceId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(s->'sourceType') is distinct from 'string' or s->>'sourceType' !~ '^[A-Za-z0-9_-]{1,128}$'
   or jsonb_typeof(s->'endpointId') is distinct from 'string' or s->>'endpointId' !~ '^[A-Za-z0-9_-]{1,128}$'
   or jsonb_typeof(s->'endpointConfigDigest') is distinct from 'string' or s->>'endpointConfigDigest' !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(s->'cashDisabled') is distinct from 'boolean' then return false;end if;
 end loop;
 if (select count(distinct value->>'sourceId') from jsonb_array_elements(c->'sources'))<>jsonb_array_length(c->'sources') then return false;end if;
 b:=c->'budgets';
 if jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>3
  or not b ?& array['maxRequests','maxRows','maxBytes'] then return false;end if;
 if jsonb_typeof(b->'maxRequests') is distinct from 'number' or b->>'maxRequests' !~ '^[1-9][0-9]{0,2}$'
  or (b->>'maxRequests')::numeric>500
  or jsonb_typeof(b->'maxRows') is distinct from 'number' or b->>'maxRows' !~ '^[1-9][0-9]{0,4}$'
  or (b->>'maxRows')::numeric>50000
  or jsonb_typeof(b->'maxBytes') is distinct from 'number' or b->>'maxBytes' !~ '^[1-9][0-9]{0,7}$'
  or (b->>'maxBytes')::numeric>67108864 then return false;end if;
 r:=c->'rawPayload';
 if c->>'mode'='county_fetch' then return r='null'::jsonb;end if;
 if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>3
  or not r ?& array['digest','rowCount','byteCount']
  or jsonb_typeof(r->'digest') is distinct from 'string' or r->>'digest' !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(r->'rowCount') is distinct from 'number' or r->>'rowCount' !~ '^(0|[1-9][0-9]{0,4})$'
  or jsonb_typeof(r->'byteCount') is distinct from 'number' or r->>'byteCount' !~ '^[1-9][0-9]{0,7}$' then return false;end if;
 return (r->>'rowCount')::numeric<=(b->>'maxRows')::numeric and (r->>'byteCount')::numeric<=(b->>'maxBytes')::numeric;
 exception when others then return false;
end$$;

-- Issuer is a separate trusted backend boundary: it must capture the real
-- authenticated operator and route entitlement before async dispatch. Runtime
-- cannot issue, renew or cancel permits, or nominate an owner/workspace.
create or replace function buyer_writer.issue(p_job uuid,p_owner uuid,p_workspace text,p_digest text,p_context jsonb,p_expected_criteria jsonb,p_expected_updated_at timestamptz,p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $$
declare j record; g bigint; d uuid; c jsonb;
begin
 if p_request is null or p_job is null or p_owner is null or p_workspace is null or length(p_workspace) not between 1 and 128
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or not buyer_writer.valid_context(p_context) then
  raise exception using errcode='22023',message='Buyer writer request rejected';
 end if;
 select id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,updated_at
 into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is distinct from p_owner then raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 c:=buyer_writer.criteria(to_jsonb(j));
 if p_expected_criteria is distinct from c or p_expected_updated_at is distinct from j.updated_at
    or (j.updated_at is not null and not isfinite(j.updated_at)) then
  raise exception using errcode='42501',message='Buyer writer request rejected';
 end if;
 if j.state !~ '^[A-Z]{2}$' or length(j.county) not between 1 and 128 or j.date_range_start is null
    or j.date_range_end is null or j.date_range_start>j.date_range_end or coalesce(j.min_purchases,1) not between 1 and 5 then
  raise exception using errcode='22023',message='Buyer writer request rejected';
 end if;
 select coalesce(max(generation),0)+1 into g from buyer_writer.dispatches where job_id=p_job;
 update buyer_writer.dispatches set state='cancelled' where job_id=p_job and state in('pending','processing');
 insert into buyer_writer.dispatches(id,job_id,owner_id,workspace,permit_digest,generation,criteria,no_cash_data,state,expires_at,source_context,source_context_digest)
 values(p_request,p_job,p_owner,p_workspace,p_digest,g,c,exists(select from jsonb_array_elements(p_context->'sources') s where s->'cashDisabled'='true'::jsonb),'pending',clock_timestamp()+interval '5 minutes',p_context,encode(sha256(convert_to(p_context::text,'UTF8')),'hex')) returning id into d;
 update public."SearchJob" set status='pending',error_message=null,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_job;
 return jsonb_build_object('dispatchId',d,'generation',g);
end$$;

create or replace function buyer_writer.cancel(p_job uuid,p_owner uuid,p_workspace text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare j record;
begin
 select user_id,updated_at into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is null or p_owner is null or j.user_id<>p_owner or p_workspace is null
    or (j.updated_at is not null and not isfinite(j.updated_at)) then
  raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 update buyer_writer.dispatches set state='cancelled' where job_id=p_job and owner_id=p_owner and workspace=p_workspace and state in('pending','processing');
 -- Advance even before the first dispatch, invalidating in-flight acquisition.
 update public."SearchJob" set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_job;
end$$;

-- Resolve an uncertain issuance/workflow outcome without touching a successor.
-- The caller supplied dispatch UUID exists before the original HTTP request.
create or replace function buyer_writer.reconcile(p_job uuid,p_owner uuid,p_workspace text,p_request uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $$
declare j record; d buyer_writer.dispatches;
begin
 if p_job is null or p_owner is null or p_request is null or p_workspace is null or length(p_workspace) not between 1 and 128
    or (p_expected_updated_at is not null and not isfinite(p_expected_updated_at)) then
  raise exception using errcode='22023',message='Buyer writer request rejected';end if;
 select user_id,updated_at into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is distinct from p_owner or (j.updated_at is not null and not isfinite(j.updated_at)) then
  raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 select * into d from buyer_writer.dispatches where id=p_request for update;
 if not found then
  -- A pending issue must compare its original revision AFTER this lock. Only
  -- invalidate the captured version; never overwrite a later job/dispatch.
  if j.updated_at is not distinct from p_expected_updated_at then
   update public."SearchJob" set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_job;
  end if;
  return jsonb_build_object('dispatchId',p_request,'generation',null,'state','absent');
 end if;
 if d.job_id<>p_job or d.owner_id<>p_owner or d.workspace<>p_workspace then
  raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 if d.state in ('pending','processing') then
  update buyer_writer.dispatches set state='cancelled' where id=d.id;
  if d.generation=(select max(generation) from buyer_writer.dispatches where job_id=p_job) then
   update public."SearchJob" set status='failed',error_message='Buyer writer dispatch cancelled',
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_job;
  end if;
  d.state:='cancelled';
 end if;
 return jsonb_build_object('dispatchId',d.id,'generation',d.generation,'state',d.state);
end$$;

create or replace function buyer_writer.valid_sale(r jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare k text; day date;
begin
 if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>10 then return false;end if;
 if not r ?& array['buyer_name','seller_name','property_address','mailing_address','sale_price','sale_date','property_type','parcel_id','deed_type','lender_name'] then return false;end if;
 foreach k in array array['buyer_name','seller_name','property_address','mailing_address','property_type','parcel_id','deed_type','lender_name'] loop
  if jsonb_typeof(r->k) not in ('string','null') or length(r->>k)>512 or (r->>k) ~ '[[:cntrl:]]' then return false;end if;
 end loop;
 if coalesce(r->>'buyer_name','')='' then return false;end if;
 if jsonb_typeof(r->'sale_price') not in ('number','null') then return false;end if;
 if r->>'sale_price' is not null and ((r->>'sale_price')::numeric<0 or (r->>'sale_price')::numeric>1e12) then return false;end if;
 if r->>'sale_date' is not null then
  if jsonb_typeof(r->'sale_date')<>'string' or (r->>'sale_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
  day:=(r->>'sale_date')::date;
  if to_char(day,'YYYY-MM-DD')<>r->>'sale_date' then return false;end if;
 end if;
 return true;
exception when others then return false;
end$$;

create or replace function buyer_writer.eligible(r jsonb,c jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce((r->>'sale_date')::date between (c->>'date_range_start')::date and (c->>'date_range_end')::date
 and (lower(coalesce(c->>'property_type','')) in ('','all') or position(lower(c->>'property_type') in coalesce(r->>'property_type',''))>0),false)
$$;

-- Computes profile/report facts only from private, committed clean-sale evidence.
create or replace function buyer_writer.commit_buyers(d buyer_writer.dispatches) returns integer
language plpgsql set search_path=pg_catalog as $$
declare b record; n integer:=0; score integer; breakdown jsonb; llc boolean; cash boolean;
 profile uuid; moment timestamptz:=clock_timestamp(); mail text; county text:=upper(d.criteria->>'county');
 state text:=upper(d.criteria->>'state'); prop text:=lower(d.criteria->>'property_type');
begin
 for b in
  select data->>'buyer_name' as name,nullif(data->>'mailing_address','') as address,count(*)::integer as purchases,
   sum(coalesce((data->>'sale_price')::numeric,0)) as spend,min((data->>'sale_date')::date) as first_day,max((data->>'sale_date')::date) as last_day,
   bool_and(coalesce(btrim(data->>'lender_name'),'') in ('','UNKNOWN')) as cash,
   array_agg(distinct data->>'property_type') filter(where coalesce(data->>'property_type','')<>'') as properties,
   array_agg(distinct data->>'parcel_id') filter(where coalesce(data->>'parcel_id','')<>'') as parcels
  from buyer_writer.sales where dispatch_id=d.id and kind='clean'
  group by data->>'buyer_name',nullif(data->>'mailing_address','') order by data->>'buyer_name',nullif(data->>'mailing_address','')
 loop
  if b.purchases<greatest(coalesce((d.criteria->>'min_purchases')::integer,1),1) then continue;end if;
  llc:=b.name ~* '\m(LLC|INC|CORP|LTD|LP|LLP|TRUST|HOLDINGS|PROPERTIES|GROUP|ENTERPRISES|INVESTMENTS|REALTY|PARTNERS)\M';
  cash:=case when d.no_cash_data then null else b.cash end;
  if coalesce((d.criteria->>'cash_buyers_only')::boolean,false) and not d.no_cash_data and not cash then continue;end if;
  if coalesce((d.criteria->>'llc_buyers_only')::boolean,false) and not llc then continue;end if;
  score:=0;breakdown:='{}';mail:=upper(coalesce(b.address,''));
  if b.purchases>1 then score:=score+25;breakdown:=breakdown||jsonb_build_object('repeat_buyer',jsonb_build_object('points',25,'note',b.purchases||' purchases'));end if;
  if b.last_day::timestamptz>=moment-interval '90 days' then score:=score+20;breakdown:=breakdown||jsonb_build_object('recent_purchase',jsonb_build_object('points',20,'note','Within 90 days'));end if;
  if llc then score:=score+15;breakdown:=breakdown||jsonb_build_object('llc_entity',jsonb_build_object('points',15,'note','LLC entity'));end if;
  if cash then score:=score+15;breakdown:=breakdown||jsonb_build_object('cash_buyer',jsonb_build_object('points',15,'note','No lender'));end if;
  if mail<>'' and position(county in mail)=0 then score:=score+10;breakdown:=breakdown||jsonb_build_object('out_of_county',jsonb_build_object('points',10,'note','Out-of-county address'));end if;
  score:=score+10;breakdown:=breakdown||jsonb_build_object('prop_type_match',jsonb_build_object('points',10,'note',case when prop='all' then 'Matches all property types' else 'Matches '||(d.criteria->>'property_type') end));
  if mail<>'' and position(county in mail)=0 and mail ~ ('(^|[^A-Z])'||state||'([^A-Z]|$)') then score:=score+5;breakdown:=breakdown||jsonb_build_object('in_state_investor',jsonb_build_object('points',5,'note','In-state investor'));end if;
  if lower(d.criteria->>'county')='forsyth' then breakdown:=breakdown||jsonb_build_object('buyer_identity',jsonb_build_object('points',0,'note','Medium confidence: buyer inferred from NCPTS current owner after SalesApp transfer matched by PIN. Deed grantee not OCR-verified yet.'));end if;
  insert into public."BuyerProfile"(buyer_name,mailing_address,county,state,is_llc,is_cash_buyer,purchase_count,total_spend,first_purchase_date,last_purchase_date,property_types,score,score_breakdown,parcel_ids,updated_at)
   values(b.name,b.address,d.criteria->>'county',d.criteria->>'state',llc,cash,b.purchases,b.spend,b.first_day,b.last_day,coalesce(b.properties,'{}'),least(score,100),breakdown,coalesce(b.parcels,'{}'),moment)
  on conflict(buyer_name,mailing_address) do update set county=excluded.county,state=excluded.state,is_llc=excluded.is_llc,is_cash_buyer=excluded.is_cash_buyer,purchase_count=excluded.purchase_count,total_spend=excluded.total_spend,first_purchase_date=excluded.first_purchase_date,last_purchase_date=excluded.last_purchase_date,property_types=excluded.property_types,score=excluded.score,score_breakdown=excluded.score_breakdown,parcel_ids=excluded.parcel_ids,updated_at=excluded.updated_at returning id into profile;
  insert into public."BuyerReport"(search_job_id,buyer_profile_id,buyer_name_snapshot,mailing_address_snapshot,score,purchase_count,total_spend,is_llc,is_cash_buyer)
   values(d.job_id,profile,b.name,b.address,least(score,100),b.purchases,b.spend,llc,cash);
  n:=n+1;
 end loop;
 return n;
end$$;

create or replace function buyer_writer.apply(p_digest text,p_workspace text,q jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' set lock_timeout='5s' as $$
declare d buyer_writer.dispatches; j record; op text; idx integer; chunks integer; r jsonb; h text; result jsonb;
 body_digest text; rows_count integer; changed integer; v_kind text; failure boolean:=false;
begin
 if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_workspace is null or jsonb_typeof(q) is distinct from 'object'
    or octet_length(q::text)>262144 or (select count(*) from jsonb_object_keys(q))<>8
    or not q ?& array['jobId','version','dispatchId','generation','operation','chunkIndex','chunkCount','payload'] then
  raise exception using errcode='22023',message='Buyer writer request rejected';end if;
 -- Lock canonical job FIRST for every operation, issuance and cancellation.
 select id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,updated_at
 into j from public."SearchJob" where id=(q->>'jobId')::uuid for update;
 if not found then raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 select * into d from buyer_writer.dispatches where id=(q->>'dispatchId')::uuid and job_id=j.id for update;
 if not found or d.permit_digest<>p_digest or d.workspace<>p_workspace or d.owner_id is distinct from j.user_id
    or (j.updated_at is not null and not isfinite(j.updated_at))
    or d.criteria is distinct from buyer_writer.criteria(to_jsonb(j)) or d.generation is distinct from (q->>'generation')::bigint
    or d.expires_at<=clock_timestamp() or d.state not in ('pending','processing')
    or not buyer_writer.valid_context(d.source_context)
    or d.source_context_digest is distinct from encode(sha256(convert_to(d.source_context::text,'UTF8')),'hex') then
  raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 op:=q->>'operation';idx:=(q->>'chunkIndex')::integer;chunks:=(q->>'chunkCount')::integer;
 if q->'version' is distinct from '1'::jsonb or jsonb_typeof(q->'generation') is distinct from 'number'
    or jsonb_typeof(q->'chunkIndex') is distinct from 'number' or jsonb_typeof(q->'chunkCount') is distinct from 'number'
    or idx is null or chunks is null or chunks not between 1 and 500 or idx not between 0 and chunks-1
    or op is null or op not in('start','raw.append','clean.append','buyers.commit','complete','fail')
    or jsonb_typeof(q->'payload') is distinct from 'object' then
  raise exception using errcode='22023',message='Buyer writer request rejected';end if;
 if exists(select from buyer_writer.receipts where dispatch_id=d.id and operation=op and chunk_index=idx) then
  raise exception using errcode='23505',message='Buyer writer replay rejected';end if;
 body_digest:=encode(sha256(convert_to(q::text,'UTF8')),'hex');
 if op in('raw.append','clean.append') then
  if (select count(*) from jsonb_object_keys(q->'payload'))<>1 or jsonb_typeof(q->'payload'->'rows') is distinct from 'array' then
   raise exception using errcode='22023',message='Buyer writer request rejected';end if;
  rows_count:=jsonb_array_length(q->'payload'->'rows');
  if rows_count not between 1 and 100 or d.state<>'processing' or d.buyers_committed then
   raise exception using errcode='22023',message='Buyer writer request rejected';end if;
  if d.bytes_received+octet_length(q::text)>67108864 then raise exception using errcode='54000',message='Buyer writer budget exceeded';end if;
  v_kind:=case when op='raw.append' then 'raw' else 'clean' end;
  if v_kind='raw' and (d.raw_count+rows_count>(d.source_context->'budgets'->>'maxRows')::integer
    or (d.source_context->>'mode'='frontend_payload' and d.raw_count+rows_count>(d.source_context->'rawPayload'->>'rowCount')::integer)) then
   raise exception using errcode='54000',message='Buyer writer source row budget exceeded';end if;
  if v_kind='raw' and (idx<>d.raw_next or (d.raw_chunks is not null and chunks<>d.raw_chunks) or d.clean_next>0) then
   raise exception using errcode='22023',message='Buyer writer chunk rejected';end if;
  if v_kind='clean' and (d.raw_chunks is null or d.raw_next<>d.raw_chunks or idx<>d.clean_next or (d.clean_chunks is not null and chunks<>d.clean_chunks)) then
   raise exception using errcode='22023',message='Buyer writer chunk rejected';end if;
  for r in select value from jsonb_array_elements(q->'payload'->'rows') loop
   if not buyer_writer.valid_sale(r) then raise exception using errcode='22023',message='Buyer writer sale rejected';end if;
   h:=encode(sha256(convert_to(r::text,'UTF8')),'hex');
   if exists(select from buyer_writer.sales where dispatch_id=d.id and sales.kind=v_kind and row_digest=h)
      or (v_kind='clean' and (not buyer_writer.eligible(r,d.criteria) or not exists(select from buyer_writer.sales where dispatch_id=d.id and sales.kind='raw' and row_digest=h))) then
    raise exception using errcode='22023',message='Buyer writer provenance rejected';end if;
  end loop;
 else
  if idx<>0 or chunks<>1 or (op='fail' and (q->'payload'->>'code' is null or q->'payload'->>'code' not in('NO_DATA_SOURCE','SOURCE_FAILED','INVALID_SOURCE_DATA') or (select count(*) from jsonb_object_keys(q->'payload'))<>1))
   or (op<>'fail' and q->'payload'<>'{}'::jsonb) then raise exception using errcode='22023',message='Buyer writer request rejected';end if;
  if (op='start' and (d.state<>'pending' or j.status is distinct from 'pending')) or (op in('buyers.commit','complete') and d.state<>'processing') then
   raise exception using errcode='22023',message='Buyer writer lifecycle rejected';end if;
  if op='buyers.commit' and (d.buyers_committed or (d.raw_chunks is not null and d.raw_next<>d.raw_chunks)
    or (d.clean_chunks is not null and d.clean_next<>d.clean_chunks)
    or exists(select from buyer_writer.sales s where s.dispatch_id=d.id and s.kind='raw' and buyer_writer.eligible(s.data,d.criteria)
       and not exists(select from buyer_writer.sales c where c.dispatch_id=d.id and c.kind='clean' and c.row_digest=s.row_digest))) then
   raise exception using errcode='22023',message='Buyer writer incomplete sales';end if;
  if op='complete' and not d.buyers_committed then raise exception using errcode='22023',message='Buyer writer incomplete job';end if;
 end if;
 -- Effects roll back as one subtransaction; a durable failure receipt is then
 -- returned with ok=false. The HTTP adapter MUST map that to a non-2xx response.
 begin
  if op in('raw.append','clean.append') then
   for r in select value from jsonb_array_elements(q->'payload'->'rows') loop
    h:=encode(sha256(convert_to(r::text,'UTF8')),'hex');
    insert into buyer_writer.sales(dispatch_id,kind,row_digest,data) values(d.id,v_kind,h,r);
    if v_kind='raw' then
     insert into public."RawSale"(search_job_id,buyer_name,seller_name,property_address,mailing_address,county,state,sale_price,sale_date,property_type,parcel_id,deed_type,lender_name)
      values(d.job_id,r->>'buyer_name',r->>'seller_name',r->>'property_address',r->>'mailing_address',d.criteria->>'county',d.criteria->>'state',(r->>'sale_price')::numeric,(r->>'sale_date')::date,r->>'property_type',r->>'parcel_id',r->>'deed_type',r->>'lender_name');
    else
     insert into public."CleanSale"(search_job_id,buyer_name,seller_name,property_address,mailing_address,county,state,sale_price,sale_date,property_type,parcel_id,deed_type,lender_name)
      values(d.job_id,r->>'buyer_name',r->>'seller_name',r->>'property_address',r->>'mailing_address',d.criteria->>'county',d.criteria->>'state',(r->>'sale_price')::numeric,(r->>'sale_date')::date,r->>'property_type',r->>'parcel_id',r->>'deed_type',r->>'lender_name');
    end if;
   end loop;
   if v_kind='raw' then update buyer_writer.dispatches set raw_chunks=chunks,raw_next=raw_next+1,raw_count=raw_count+rows_count,bytes_received=bytes_received+octet_length(q::text) where id=d.id;
   else update buyer_writer.dispatches set clean_chunks=chunks,clean_next=clean_next+1,clean_count=clean_count+rows_count,bytes_received=bytes_received+octet_length(q::text) where id=d.id;end if;
  elsif op='start' then
   update buyer_writer.dispatches set state='processing' where id=d.id;
   update public."SearchJob" set status='processing',updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=d.job_id and user_id=d.owner_id;
   get diagnostics changed=row_count;if changed<>1 then raise exception 'No job updated';end if;
  elsif op='buyers.commit' then
   changed:=buyer_writer.commit_buyers(d);
   update buyer_writer.dispatches set buyers_committed=true,buyer_count=changed where id=d.id;
  elsif op='complete' then
   update public."SearchJob" set status='completed',total_sales_analyzed=d.clean_count,total_buyers_found=d.buyer_count,error_message=null,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=d.job_id and user_id=d.owner_id;
   get diagnostics changed=row_count;if changed<>1 then raise exception 'No job updated';end if;
   update buyer_writer.dispatches set state='completed' where id=d.id;
  elsif op='fail' then
   update public."SearchJob" set status='failed',error_message=q->'payload'->>'code',updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=d.job_id and user_id=d.owner_id;
   get diagnostics changed=row_count;if changed<>1 then raise exception 'No job updated';end if;
   update buyer_writer.dispatches set state='failed' where id=d.id;
  end if;
 exception when others then failure:=true;
 end;
 if failure then
  update buyer_writer.dispatches set state='failed' where id=d.id;
  update public."SearchJob" set status='failed',error_message='WRITE_FAILED',updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=d.job_id and user_id=d.owner_id;
  get diagnostics changed=row_count;if changed<>1 then raise exception using errcode='55000',message='Buyer writer failure could not be recorded';end if;
  result:=jsonb_build_object('ok',false,'code','WRITE_FAILED');
 else result:=jsonb_build_object('ok',true,'operation',op,'chunkIndex',idx);end if;
 insert into buyer_writer.receipts(dispatch_id,operation,chunk_index,request_digest,result) values(d.id,op,idx,body_digest,result);
 return result;
end$$;

-- Scoped read after start; cannot expose another job, renew or replay a write.
create or replace function buyer_writer.context(p_digest text,p_workspace text,p_job uuid,p_dispatch uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $$
declare d buyer_writer.dispatches; j record;
begin
 select id,user_id,state,county,property_type,date_range_start,date_range_end,min_purchases,cash_buyers_only,llc_buyers_only,status,updated_at
 into j from public."SearchJob" where id=p_job for update;
 if not found then raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 select * into d from buyer_writer.dispatches where id=p_dispatch and job_id=p_job;
 if d.id is null or p_digest is null or p_workspace is null or p_generation is null
  or d.permit_digest<>p_digest or d.workspace<>p_workspace or d.generation<>p_generation
  or d.generation<>(select max(generation) from buyer_writer.dispatches where job_id=p_job)
  or d.owner_id is distinct from j.user_id or d.criteria is distinct from buyer_writer.criteria(to_jsonb(j))
  or d.state<>'processing' or d.expires_at<=clock_timestamp()
  or not buyer_writer.valid_context(d.source_context)
  or d.source_context_digest is distinct from encode(sha256(convert_to(d.source_context::text,'UTF8')),'hex') then
  raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 return jsonb_build_object('criteria',d.criteria,'sourceContext',d.source_context,'sourceContextDigest',d.source_context_digest);
end$$;

-- Receipt lookup never retries a write or exposes job rows. Requires the same
-- unexpired permit, current owner and generation even after terminal completion.
create or replace function buyer_writer.receipt(p_digest text,p_workspace text,p_job uuid,p_dispatch uuid,p_generation bigint,p_operation text,p_index integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d buyer_writer.dispatches; actual uuid; result jsonb;
begin
 select user_id into actual from public."SearchJob" where id=p_job for update;
 select * into d from buyer_writer.dispatches where id=p_dispatch and job_id=p_job;
 if p_digest is null or p_workspace is null or p_generation is null or actual is null or d.id is null
  or d.permit_digest<>p_digest or d.workspace<>p_workspace or d.owner_id<>actual or d.generation<>p_generation
  or d.generation<>(select max(generation) from buyer_writer.dispatches where job_id=p_job)
  or d.expires_at<=clock_timestamp() or d.state='cancelled' then raise exception using errcode='42501',message='Buyer writer request rejected';end if;
 select r.result into result from buyer_writer.receipts r where dispatch_id=d.id and operation=p_operation and chunk_index=p_index;
 return jsonb_build_object('found',result is not null,'receipt',result);
end$$;

-- Runtime obtains an atomic DDL fence without receiving table privileges. The
-- pinned creator and NOLOGIN owner each own one digest-bound SECURITY DEFINER
-- routine; their bodies can only lock their exact reviewed relation subsets.
grant usage,create on schema buyer_writer to postgres;
reset role;
create or replace function buyer_writer.lock_public_scope() returns boolean
language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $$
begin
 lock table public."SearchJob",public."RawSale",public."CleanSale",public."BuyerProfile",public."BuyerReport" in row exclusive mode;
 return true;
end
$$;
revoke all on function buyer_writer.lock_public_scope() from public,anon,authenticated,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer;
grant execute on function buyer_writer.lock_public_scope() to buyer_writer_owner;
set local role buyer_writer_owner;
revoke all on schema buyer_writer from postgres;
create or replace function buyer_writer.lock_scope() returns boolean
language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $$
begin
 perform buyer_writer.lock_public_scope();
 lock table buyer_writer.dispatches,buyer_writer.receipts,buyer_writer.sales in row exclusive mode;
 return true;
end
$$;
revoke all on function buyer_writer.lock_scope() from public,anon,authenticated,buyer_writer_runtime,buyer_writer_issuer;
grant execute on function buyer_writer.lock_scope() to buyer_writer_runtime,buyer_writer_issuer;

do $$declare t text; signature text; begin
 foreach t in array array['dispatches','receipts','sales'] loop
  execute format('alter table buyer_writer.%I owner to buyer_writer_owner',t);
  execute format('alter table buyer_writer.%I enable row level security',t);
  execute format('alter table buyer_writer.%I force row level security',t);
  execute format('drop policy if exists internal_owner on buyer_writer.%I',t);
  execute format('create policy internal_owner on buyer_writer.%I to buyer_writer_owner using(true) with check(true)',t);
  execute format('revoke all on buyer_writer.%I from public,anon,authenticated,buyer_writer_runtime,buyer_writer_issuer',t);
 end loop;
 foreach signature in array array[
  'buyer_writer.valid_context(jsonb)','buyer_writer.context(text,text,uuid,uuid,bigint)',
  'buyer_writer.criteria(jsonb)','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)',
  'buyer_writer.valid_sale(jsonb)','buyer_writer.eligible(jsonb,jsonb)','buyer_writer.commit_buyers(buyer_writer.dispatches)',
  'buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)'] loop
  execute format('alter function %s owner to buyer_writer_owner',signature);
  execute format('revoke all on function %s from public,anon,authenticated,buyer_writer_runtime,buyer_writer_issuer',signature);
 end loop;
end$$;
grant execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid),buyer_writer.cancel(uuid,uuid,text),buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone) to buyer_writer_issuer;
grant execute on function buyer_writer.context(text,text,uuid,uuid,bigint),buyer_writer.apply(text,text,jsonb),buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer) to buyer_writer_runtime;
reset role;
revoke references(id) on public."SearchJob" from buyer_writer_owner;
do $$begin
 if exists(select from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'))) then
  raise exception 'Unexpected Buyer Writer relation trigger';
 end if;
end$$;
commit;
