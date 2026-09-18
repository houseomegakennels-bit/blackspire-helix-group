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
 foreach r in array array['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission'] loop
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
  if exists(select from pg_roles where rolname=r and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit or (r in('buyer_writer_owner','buyer_writer_admission') and rolcanlogin))) then
   raise exception 'Unsafe existing writer role';
  end if;
 end loop;
 if exists(select from pg_roles where rolname='buyer_writer_admission_login' and (not rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit))
  or (to_regrole('buyer_writer_admission_login') is not null and not exists(
   select from pg_auth_members m where m.roleid=to_regrole('buyer_writer_admission')
    and m.member=to_regrole('buyer_writer_admission_login') and not m.admin_option
    and not m.inherit_option and m.set_option
    and m.grantor=(select datdba from pg_database where datname=current_database())))
  or (select count(*) from pg_auth_members m join pg_roles p on p.oid=m.roleid where p.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission')) not between 5 and 6
  or (select count(distinct p.rolname) from pg_auth_members m join pg_roles p on p.oid=m.roleid
   where p.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission') and m.admin_option and not m.inherit_option
   and (p.rolname='buyer_writer_owner' or not m.set_option)
   and coalesce((select rolsuper from pg_roles where oid=m.grantor),false))<>4
  or not exists(select from pg_auth_members m join pg_roles p on p.oid=m.roleid join pg_roles u on u.oid=m.member
   where p.rolname='buyer_writer_owner' and u.rolname='postgres'
   and u.oid=(select datdba from pg_database where datname=current_database()) and not m.admin_option and not m.inherit_option and m.set_option)
  or exists(select from pg_auth_members m join pg_roles p on p.oid=m.roleid join pg_roles u on u.oid=m.member
   where (p.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission') or u.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission'))
   and not ((p.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission') and u.rolname='postgres'
    and u.oid=(select datdba from pg_database where datname=current_database()) and not m.inherit_option
    and ((m.admin_option and not m.set_option and coalesce((select rolsuper from pg_roles where oid=m.grantor),false))
     or (p.rolname='buyer_writer_owner' and not m.admin_option and m.set_option and pg_get_userbyid(m.grantor)='postgres')))
    or (p.rolname='buyer_writer_admission' and u.rolname='buyer_writer_admission_login'
     and not m.admin_option and not m.inherit_option and m.set_option
     and m.grantor=(select datdba from pg_database where datname=current_database())))) then
  raise exception 'Trusted writer bootstrap relationship required';
 end if;
end$$;
-- Reject namespace collisions and pre-existing privilege outside this component.
set local role buyer_writer_owner;
do $$declare ns oid; r text; expected oid:=current_setting('blackspire.buyer_writer_creator_oid',true)::oid; begin
 select oid into ns from pg_namespace where nspname='buyer_writer';
 perform set_config('buyer_writer.schema_was_absent',(ns is null)::text,true);
  if ns is not null then
  if (case when left(obj_description(ns,'pg_namespace'),length('blackspire-buyer-writer:v2:'))='blackspire-buyer-writer:v2:' then not (
      substring(obj_description(ns,'pg_namespace') from length('blackspire-buyer-writer:v2:')+1)::jsonb =
       (select jsonb_build_object('creatorOid',expected::text,'relations',jsonb_agg(jsonb_build_object(
         'schema',reviewed.schema_name,'name',reviewed.relation_name,'oid',c.oid::text,'relkind',c.relkind,
         'relowner',c.relowner::text,'relispartition',c.relispartition,'relpersistence',c.relpersistence,
         'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity,
         'parentOids',coalesce((select jsonb_agg(i.inhparent::text order by i.inhparent) from pg_inherits i where i.inhrelid=c.oid),'[]'::jsonb)
        ) order by reviewed.schema_name,reviewed.relation_name))
        from (values('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
         ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions')) reviewed(schema_name,relation_name)
        left join pg_namespace n on n.nspname=reviewed.schema_name
        left join pg_class c on c.relnamespace=n.oid and c.relname=reviewed.relation_name)
      or (to_regclass('buyer_writer.operation_admissions') is null and
       substring(obj_description(ns,'pg_namespace') from length('blackspire-buyer-writer:v2:')+1)::jsonb =
       (select jsonb_build_object('creatorOid',expected::text,'relations',jsonb_agg(jsonb_build_object(
         'schema',reviewed.schema_name,'name',reviewed.relation_name,'oid',c.oid::text,'relkind',c.relkind,
         'relowner',c.relowner::text,'relispartition',c.relispartition,'relpersistence',c.relpersistence,
         'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity,
         'parentOids',coalesce((select jsonb_agg(i.inhparent::text order by i.inhparent) from pg_inherits i where i.inhrelid=c.oid),'[]'::jsonb)
        ) order by reviewed.schema_name,reviewed.relation_name))
        from (values('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
         ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales')) reviewed(schema_name,relation_name)
        join pg_namespace n on n.nspname=reviewed.schema_name
        join pg_class c on c.relnamespace=n.oid and c.relname=reviewed.relation_name))) else true end)
   or (select nspowner from pg_namespace where oid=ns)<>(select oid from pg_roles where rolname='buyer_writer_owner')
   or exists(select from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      where n.oid=ns and a.grantee not in(select oid from pg_roles where rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission')))
   or exists(select from pg_proc where pronamespace=ns and oid::regprocedure::text not in(
     'buyer_writer.lock_public_scope()',
     'buyer_writer.lock_scope()',
     'buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone)','buyer_writer.issue(uuid,uuid,text,text,boolean)','buyer_writer.issue(uuid,uuid,text,text,jsonb)','buyer_writer.valid_context(jsonb)','buyer_writer.context(text,text,uuid,uuid,bigint)',
     'buyer_writer.criteria(jsonb)','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)',
     'buyer_writer.valid_sale(jsonb)','buyer_writer.eligible(jsonb,jsonb)','buyer_writer.commit_buyers(buyer_writer.dispatches)',
     'buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)',
     'buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)',
     'buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)','buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)','buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)',
     'buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)',
     'buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)'))
   or exists(select from pg_class where relnamespace=ns and relname not in(
     'dispatches','receipts','sales','sales_ordinal_seq','dispatches_pkey','dispatches_permit_digest_key',
     'dispatches_job_id_generation_key','receipts_pkey','sales_pkey','operation_admissions',
     'operation_admissions_pkey','operation_admissions_issuer_request_id_key'))
   or exists(select from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=ns and not t.tgisinternal)
   or exists(select from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.pronamespace=ns and a.grantee not in(select oid from pg_roles where rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission'))
       and not(p.oid::regprocedure::text='buyer_writer.lock_public_scope()' and a.grantee=expected)) then
   raise exception 'Unexpected existing writer namespace';
  end if;
  if exists(select from (values
    ('buyer_writer.lock_public_scope()','8653f179e4814e4c73f6c337017ec6d8faa237ec5fe149e5307aebbc31c6d911','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','creator'),
    ('buyer_writer.lock_scope()','8c3f7564d40b5746db81e0dac735cf845a0fbeaeebb288c03120da9e9b82fc4f','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
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
    ('buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)','3a5f587c8b6ff018ab6d5e91b339fc60b479d0250ea0a74c7d06935035e593de','plpgsql',true,array['search_path=pg_catalog'],'v','writer'),
    ('buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)','a705d6a8fb84fd22ae424aaa6c19b36cc71692be54d7abdfe655ad379a1064ca','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','947472a925825b1628f38a0d3b232da6ac62414727c653fe047dffc3dafeb6cc','plpgsql',true,array['search_path=pg_catalog','TimeZone=UTC','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)','76701c67f63bd8ffc04ca012431994f3d4086707500369803039543e6f45f41d','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)','ae1fdc1c4baa85f264d43dc58a8e3db731b58c0811ea51cc6c3756979975a854','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)','e6e4e51af093ae9f191c1f5d4569a1c044d2f364200fe72200634d44f3e0f32f','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)','b6cf6d1de315b436687ab02ee32ceef221429973a00c76293ff602d8677c4a8b','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)','9fbeb13300e17490f7a648a8e0171f03bc9da8cc6b5ad6dd675792342664398b','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer'),
    ('buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)','6b70b51835dd1739c7842c3f28e4c1e221c79ebe83f08ed5a05c9a5d3c7a0c9d','plpgsql',true,array['search_path=pg_catalog','lock_timeout=5s'],'v','writer')
   ) expected(signature,digest,language,security_definer,config,volatility,owner_kind)
   left join pg_namespace pn on pn.nspname='buyer_writer'
   left join pg_proc p on p.pronamespace=pn.oid and p.oid::regprocedure::text=expected.signature
   left join pg_language l on l.oid=p.prolang
   where (p.oid is null and not (
     expected.signature in(
      'buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)',
      'buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)',
      'buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)',
      'buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)',
      'buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)')
     or (to_regclass('buyer_writer.operation_admissions') is null and expected.signature in(
      'buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)',
      'buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)',
      'buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)'))))
    or (p.oid is not null and (
     p.proowner<>case when expected.owner_kind='creator' then current_setting('blackspire.buyer_writer_creator_oid')::oid else (select oid from pg_roles where rolname='buyer_writer_owner') end
    or p.prosecdef is distinct from expected.security_definer or l.lanname is distinct from expected.language
    or (encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') is distinct from expected.digest
     and not (to_regclass('buyer_writer.operation_admissions') is null
      and expected.signature='buyer_writer.lock_scope()'
      and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d6b012ceae457702e804942d1bb04eeb9c922802de2751ebb56b065758627e39'))
    or p.proconfig is distinct from expected.config or p.provolatile::text is distinct from expected.volatility
    or coalesce(p.proargnames,'{}'::text[]) is distinct from case expected.signature
      when 'buyer_writer.lock_public_scope()' then array[]::text[] when 'buyer_writer.lock_scope()' then array[]::text[]
      when 'buyer_writer.criteria(jsonb)' then array['j'] when 'buyer_writer.valid_context(jsonb)' then array['c']
      when 'buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)' then array['p_job','p_owner','p_workspace','p_digest','p_context','p_expected_criteria','p_expected_updated_at','p_request']
      when 'buyer_writer.cancel(uuid,uuid,text)' then array['p_job','p_owner','p_workspace']
      when 'buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)' then array['p_job','p_owner','p_workspace','p_request','p_expected_updated_at']
      when 'buyer_writer.valid_sale(jsonb)' then array['r'] when 'buyer_writer.eligible(jsonb,jsonb)' then array['r','c']
      when 'buyer_writer.commit_buyers(buyer_writer.dispatches)' then array['d'] when 'buyer_writer.apply(text,text,jsonb)' then array['p_digest','p_workspace','q']
      when 'buyer_writer.context(text,text,uuid,uuid,bigint)' then array['p_digest','p_workspace','p_job','p_dispatch','p_generation']
      when 'buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)' then array['p_digest','p_workspace','p_job','p_dispatch','p_generation','p_operation','p_index']
      when 'buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)' then array['p_issuer','p_jti','p_request','p_raw_digest','p_expires_at']
      when 'buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)' then array['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_permit_digest','q']
      when 'buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)' then array['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_job','p_permit_digest','p_context','p_expected_criteria','p_expected_updated_at','p_dispatch_request']
      when 'buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)' then array['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_job']
      when 'buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)' then array['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_job','p_dispatch_request','p_expected_updated_at']
      when 'buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)' then array['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_permit_digest','p_job','p_dispatch','p_generation','p_business_operation','p_chunk_index']
      when 'buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)' then array['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace']
      when 'buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)' then array['p_issuer','p_jti','p_request','p_raw_digest','p_subject','p_release','p_operation_id','p_attempt_id','p_workspace','p_original_issuer','p_original_jti','p_original_request','p_original_digest','p_route_operation'] end
    or p.prorettype::regtype::text is distinct from case when expected.signature='buyer_writer.cancel(uuid,uuid,text)' then 'void'
      when expected.signature in('buyer_writer.lock_public_scope()','buyer_writer.lock_scope()','buyer_writer.valid_context(jsonb)','buyer_writer.valid_sale(jsonb)','buyer_writer.eligible(jsonb,jsonb)','buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)') then 'boolean'
      when expected.signature='buyer_writer.commit_buyers(buyer_writer.dispatches)' then 'integer' else 'jsonb' end
    or p.pronargdefaults<>0 or p.proretset or p.provariadic<>0 or p.proallargtypes is not null or p.proargmodes is not null
    or p.prokind<>'f' or p.proisstrict or p.proleakproof or p.proparallel<>'u'))) then
   raise exception 'Writer routine definition drift';
  end if;
  if (select array_agg(array[a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable::text] order by a.grantee,a.privilege_type,a.grantor,a.is_grantable)
      from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.oid=ns) is distinct from
     (select array_agg(array[edge.grantor::text,edge.grantee::text,edge.privilege,edge.grantable::text] order by edge.grantee,edge.privilege,edge.grantor,edge.grantable)
      from (values
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_owner'),'CREATE',false),
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_owner'),'USAGE',false),
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_runtime'),'USAGE',false),
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_issuer'),'USAGE',false),
       ((select oid from pg_roles where rolname='buyer_writer_owner'),
        (case when to_regclass('buyer_writer.operation_admissions') is not null then (select oid from pg_roles where rolname='buyer_writer_admission') end),'USAGE',false)
      ) edge(grantor,grantee,privilege,grantable) where edge.grantee is not null)
   or exists(select from (values
    ('buyer_writer.lock_public_scope()'),('buyer_writer.lock_scope()'),('buyer_writer.criteria(jsonb)'),('buyer_writer.valid_context(jsonb)'),
    ('buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)'),('buyer_writer.cancel(uuid,uuid,text)'),
    ('buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)'),('buyer_writer.valid_sale(jsonb)'),('buyer_writer.eligible(jsonb,jsonb)'),
    ('buyer_writer.commit_buyers(buyer_writer.dispatches)'),('buyer_writer.apply(text,text,jsonb)'),('buyer_writer.context(text,text,uuid,uuid,bigint)'),
    ('buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)'),
    ('buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)'),
    ('buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)'),
    ('buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)'),
    ('buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)'),
    ('buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)'),
    ('buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)'),
    ('buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)'),
    ('buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)')) expected(signature)
    join pg_namespace pn on pn.nspname='buyer_writer'
    join pg_proc p on p.pronamespace=pn.oid and p.oid::regprocedure::text=expected.signature
    cross join lateral (select array_agg(array[a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable::text] order by a.grantee,a.privilege_type,a.grantor,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) actual(edges)
    cross join lateral (select array_agg(array[p.proowner::text,g.oid::text,'EXECUTE','false'] order by g.oid,p.proowner)
      from pg_roles g where g.oid=p.proowner
       or (expected.signature='buyer_writer.lock_public_scope()' and g.rolname='buyer_writer_owner')
       or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.context(text,text,uuid,uuid,bigint)') and g.rolname='buyer_writer_runtime')
       or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)') and g.rolname='buyer_writer_issuer')
       or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)','buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)','buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)','buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)','buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)','buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)') and g.rolname='buyer_writer_admission'
        and (expected.signature<>'buyer_writer.lock_scope()' or to_regclass('buyer_writer.operation_admissions') is not null))) reviewed(edges)
    where actual.edges is distinct from reviewed.edges) then
   raise exception 'Writer schema or routine ACL drift';
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
 foreach r in array array['buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission'] loop
  if exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where c.relkind in('r','p','v','m','f') and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
       and has_schema_privilege(r,n.oid,'USAGE')
       and case when c.relkind in('r','p','v','m','f') then
        has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
         or has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') else false end)
    or exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='S' and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
       and case when c.relkind='S' then has_sequence_privilege(r,c.oid,'SELECT,UPDATE,USAGE') else false end)
     or exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prorettype<>'event_trigger'::regtype
      and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_temp'
      and has_schema_privilege(r,n.oid,'USAGE') and has_function_privilege(r,p.oid,'EXECUTE')
      and not (n.nspname='buyer_writer' and
       ((r='buyer_writer_runtime' and p.oid::regprocedure::text in(
        'buyer_writer.lock_scope()','buyer_writer.context(text,text,uuid,uuid,bigint)'))
       or (r='buyer_writer_issuer' and p.oid::regprocedure::text in(
        'buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)'))
       or (r='buyer_writer_admission' and p.oid::regprocedure::text in(
        'buyer_writer.lock_scope()','buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)',
        'buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)',
        'buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)',
        'buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)',
        'buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)',
        'buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)',
        'buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)',
        'buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)')))))
     or exists(select from pg_namespace n where n.nspname !~ '^pg_temp' and has_schema_privilege(r,n.oid,'CREATE'))
     or has_database_privilege(r,current_database(),'CREATE') then raise exception 'Unexpected writer role privileges';end if;
 end loop;
 if exists(select from pg_database d cross join (values('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer'),('buyer_writer_admission')) w(role_name)
    where d.datname<>current_database() and d.datallowconn and has_database_privilege(w.role_name,d.oid,'CONNECT')
    and not(d.datname='template1' and d.datistemplate and d.datdba=10
     and coalesce((select rolsuper from pg_roles where oid=10),false)
     and not has_database_privilege(w.role_name,d.oid,'CREATE')
     and not has_database_privilege(w.role_name,d.oid,'TEMP'))) then
  raise exception 'Unexpected writer cross-database CONNECT privilege';
 end if;
 if exists(with recursive protected(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
    union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
    select from protected p join pg_trigger t on t.tgrelid=p.oid where not t.tgisinternal) then
  raise exception 'Unexpected Buyer Writer relation trigger';
 end if;
 if exists(with recursive protected(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
    union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
    select from protected p join pg_class c on c.oid=p.oid join pg_rewrite r on r.ev_class=p.oid
    where not(r.rulename='_RETURN' and c.relkind in('v','m') and r.ev_type='1' and r.is_instead)) then
  raise exception 'Unexpected Buyer Writer relation rewrite rule';
 end if;
 if exists(with recursive protected(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
    union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent),
   expression_objects(classid,objid) as (
    select 'pg_constraint'::regclass,co.oid from pg_constraint co join protected p on p.oid=co.conrelid where co.conbin is not null
    union select 'pg_attrdef'::regclass,a.oid from pg_attrdef a join protected p on p.oid=a.adrelid
    union select 'pg_policy'::regclass,po.oid from pg_policy po join protected p on p.oid=po.polrelid
    union select 'pg_class'::regclass,i.indexrelid from pg_index i join protected p on p.oid=i.indrelid where i.indexprs is not null or i.indpred is not null),
   dependency_walk(rootclassid,rootobjid,classid,objid,depth) as (
    select classid,objid,classid,objid,0 from expression_objects
    union select w.rootclassid,w.rootobjid,d.refclassid,d.refobjid,w.depth+1 from dependency_walk w join pg_depend d on d.classid=w.classid and d.objid=w.objid
     where w.depth<4 and (w.depth=0 or w.classid in('pg_operator'::regclass,'pg_cast'::regclass,'pg_type'::regclass)))
    select from dependency_walk w join pg_proc p on w.classid='pg_proc'::regclass and p.oid=w.objid join pg_namespace n on n.oid=p.pronamespace
    where n.nspname<>'pg_catalog' and not(n.nspname='auth' and p.proname='uid' and p.pronargs=0 and p.prorettype='uuid'::regtype
     and w.rootclassid='pg_policy'::regclass and exists(select from pg_policy po join pg_class c on c.oid=po.polrelid join pg_namespace pn on pn.oid=c.relnamespace
      where po.oid=w.rootobjid and pn.nspname='public' and c.relname='SearchJob' and po.polname='user_read_own_search_jobs' and po.polcmd='r'
       and po.polroles=array[(select oid from pg_roles where rolname='authenticated')]::oid[]))) then
  raise exception 'Unexpected protected expression routine';
 end if;
 if exists(with recursive protected(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
    union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
    select from protected p join pg_attribute a on a.attrelid=p.oid join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace
    where a.attnum>0 and not a.attisdropped and n.nspname<>'pg_catalog') then
  raise exception 'Unexpected protected column type';
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
reset role;
create schema if not exists buyer_writer authorization buyer_writer_owner;
set local role buyer_writer_owner;
revoke all on schema buyer_writer from public,anon,authenticated;
grant usage on schema buyer_writer to buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission;
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
create table if not exists buyer_writer.operation_admissions (
 issuer text not null,
 jti uuid not null,
 request_id uuid not null,
 raw_body_digest text not null check(raw_body_digest ~ '^[a-f0-9]{64}$'),
 subject uuid,
 release_sha text check(release_sha is null or release_sha ~ '^[a-f0-9]{40}$'),
 operation_id uuid,
 attempt_id uuid,
 workspace text check(workspace is null or length(workspace) between 1 and 128),
 route_operation text check(route_operation is null or route_operation in ('apply','issue','cancel','reconcile','receipt')),
 expires_at timestamptz not null,
 state text not null default 'reserved' check(state in ('reserved','succeeded','business_failed')),
 job_id uuid,
 dispatch_id uuid,
 generation bigint,
 business_operation text,
 chunk_index integer,
 request_digest text check(request_digest is null or request_digest ~ '^[a-f0-9]{64}$'),
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 primary key(issuer,jti),
 unique(issuer,request_id),
 check((state='reserved' and subject is null and release_sha is null
     and operation_id is null and attempt_id is null and workspace is null
     and route_operation is null and result is null and completed_at is null)
    or (state<>'reserved' and subject is not null and release_sha is not null
     and operation_id is not null and attempt_id is not null and workspace is not null
     and route_operation is not null and result is not null and completed_at is not null))
);
alter table buyer_writer.operation_admissions drop constraint if exists operation_admissions_route_operation_check;
alter table buyer_writer.operation_admissions add constraint operation_admissions_route_operation_check
 check(route_operation is null or route_operation in ('apply','issue','cancel','reconcile','receipt'));

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

create or replace function buyer_writer.reserve_operation(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,
 p_expires_at timestamptz
) returns boolean language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare changed integer;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200
  or p_jti is null or p_request is null
  or p_raw_digest is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_expires_at<=clock_timestamp() or not isfinite(p_expires_at) then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 insert into buyer_writer.operation_admissions(
  issuer,jti,request_id,raw_body_digest,expires_at)
 values(p_issuer,p_jti,p_request,p_raw_digest,p_expires_at)
 on conflict do nothing;
 get diagnostics changed=row_count;
 return changed=1;
end$$;
create or replace function buyer_writer.execute_admitted_apply(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_permit_digest text,q jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set timezone='UTC' set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions; d buyer_writer.dispatches;
 j record; v_result jsonb; db_digest text; op text; idx integer;
begin
 if jsonb_typeof(q) is distinct from 'object'
  or not q ?& array['jobId','dispatchId','generation','operation','chunkIndex']
  or p_issuer is null or length(p_issuer) not between 1 and 200
  or p_jti is null or p_request is null or p_subject is null
  or p_raw_digest is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release is null or p_release !~ '^[a-f0-9]{40}$'
  or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128
  or p_permit_digest is null or p_permit_digest !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 -- Preserve the canonical lock order: SearchJob, dispatch, admission.
 select id,user_id into j from public."SearchJob"
  where id=(q->>'jobId')::uuid for update;
 if not found then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select * into d from buyer_writer.dispatches
  where id=(q->>'dispatchId')::uuid and job_id=j.id for update;
 if not found then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select * into a from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved'
  or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest
  or a.subject is not null or a.release_sha is not null
  or a.operation_id is not null or a.attempt_id is not null
  or a.workspace is not null or a.route_operation is not null
  or a.expires_at<=clock_timestamp()
  or j.user_id is distinct from p_subject
  or d.workspace is distinct from p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 op:=q->>'operation';idx:=(q->>'chunkIndex')::integer;
 db_digest:=encode(sha256(convert_to(q::text,'UTF8')),'hex');
 v_result:=buyer_writer.apply(p_permit_digest,p_workspace,q);
 update buyer_writer.operation_admissions set
  state=case when v_result->'ok'='true'::jsonb then 'succeeded' else 'business_failed' end,
  subject=p_subject,release_sha=p_release,operation_id=p_operation_id,
  attempt_id=p_attempt_id,workspace=p_workspace,route_operation='apply',
  job_id=j.id,dispatch_id=d.id,generation=d.generation,
  business_operation=op,chunk_index=idx,request_digest=db_digest,
  result=v_result,completed_at=clock_timestamp()
 where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.execute_admitted_issue(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_job uuid,p_permit_digest text,p_context jsonb,p_expected_criteria jsonb,
 p_expected_updated_at timestamptz,p_dispatch_request uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions;j record;v_result jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128 or p_job is null
  or p_permit_digest !~ '^[a-f0-9]{64}$' or p_dispatch_request is null
  or p_operation_id<>p_dispatch_request then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select id,user_id into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is distinct from p_subject then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 select * into a from buyer_writer.operation_admissions where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest or a.expires_at<=clock_timestamp()
  or a.subject is not null then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 v_result:=buyer_writer.issue(p_job,p_subject,p_workspace,p_permit_digest,p_context,p_expected_criteria,p_expected_updated_at,p_dispatch_request);
 update buyer_writer.operation_admissions set state='succeeded',subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,route_operation='issue',
  job_id=p_job,dispatch_id=(v_result->>'dispatchId')::uuid,generation=(v_result->>'generation')::bigint,
  result=v_result,completed_at=clock_timestamp() where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.execute_admitted_cancel(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,p_job uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions;j record;v_result jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128 or p_job is null then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select id,user_id into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is distinct from p_subject then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 select * into a from buyer_writer.operation_admissions where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest or a.expires_at<=clock_timestamp()
  or a.subject is not null then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 perform buyer_writer.cancel(p_job,p_subject,p_workspace);
 v_result:=jsonb_build_object('cancelled',true,'jobId',p_job);
 update buyer_writer.operation_admissions set state='succeeded',subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,route_operation='cancel',
  job_id=p_job,result=v_result,completed_at=clock_timestamp() where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.execute_admitted_reconcile(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_job uuid,p_dispatch_request uuid,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions;j record;d buyer_writer.dispatches;v_result jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128 or p_job is null
  or p_dispatch_request is null or (p_expected_updated_at is not null and not isfinite(p_expected_updated_at)) then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select id,user_id into j from public."SearchJob" where id=p_job for update;
 if not found or j.user_id is distinct from p_subject then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 select * into d from buyer_writer.dispatches where id=p_dispatch_request for update;
 select * into a from buyer_writer.operation_admissions where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest or a.expires_at<=clock_timestamp()
  or a.subject is not null then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 v_result:=buyer_writer.reconcile(p_job,p_subject,p_workspace,p_dispatch_request,p_expected_updated_at);
 update buyer_writer.operation_admissions set state='succeeded',subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,route_operation='reconcile',
  job_id=p_job,dispatch_id=p_dispatch_request,generation=nullif(v_result->>'generation','')::bigint,
  result=v_result,completed_at=clock_timestamp() where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.execute_admitted_receipt(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_permit_digest text,p_job uuid,p_dispatch uuid,p_generation bigint,
 p_business_operation text,p_chunk_index integer
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions;j record;d buyer_writer.dispatches;v_result jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128
  or p_permit_digest !~ '^[a-f0-9]{64}$' or p_job is null or p_dispatch is null
  or p_generation is null or p_business_operation is null or length(p_business_operation) not between 1 and 32
  or p_chunk_index is null or p_chunk_index<0 then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select id,user_id into j from public."SearchJob" where id=p_job for update;
 select * into d from buyer_writer.dispatches where id=p_dispatch and job_id=p_job for update;
 if j.user_id is distinct from p_subject or d.id is null or d.workspace is distinct from p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 select * into a from buyer_writer.operation_admissions where issuer=p_issuer and jti=p_jti for update;
 if not found or a.state<>'reserved' or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest or a.expires_at<=clock_timestamp()
  or a.subject is not null then raise exception using errcode='42501',message='Buyer writer admission rejected';end if;
 v_result:=buyer_writer.receipt(p_permit_digest,p_workspace,p_job,p_dispatch,p_generation,p_business_operation,p_chunk_index);
 update buyer_writer.operation_admissions set state='succeeded',subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,route_operation='receipt',
  job_id=p_job,dispatch_id=p_dispatch,generation=p_generation,business_operation=p_business_operation,
  chunk_index=p_chunk_index,result=v_result,completed_at=clock_timestamp() where issuer=p_issuer and jti=p_jti;
 return v_result;
end$$;

create or replace function buyer_writer.correlate_admission(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare a buyer_writer.operation_admissions; j record; d buyer_writer.dispatches;
 r record;
begin
 select * into a from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti;
 if not found or a.request_id is distinct from p_request
  or a.raw_body_digest is distinct from p_raw_digest then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 if a.state='reserved' then
  return jsonb_build_object('state','reserved','automaticRetry',false);
 end if;
 if a.subject is distinct from p_subject or a.release_sha is distinct from p_release
  or a.operation_id is distinct from p_operation_id
  or a.attempt_id is distinct from p_attempt_id
  or a.workspace is distinct from p_workspace then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 -- Reacquire in canonical order before trusting persisted correlation.
 select id,user_id into j from public."SearchJob" where id=a.job_id for update;
 select * into d from buyer_writer.dispatches
  where id=a.dispatch_id and job_id=a.job_id for update;
 select * into a from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti for update;
 if j.user_id is distinct from p_subject
  or (a.route_operation in ('apply','issue','receipt') and d.id is null)
  or (d.id is not null and d.workspace is distinct from p_workspace) then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 if a.route_operation='apply' then
  select request_digest,result into r from buyer_writer.receipts
   where dispatch_id=a.dispatch_id and operation=a.business_operation
    and chunk_index=a.chunk_index;
  if not found or r.request_digest is distinct from a.request_digest
   or r.result is distinct from a.result then
   return jsonb_build_object('state','inconsistent','automaticRetry',false);
  end if;
 elsif a.route_operation='issue' then
  if d.id is null or d.generation is distinct from a.generation
   or a.result is distinct from jsonb_build_object('dispatchId',d.id,'generation',d.generation) then
   return jsonb_build_object('state','inconsistent','automaticRetry',false);
  end if;
 elsif a.route_operation not in ('cancel','reconcile','receipt') then
  return jsonb_build_object('state','inconsistent','automaticRetry',false);
 end if;
 return jsonb_build_object('state',a.state,'routeOperation',a.route_operation,
  'result',a.result,'automaticRetry',false,'requestCorrelated',true);
end$$;

create or replace function buyer_writer.recover_admission(
 p_issuer text,p_jti uuid,p_request uuid,p_raw_digest text,p_subject uuid,
 p_release text,p_operation_id uuid,p_attempt_id uuid,p_workspace text,
 p_original_issuer text,p_original_jti uuid,p_original_request uuid,
 p_original_digest text,p_route_operation text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='5s' as $$
declare recovery buyer_writer.operation_admissions;
 original buyer_writer.operation_admissions; correlation jsonb;
begin
 if p_issuer is null or length(p_issuer) not between 1 and 200 or p_jti is null
  or p_request is null or p_subject is null or p_raw_digest !~ '^[a-f0-9]{64}$'
  or p_release !~ '^[a-f0-9]{40}$' or p_operation_id is null or p_attempt_id is null
  or p_workspace is null or length(p_workspace) not between 1 and 128
  or p_original_issuer is null or length(p_original_issuer) not between 1 and 200
  or p_original_jti is null or p_original_request is null
  or p_original_digest !~ '^[a-f0-9]{64}$'
  or p_route_operation not in('apply','issue','cancel','reconcile','receipt') then
  raise exception using errcode='22023',message='Buyer writer admission rejected';
 end if;
 select * into recovery from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti;
 if not found or recovery.state<>'reserved'
  or recovery.request_id is distinct from p_request
  or recovery.raw_body_digest is distinct from p_raw_digest
  or recovery.subject is not null or recovery.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select * into original from buyer_writer.operation_admissions
  where issuer=p_original_issuer and jti=p_original_jti;
 if not found or original.request_id is distinct from p_original_request
  or original.raw_body_digest is distinct from p_original_digest
  or original.subject is distinct from p_subject
  or original.release_sha is distinct from p_release
  or original.operation_id is distinct from p_operation_id
  or original.attempt_id is distinct from p_attempt_id
  or original.workspace is distinct from p_workspace
  or original.route_operation is distinct from p_route_operation
  or original.state not in('succeeded','business_failed') then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 correlation:=buyer_writer.correlate_admission(
  p_original_issuer,p_original_jti,p_original_request,p_original_digest,p_subject,
  p_release,p_operation_id,p_attempt_id,p_workspace);
 if correlation->>'state' not in('succeeded','business_failed')
  or correlation->>'routeOperation' is distinct from p_route_operation
  or correlation->'requestCorrelated' is distinct from 'true'::jsonb then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 select * into original from buyer_writer.operation_admissions
  where issuer=p_original_issuer and jti=p_original_jti;
 select * into recovery from buyer_writer.operation_admissions
  where issuer=p_issuer and jti=p_jti for update;
 if recovery.state<>'reserved' or recovery.request_id is distinct from p_request
  or recovery.raw_body_digest is distinct from p_raw_digest
  or recovery.subject is not null or recovery.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='Buyer writer admission rejected';
 end if;
 update buyer_writer.operation_admissions set
  state=original.state,subject=p_subject,release_sha=p_release,
  operation_id=p_operation_id,attempt_id=p_attempt_id,workspace=p_workspace,
  route_operation=p_route_operation,job_id=original.job_id,
  dispatch_id=original.dispatch_id,generation=original.generation,
  business_operation=original.business_operation,chunk_index=original.chunk_index,
  request_digest=original.request_digest,result=original.result,
  completed_at=clock_timestamp()
 where issuer=p_issuer and jti=p_jti;
 return correlation;
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
revoke all on function buyer_writer.lock_public_scope() from public,anon,authenticated,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission;
grant execute on function buyer_writer.lock_public_scope() to buyer_writer_owner;
set local role buyer_writer_owner;
revoke all on schema buyer_writer from postgres;
create or replace function buyer_writer.lock_scope() returns boolean
language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $$
begin
 perform buyer_writer.lock_public_scope();
 lock table buyer_writer.dispatches,buyer_writer.receipts,buyer_writer.sales,buyer_writer.operation_admissions in row exclusive mode;
 return true;
end
$$;
revoke all on function buyer_writer.lock_scope() from public,anon,authenticated,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission;
grant execute on function buyer_writer.lock_scope() to buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission;

do $$declare t text; signature text; begin
 foreach t in array array['dispatches','receipts','sales','operation_admissions'] loop
  execute format('alter table buyer_writer.%I owner to buyer_writer_owner',t);
  execute format('alter table buyer_writer.%I enable row level security',t);
  execute format('alter table buyer_writer.%I force row level security',t);
  execute format('drop policy if exists internal_owner on buyer_writer.%I',t);
  execute format('create policy internal_owner on buyer_writer.%I to buyer_writer_owner using(true) with check(true)',t);
  execute format('revoke all on buyer_writer.%I from public,anon,authenticated,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission',t);
 end loop;
 foreach signature in array array[
  'buyer_writer.valid_context(jsonb)','buyer_writer.context(text,text,uuid,uuid,bigint)',
  'buyer_writer.criteria(jsonb)','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)',
  'buyer_writer.valid_sale(jsonb)','buyer_writer.eligible(jsonb,jsonb)','buyer_writer.commit_buyers(buyer_writer.dispatches)',
  'buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)',
  'buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)',
  'buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)',
  'buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)',
  'buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)',
  'buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)',
  'buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)',
  'buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)',
  'buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)'] loop
  execute format('alter function %s owner to buyer_writer_owner',signature);
  execute format('revoke all on function %s from public,anon,authenticated,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission',signature);
 end loop;
end$$;
grant execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid),buyer_writer.cancel(uuid,uuid,text),buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone) to buyer_writer_issuer;
grant execute on function buyer_writer.context(text,text,uuid,uuid,bigint) to buyer_writer_runtime;
grant execute on function buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone),
 buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb),
 buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid),
 buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid),
 buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone),
 buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer),
 buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text),
 buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text) to buyer_writer_admission;
reset role;
revoke references(id) on public."SearchJob" from buyer_writer_owner;
set local role buyer_writer_owner;
do $$declare expected oid:=current_setting('blackspire.buyer_writer_creator_oid',true)::oid; metadata jsonb; begin
 if exists(select from (values
    ('public','SearchJob',expected),('public','RawSale',expected),('public','CleanSale',expected),('public','BuyerProfile',expected),('public','BuyerReport',expected),
    ('buyer_writer','dispatches',(select oid from pg_roles where rolname='buyer_writer_owner')),
    ('buyer_writer','receipts',(select oid from pg_roles where rolname='buyer_writer_owner')),
    ('buyer_writer','sales',(select oid from pg_roles where rolname='buyer_writer_owner')),
    ('buyer_writer','operation_admissions',(select oid from pg_roles where rolname='buyer_writer_owner'))
   ) reviewed(schema_name,relation_name,owner_oid)
   left join pg_namespace n on n.nspname=reviewed.schema_name
   left join pg_class c on c.relnamespace=n.oid and c.relname=reviewed.relation_name
   where c.oid is null or c.relkind<>'r' or c.relowner<>reviewed.owner_oid or c.relispartition
    or exists(select from pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid)) then
  raise exception 'Writer relation identity drift';
 end if;
 select jsonb_build_object('creatorOid',expected::text,'relations',jsonb_agg(jsonb_build_object(
   'schema',reviewed.schema_name,'name',reviewed.relation_name,'oid',c.oid::text,'relkind',c.relkind,
   'relowner',c.relowner::text,'relispartition',c.relispartition,'relpersistence',c.relpersistence,
   'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity,
   'parentOids',coalesce((select jsonb_agg(i.inhparent::text order by i.inhparent) from pg_inherits i where i.inhrelid=c.oid),'[]'::jsonb)
  ) order by reviewed.schema_name,reviewed.relation_name)) into metadata
  from (values('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
   ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions')) reviewed(schema_name,relation_name)
  join pg_namespace n on n.nspname=reviewed.schema_name join pg_class c on c.relnamespace=n.oid and c.relname=reviewed.relation_name;
 execute format('comment on schema buyer_writer is %L','blackspire-buyer-writer:v2:'||metadata::text);
end$$;
reset role;
set local role buyer_writer_owner;
do $$begin
 if exists(with recursive protected(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
    union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
    select from protected p join pg_trigger t on t.tgrelid=p.oid where not t.tgisinternal) then
  raise exception 'Unexpected Buyer Writer relation trigger';
 end if;
 if exists(with recursive protected(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
    union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
    select from protected p join pg_class c on c.oid=p.oid join pg_rewrite r on r.ev_class=p.oid
    where not(r.rulename='_RETURN' and c.relkind in('v','m') and r.ev_type='1' and r.is_instead)) then
  raise exception 'Unexpected Buyer Writer relation rewrite rule';
 end if;
 if exists(with recursive protected(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
    union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent),
   expression_objects(classid,objid) as (
    select 'pg_constraint'::regclass,co.oid from pg_constraint co join protected p on p.oid=co.conrelid where co.conbin is not null
    union select 'pg_attrdef'::regclass,a.oid from pg_attrdef a join protected p on p.oid=a.adrelid
    union select 'pg_policy'::regclass,po.oid from pg_policy po join protected p on p.oid=po.polrelid
    union select 'pg_class'::regclass,i.indexrelid from pg_index i join protected p on p.oid=i.indrelid where i.indexprs is not null or i.indpred is not null),
   dependency_walk(rootclassid,rootobjid,classid,objid,depth) as (
    select classid,objid,classid,objid,0 from expression_objects
    union select w.rootclassid,w.rootobjid,d.refclassid,d.refobjid,w.depth+1 from dependency_walk w join pg_depend d on d.classid=w.classid and d.objid=w.objid
     where w.depth<4 and (w.depth=0 or w.classid in('pg_operator'::regclass,'pg_cast'::regclass,'pg_type'::regclass)))
    select from dependency_walk w join pg_proc p on w.classid='pg_proc'::regclass and p.oid=w.objid join pg_namespace n on n.oid=p.pronamespace
    where n.nspname<>'pg_catalog' and not(n.nspname='auth' and p.proname='uid' and p.pronargs=0 and p.prorettype='uuid'::regtype
     and w.rootclassid='pg_policy'::regclass and exists(select from pg_policy po join pg_class c on c.oid=po.polrelid join pg_namespace pn on pn.oid=c.relnamespace
      where po.oid=w.rootobjid and pn.nspname='public' and c.relname='SearchJob' and po.polname='user_read_own_search_jobs' and po.polcmd='r'
       and po.polroles=array[(select oid from pg_roles where rolname='authenticated')]::oid[]))) then
  raise exception 'Unexpected protected expression routine';
 end if;
 if exists(with recursive protected(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
     ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
     ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
    union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
    select from protected p join pg_attribute a on a.attrelid=p.oid join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace
    where a.attnum>0 and not a.attisdropped and n.nspname<>'pg_catalog') then
  raise exception 'Unexpected protected column type';
 end if;
 if (select array_agg(array[a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable::text] order by a.grantee,a.privilege_type,a.grantor,a.is_grantable)
     from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='buyer_writer') is distinct from
    (select array_agg(array[edge.grantor::text,edge.grantee::text,edge.privilege,edge.grantable::text] order by edge.grantee,edge.privilege,edge.grantor,edge.grantable)
     from (values
      ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_owner'),'CREATE',false),
      ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_owner'),'USAGE',false),
      ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_runtime'),'USAGE',false),
      ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_issuer'),'USAGE',false),
      ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_admission'),'USAGE',false)
     ) edge(grantor,grantee,privilege,grantable))
  or exists(select from (values
    ('buyer_writer.lock_public_scope()'),('buyer_writer.lock_scope()'),('buyer_writer.criteria(jsonb)'),('buyer_writer.valid_context(jsonb)'),
    ('buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)'),('buyer_writer.cancel(uuid,uuid,text)'),
    ('buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)'),('buyer_writer.valid_sale(jsonb)'),('buyer_writer.eligible(jsonb,jsonb)'),
    ('buyer_writer.commit_buyers(buyer_writer.dispatches)'),('buyer_writer.apply(text,text,jsonb)'),('buyer_writer.context(text,text,uuid,uuid,bigint)'),
    ('buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)'),
    ('buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)'),
    ('buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)'),
    ('buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)'),
    ('buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)'),
    ('buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)'),
    ('buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)'),
    ('buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)'),
    ('buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)')) expected(signature)
    join pg_namespace pn on pn.nspname='buyer_writer'
    join pg_proc p on p.pronamespace=pn.oid and p.oid::regprocedure::text=expected.signature
    cross join lateral (select array_agg(array[a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable::text] order by a.grantee,a.privilege_type,a.grantor,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) actual(edges)
    cross join lateral (select array_agg(array[p.proowner::text,g.oid::text,'EXECUTE','false'] order by g.oid,p.proowner)
      from pg_roles g where g.oid=p.proowner
       or (expected.signature='buyer_writer.lock_public_scope()' and g.rolname='buyer_writer_owner')
       or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.context(text,text,uuid,uuid,bigint)') and g.rolname='buyer_writer_runtime')
       or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)') and g.rolname='buyer_writer_issuer')
       or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)','buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)','buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamp with time zone)','buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)','buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)','buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)') and g.rolname='buyer_writer_admission'
        and (expected.signature<>'buyer_writer.lock_scope()' or to_regclass('buyer_writer.operation_admissions') is not null))) reviewed(edges)
    where actual.edges is distinct from reviewed.edges) then
  raise exception 'Writer schema or routine ACL drift';
 end if;
end$$;
reset role;
commit;
