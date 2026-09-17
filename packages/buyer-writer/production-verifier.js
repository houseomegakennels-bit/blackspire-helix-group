import {BUYER_WRITER_ENTRYPOINTS,BUYER_WRITER_ROUTINES as ROUTINE_POLICY} from './routine-policy.js';

// Fixed, read-only production catalog observation. This statement never reads
// pg_authid, password hashes, settings containing credentials, or application
// rows. The provisioner runs it in the same transaction as role reconciliation.
export const BUYER_WRITER_PRODUCTION_VERIFY_SQL=`with
writer_roles(name) as (values ('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer'),('buyer_writer_admission')),
expected_net(name) as (values
 ('_await_response'),('_encode_url_with_params_array'),('_http_collect_response'),('_urlencode_string'),
 ('check_worker_is_up'),('http_collect_response'),('http_delete'),('http_get'),('http_post'),
 ('wait_until_running'),('wake'),('worker_restart')),
role_state as (
 select r.rolname as name,r.rolcanlogin as login,r.rolinherit as inherit,r.rolsuper as superuser,
  r.rolcreatedb as "createDb",r.rolcreaterole as "createRole",r.rolreplication as replication,r.rolbypassrls as "bypassRls"
 from pg_roles r join writer_roles w on w.name=r.rolname
), membership_state as (
 select pg_get_userbyid(m.roleid) as role,m.roleid::text as "roleOid",pg_get_userbyid(m.member) as member,m.member::text as "memberOid",
  pg_get_userbyid(m.grantor) as grantor,m.grantor::text as "grantorOid",
  member.rolcanlogin as "memberLogin",grantor.rolsuper as "grantorSuperuser",
  m.admin_option as admin,m.inherit_option as inherit,m.set_option as "set"
 from pg_auth_members m join pg_roles member on member.oid=m.member join pg_roles grantor on grantor.oid=m.grantor where pg_get_userbyid(m.roleid) in(select name from writer_roles)
  or pg_get_userbyid(m.member) in(select name from writer_roles)
), schema_state as (
 select n.oid,n.nspname as name,pg_get_userbyid(n.nspowner) as owner,
  coalesce((select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
   'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type)
   from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a),'[]'::jsonb) as edges
 from pg_namespace n where n.nspname='buyer_writer'
), routine_state as (
 select p.oid,p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,p.proowner::text as "ownerOid",p.prosecdef as "securityDefiner",
  l.lanname as language,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') as digest,p.proconfig as config,
  coalesce(p.proargnames,'{}'::text[]) as "argumentNames",p.prorettype::regtype::text as result,
  p.pronargdefaults as "argumentDefaults",p.proretset as "returnsSet",p.provariadic::text as variadic,
  p.proallargtypes is not null as "hasAllArgumentTypes",p.proargmodes is not null as "hasArgumentModes",
  p.provolatile::text as volatility,p.prokind::text as kind,p.proisstrict as strict,p.proleakproof as leakproof,p.proparallel::text as parallel,
  coalesce((select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
   'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type)
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb) as edges,
  has_function_privilege('buyer_writer_runtime',p.oid,'EXECUTE') as "runtimeExecute",
  has_function_privilege('buyer_writer_runtime',p.oid,'EXECUTE WITH GRANT OPTION') as "runtimeGrant",
  has_function_privilege('buyer_writer_issuer',p.oid,'EXECUTE') as "issuerExecute",
  has_function_privilege('buyer_writer_issuer',p.oid,'EXECUTE WITH GRANT OPTION') as "issuerGrant",
  has_function_privilege('buyer_writer_admission',p.oid,'EXECUTE') as "admissionExecute",
  has_function_privilege('buyer_writer_admission',p.oid,'EXECUTE WITH GRANT OPTION') as "admissionGrant"
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='buyer_writer'
), target_public_relations as (
 select n.nspname as schema,c.relname as name,a.privilege_type as privilege
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
  and c.relkind in('r','p') and a.grantee=0
  and a.privilege_type in('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
), target_relations as (
 select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
  and c.relkind in('r','p')
), target_public_columns as (
 select n.nspname as schema,c.relname as name,x.attname as "column",a.privilege_type as privilege
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute x on x.attrelid=c.oid
 cross join lateral aclexplode(x.attacl) a
 where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
  and c.relkind in('r','p') and x.attnum>0 and not x.attisdropped and x.attacl is not null and a.grantee=0
  and a.privilege_type in('SELECT','INSERT','UPDATE','REFERENCES')
), direct_relations as (
 select w.name as role,n.nspname as schema,c.relname as name,c.relkind::text as kind,
  has_table_privilege(w.name,c.oid,'SELECT') as "select",has_table_privilege(w.name,c.oid,'INSERT') as "insert",
  has_table_privilege(w.name,c.oid,'UPDATE') as "update",has_table_privilege(w.name,c.oid,'DELETE') as "delete",
  has_table_privilege(w.name,c.oid,'TRUNCATE') as "truncate",has_table_privilege(w.name,c.oid,'REFERENCES') as "references",
  has_table_privilege(w.name,c.oid,'TRIGGER') as "trigger",has_table_privilege(w.name,c.oid,'MAINTAIN') as maintain,
  has_any_column_privilege(w.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') as "anyColumn"
 from writer_roles w cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
 where w.name in('buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission') and c.relkind in('r','p','v','m','f')
  and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
  and has_schema_privilege(w.name,n.oid,'USAGE')
), direct_sequences as (
 select w.name as role,n.nspname as schema,c.relname as name,
  case when c.relkind='S' then has_sequence_privilege(w.name,c.oid,'SELECT') else false end as "select",
  case when c.relkind='S' then has_sequence_privilege(w.name,c.oid,'UPDATE') else false end as "update",
  case when c.relkind='S' then has_sequence_privilege(w.name,c.oid,'USAGE') else false end as usage
 from writer_roles w cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
 where w.name in('buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission') and c.relkind='S'
  and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
), schema_create as (
 select w.name as role,n.nspname as schema from writer_roles w cross join pg_namespace n
 where n.nspname !~ '^pg_temp' and has_schema_privilege(w.name,n.oid,'CREATE')
  and not(w.name='buyer_writer_owner' and n.nspname='buyer_writer')
), external_routines as (
 select w.name as role,n.nspname as schema,p.oid::regprocedure::text as signature,
  pg_get_userbyid(p.proowner) as owner
 from writer_roles w cross join pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prorettype<>'event_trigger'::regtype
  and n.nspname not in('pg_catalog','information_schema','buyer_writer')
  and has_schema_privilege(w.name,n.oid,'USAGE')
  and has_function_privilege(w.name,p.oid,'EXECUTE')
), relation_policy as (
 select
  case when left(obj_description('buyer_writer'::regnamespace,'pg_namespace'),length('blackspire-buyer-writer:v2:'))='blackspire-buyer-writer:v2:' then
   substring(obj_description('buyer_writer'::regnamespace,'pg_namespace') from length('blackspire-buyer-writer:v2:')+1)::jsonb=
    (select jsonb_build_object('creatorOid',$1::text,'relations',jsonb_agg(jsonb_build_object(
      'schema',expected.schema_name,'name',expected.relation_name,'oid',c.oid::text,'relkind',c.relkind,
      'relowner',c.relowner::text,'relispartition',c.relispartition,'relpersistence',c.relpersistence,
      'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity,
      'parentOids',coalesce((select jsonb_agg(i.inhparent::text order by i.inhparent) from pg_inherits i where i.inhrelid=c.oid),'[]'::jsonb)
     ) order by expected.schema_name,expected.relation_name))
     from (values('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
      ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions')) expected(schema_name,relation_name)
     left join pg_namespace n on n.nspname=expected.schema_name
     left join pg_class c on c.relnamespace=n.oid and c.relname=expected.relation_name)
  else false end
  and not exists(select from pg_inherits i join pg_class c on c.oid in(i.inhparent,i.inhrelid)
   join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
    ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
    ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions')))
  and not exists(with recursive protected(oid) as (
   select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
    ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
    ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
   union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
   select from protected p join pg_trigger t on t.tgrelid=p.oid where not t.tgisinternal)
  and not exists(with recursive protected(oid) as (
   select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
    ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
    ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
   union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
   select from protected p join pg_class c on c.oid=p.oid join pg_rewrite r on r.ev_class=p.oid
   where not(r.rulename='_RETURN' and c.relkind in('v','m') and r.ev_type='1' and r.is_instead))
  and not exists(with recursive protected(oid) as (
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
      and po.polroles=array[(select oid from pg_roles where rolname='authenticated')]::oid[])))
  and not exists(with recursive protected(oid) as (
   select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
    ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
    ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions'))
   union select i.inhrelid from pg_inherits i join protected p on p.oid=i.inhparent)
   select from protected p join pg_attribute a on a.attrelid=p.oid join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace
   where a.attnum>0 and not a.attisdropped and n.nspname<>'pg_catalog') as safe
), routine_policy as (
 select not exists(select from jsonb_to_recordset($2::jsonb) expected(signature text,digest text,language text,"securityDefiner" boolean,config text[],volatility text,owner text,arguments text[],result text)
   left join pg_proc p on p.oid=to_regprocedure(expected.signature) left join pg_language l on l.oid=p.prolang
   where p.oid is null or p.proowner<>case when expected.owner='creator' then $1::oid else (select oid from pg_roles where rolname='buyer_writer_owner') end
   or p.prosecdef is distinct from expected."securityDefiner" or l.lanname is distinct from expected.language
   or encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') is distinct from expected.digest
   or p.proconfig is distinct from expected.config or p.provolatile::text is distinct from expected.volatility
   or coalesce(p.proargnames,'{}'::text[]) is distinct from expected.arguments or p.prorettype::regtype::text is distinct from expected.result
   or p.pronargdefaults<>0 or p.proretset or p.provariadic<>0 or p.proallargtypes is not null or p.proargmodes is not null
   or p.prokind<>'f' or p.proisstrict or p.proleakproof or p.proparallel<>'u')
  and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='buyer_writer')=jsonb_array_length($2::jsonb) as safe
), owner_policy as (
 select not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in('r','p','v','m','f') and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
   and has_schema_privilege('buyer_writer_owner',n.oid,'USAGE') and n.nspname<>'buyer_writer'
   and has_table_privilege('buyer_writer_owner',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))
  and not exists(select from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privilege(name)
   where a.attnum>0 and not a.attisdropped and c.relkind in('r','p','v','m','f')
   and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
   and has_schema_privilege('buyer_writer_owner',n.oid,'USAGE') and has_column_privilege('buyer_writer_owner',c.oid,a.attnum,privilege.name)
   and not(n.nspname='buyer_writer' or (n.nspname='public' and case
    when c.relname='SearchJob' then (privilege.name='SELECT' and a.attname=any(array['id','user_id','state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only','status','updated_at'])) or (privilege.name='UPDATE' and a.attname=any(array['status','total_sales_analyzed','total_buyers_found','error_message','updated_at']))
    when c.relname in('RawSale','CleanSale') then privilege.name='INSERT' and a.attname=any(array['search_job_id','buyer_name','seller_name','property_address','mailing_address','county','state','sale_price','sale_date','property_type','parcel_id','deed_type','lender_name'])
    when c.relname='BuyerProfile' then (privilege.name='SELECT' and a.attname=any(array['id','buyer_name','mailing_address','county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at'])) or (privilege.name='INSERT' and a.attname=any(array['buyer_name','mailing_address','county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at'])) or (privilege.name='UPDATE' and a.attname=any(array['county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at']))
    when c.relname='BuyerReport' then privilege.name='INSERT' and a.attname=any(array['search_job_id','buyer_profile_id','buyer_name_snapshot','mailing_address_snapshot','score','purchase_count','total_spend','is_llc','is_cash_buyer']) else false end)))
  and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)' and n.nspname<>'buyer_writer'
   and case when c.relkind='S' then has_sequence_privilege('buyer_writer_owner',c.oid,'SELECT,UPDATE,USAGE') else false end) as safe
), net_state as (
 select e.name,p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,
  exists(select from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.grantee=0 and a.privilege_type='EXECUTE') as "publicExecute",
  coalesce(has_function_privilege('buyer_writer_owner',p.oid,'EXECUTE'),false) as "ownerExecute",
  coalesce(has_function_privilege('buyer_writer_runtime',p.oid,'EXECUTE'),false) as "runtimeExecute",
  coalesce(has_function_privilege('buyer_writer_issuer',p.oid,'EXECUTE'),false) as "issuerExecute",
  coalesce(has_function_privilege('buyer_writer_admission',p.oid,'EXECUTE'),false) as "admissionExecute"
 from expected_net e left join pg_namespace n on n.nspname='net'
 left join pg_proc p on p.pronamespace=n.oid and p.proname=e.name
)
select jsonb_build_object(
 'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by name),'[]'::jsonb) from role_state r),
 'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by role,member,grantor),'[]'::jsonb) from membership_state m),
 'schema',(select to_jsonb(s)-'oid' from schema_state s),
 'routines',(select coalesce(jsonb_agg(to_jsonb(r)-'oid' order by signature),'[]'::jsonb) from routine_state r),
 'targetRelations',(select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from target_relations),
 'targetPublicRelations',(select coalesce(jsonb_agg(to_jsonb(t) order by schema,name,privilege),'[]'::jsonb) from target_public_relations t),
 'targetPublicColumns',(select coalesce(jsonb_agg(to_jsonb(t) order by schema,name,"column",privilege),'[]'::jsonb) from target_public_columns t),
 'directRelations',(select coalesce(jsonb_agg(to_jsonb(d) order by role,schema,name),'[]'::jsonb) from direct_relations d
   where "select" or "insert" or "update" or "delete" or "truncate" or "references" or "trigger" or maintain or "anyColumn"),
 'directSequences',(select coalesce(jsonb_agg(to_jsonb(d) order by role,schema,name),'[]'::jsonb) from direct_sequences d
   where "select" or "update" or usage),
 'schemaCreate',(select coalesce(jsonb_agg(to_jsonb(s) order by role,schema),'[]'::jsonb) from schema_create s),
 'externalRoutines',(select coalesce(jsonb_agg(to_jsonb(r) order by role,schema,signature),'[]'::jsonb) from external_routines r),
 'bootstrapSuperuser',coalesce((select rolsuper from pg_roles where oid=10),false),
 'creatorOid',(select datdba::text from pg_database where datname=current_database()),
 'relationPolicySafe',(select safe from relation_policy),
 'routinePolicySafe',(select safe from routine_policy),
 'ownerPolicySafe',(select safe from owner_policy),
 'crossDatabaseConnect',(select coalesce(jsonb_agg(jsonb_build_object('role',w.name,'database',d.datname) order by w.name,d.datname),'[]'::jsonb)
   from writer_roles w cross join pg_database d where d.datname<>current_database() and d.datallowconn and has_database_privilege(w.name,d.oid,'CONNECT')
   and not(d.datname='template1' and d.datistemplate and d.datdba=10
    and coalesce((select rolsuper from pg_roles where oid=10),false)
    and not has_database_privilege(w.name,d.oid,'CREATE')
    and not has_database_privilege(w.name,d.oid,'TEMP'))),
 'databaseCreate',jsonb_build_object(
   'buyer_writer_owner',coalesce(has_database_privilege('buyer_writer_owner',current_database(),'CREATE'),false),
   'buyer_writer_runtime',coalesce(has_database_privilege('buyer_writer_runtime',current_database(),'CREATE'),false),
   'buyer_writer_issuer',coalesce(has_database_privilege('buyer_writer_issuer',current_database(),'CREATE'),false),
   'buyer_writer_admission',coalesce(has_database_privilege('buyer_writer_admission',current_database(),'CREATE'),false)),
 'pgNet',(select coalesce(jsonb_agg(to_jsonb(n) order by name,signature),'[]'::jsonb) from net_state n)
) as evidence`;

export const BUYER_WRITER_ROUTINES=Object.freeze(ROUTINE_POLICY.map(routine=>routine.signature));
export const BUYER_WRITER_RUNTIME_ROUTINES=BUYER_WRITER_ENTRYPOINTS.runtime;
export const BUYER_WRITER_ISSUER_ROUTINES=BUYER_WRITER_ENTRYPOINTS.issuer;
export const BUYER_WRITER_ADMISSION_ROUTINES=BUYER_WRITER_ENTRYPOINTS.admission;
export const BUYER_WRITER_PG_NET_FUNCTIONS=Object.freeze([
 '_await_response','_encode_url_with_params_array','_http_collect_response','_urlencode_string',
 'check_worker_is_up','http_collect_response','http_delete','http_get','http_post',
 'wait_until_running','wake','worker_restart',
]);

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const string=(value,max=1024)=>typeof value==='string'&&value.length>0&&value.length<=max;
const bool=value=>typeof value==='boolean';
const fail=()=>{throw new Error('Buyer writer production verification failed');};
const sameSet=(values,expected)=>values.length===expected.length&&new Set(values).size===values.length
 &&values.every(value=>expected.includes(value));

// Validates only bounded, non-secret catalog evidence. Unknown keys, missing
// catalog rows, duplicate identities and unexpected ACL edges all fail closed.
export function verifyBuyerWriterProductionEvidence(raw,creatorOid){
 try{
  if(!Number.isInteger(creatorOid)||creatorOid<1||creatorOid>4294967295||Buffer.byteLength(JSON.stringify(raw))>1024*1024
   ||!exact(raw,['roles','memberships','schema','routines','targetRelations','targetPublicRelations','targetPublicColumns','directRelations','directSequences','schemaCreate','externalRoutines','databaseCreate','pgNet','bootstrapSuperuser','creatorOid','relationPolicySafe','routinePolicySafe','ownerPolicySafe','crossDatabaseConnect'])
   ||![raw.roles,raw.memberships,raw.routines,raw.targetRelations,raw.targetPublicRelations,raw.targetPublicColumns,raw.directRelations,raw.directSequences,raw.schemaCreate,raw.externalRoutines,raw.pgNet,raw.crossDatabaseConnect].every(Array.isArray)
   ||raw.bootstrapSuperuser!==true||raw.creatorOid!==String(creatorOid)||raw.relationPolicySafe!==true||raw.routinePolicySafe!==true||raw.ownerPolicySafe!==true)fail();
  const roleNames=['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission'];
  if(!sameSet(raw.targetRelations,['SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport']))fail();
  if(!sameSet(raw.roles.map(role=>role?.name),roleNames))fail();
  for(const role of raw.roles){
   if(!exact(role,['name','login','inherit','superuser','createDb','createRole','replication','bypassRls'])
    ||![role.login,role.inherit,role.superuser,role.createDb,role.createRole,role.replication,role.bypassRls].every(bool))fail();
   const login=role.name==='buyer_writer_runtime'||role.name==='buyer_writer_issuer';
   if(role.login!==login||role.inherit||role.superuser||role.createDb||role.createRole||role.replication||role.bypassRls)fail();
  }
  if(raw.memberships.length!==6)fail();
  const adminRoles=new Set();let ownerSetCount=0,admissionSetCount=0;
  for(const edge of raw.memberships){
   if(!exact(edge,['role','roleOid','member','memberOid','grantor','grantorOid','memberLogin','grantorSuperuser','admin','inherit','set'])
    ||![edge.role,edge.member,edge.grantor].every(value=>string(value,63))||![edge.roleOid,edge.memberOid,edge.grantorOid].every(value=>/^\d{1,10}$/.test(value))
    ||![edge.memberLogin,edge.grantorSuperuser,edge.admin,edge.inherit,edge.set].every(bool))fail();
   const managerAdmin=roleNames.includes(edge.role)&&edge.member==='postgres'&&edge.memberOid===String(creatorOid)
    &&edge.grantorSuperuser&&edge.admin&&!edge.inherit&&!edge.set;
   const ownerSet=edge.role==='buyer_writer_owner'&&edge.member==='postgres'
    &&edge.memberOid===String(creatorOid)&&edge.grantorOid===String(creatorOid)&&!edge.admin&&!edge.inherit&&edge.set;
   const admissionSet=edge.role==='buyer_writer_admission'&&edge.member==='buyer_writer_admission_login'
    &&edge.memberLogin&&edge.grantorOid===String(creatorOid)&&!edge.admin&&!edge.inherit&&edge.set;
   if(!managerAdmin&&!ownerSet&&!admissionSet)fail();
   if(managerAdmin){if(adminRoles.has(edge.role))fail();adminRoles.add(edge.role);}
   else if(ownerSet)ownerSetCount++;else admissionSetCount++;
  }
  if(adminRoles.size!==4||ownerSetCount!==1||admissionSetCount!==1)fail();
  if(!exact(raw.schema,['name','owner','edges'])||raw.schema.name!=='buyer_writer'||raw.schema.owner!=='buyer_writer_owner'
   ||!Array.isArray(raw.schema.edges))fail();
  const schemaEdges=[
   ['buyer_writer_owner','buyer_writer_owner','CREATE',false],['buyer_writer_owner','buyer_writer_owner','USAGE',false],
   ['buyer_writer_owner','buyer_writer_runtime','USAGE',false],['buyer_writer_owner','buyer_writer_issuer','USAGE',false],
   ['buyer_writer_owner','buyer_writer_admission','USAGE',false],
  ];
  validateAclEdges(raw.schema.edges,schemaEdges);
  if(!sameSet(raw.routines.map(routine=>routine?.signature),BUYER_WRITER_ROUTINES))fail();
  for(const routine of raw.routines){
   const policy=ROUTINE_POLICY.find(expected=>expected.signature===routine.signature);
   if(!policy||!exact(routine,['signature','owner','ownerOid','securityDefiner','language','digest','config','argumentNames','result','argumentDefaults','returnsSet','variadic','hasAllArgumentTypes','hasArgumentModes','volatility','kind','strict','leakproof','parallel','edges','runtimeExecute','runtimeGrant','issuerExecute','issuerGrant','admissionExecute','admissionGrant'])
    ||routine.ownerOid!==(policy.owner==='creator'?String(creatorOid):raw.routines.find(row=>row.signature==='buyer_writer.lock_scope()')?.ownerOid)
    ||routine.securityDefiner!==policy.securityDefiner||routine.language!==policy.language||routine.digest!==policy.digest
    ||JSON.stringify(routine.config)!==JSON.stringify(policy.config)||routine.volatility!==policy.volatility
    ||JSON.stringify(routine.argumentNames)!==JSON.stringify(policy.arguments)||routine.result!==policy.result
    ||routine.argumentDefaults!==0||routine.returnsSet||routine.variadic!=='0'||routine.hasAllArgumentTypes||routine.hasArgumentModes
    ||routine.kind!=='f'||routine.strict||routine.leakproof||routine.parallel!=='u'||!Array.isArray(routine.edges)
    ||![routine.securityDefiner,routine.returnsSet,routine.hasAllArgumentTypes,routine.hasArgumentModes,routine.strict,routine.leakproof,routine.runtimeExecute,routine.runtimeGrant,routine.issuerExecute,routine.issuerGrant,routine.admissionExecute,routine.admissionGrant].every(bool))fail();
   const runtime=BUYER_WRITER_RUNTIME_ROUTINES.includes(routine.signature),issuer=BUYER_WRITER_ISSUER_ROUTINES.includes(routine.signature),admission=BUYER_WRITER_ADMISSION_ROUTINES.includes(routine.signature);
   if(routine.runtimeExecute!==runtime||routine.issuerExecute!==issuer||routine.admissionExecute!==admission||routine.runtimeGrant||routine.issuerGrant||routine.admissionGrant)fail();
   const routineOwner=policy.owner==='creator'?routine.owner:'buyer_writer_owner';
   validateAclEdges(routine.edges,[[routineOwner,routineOwner,'EXECUTE',false],
    ...(routine.signature==='buyer_writer.lock_public_scope()'?[[routineOwner,'buyer_writer_owner','EXECUTE',false]]:[]),
    ...(runtime?[[routineOwner,'buyer_writer_runtime','EXECUTE',false]]:[]),
    ...(issuer?[[routineOwner,'buyer_writer_issuer','EXECUTE',false]]:[]),
    ...(admission?[[routineOwner,'buyer_writer_admission','EXECUTE',false]]:[])]);
  }
  if(raw.targetPublicRelations.length||raw.targetPublicColumns.length||raw.directRelations.length||raw.directSequences.length||raw.schemaCreate.length||raw.externalRoutines.length
   ||raw.crossDatabaseConnect.length||!exact(raw.databaseCreate,['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission'])
   ||raw.databaseCreate.buyer_writer_owner!==false||raw.databaseCreate.buyer_writer_runtime!==false||raw.databaseCreate.buyer_writer_issuer!==false||raw.databaseCreate.buyer_writer_admission!==false)fail();
  if(raw.pgNet.length!==12||!sameSet(raw.pgNet.map(row=>row?.name),BUYER_WRITER_PG_NET_FUNCTIONS))fail();
  for(const row of raw.pgNet){
   const absent=row.signature===null&&row.owner===null;
   if(!exact(row,['name','signature','owner','publicExecute','ownerExecute','runtimeExecute','issuerExecute','admissionExecute'])
    ||(!absent&&(!string(row.signature)||!string(row.owner,63)))
    ||![row.publicExecute,row.ownerExecute,row.runtimeExecute,row.issuerExecute,row.admissionExecute].every(bool)
    ||(absent&&[row.publicExecute,row.ownerExecute,row.runtimeExecute,row.issuerExecute,row.admissionExecute].some(Boolean)))fail();
  }
  const publicExecuteCount=raw.pgNet.filter(row=>row.publicExecute).length;
  const evidence=structuredClone(raw);
  evidence.compliant=true;
  evidence.unexpectedMembershipCount=0;
  evidence.targetRelationCount=5;
  evidence.targetTablePublicPrivilegeCount=0;
  evidence.targetColumnPublicPrivilegeCount=0;
  evidence.directTableAccessDenied=true;
  evidence.directSequenceAccessDenied=true;
  evidence.schemaCreateDenied=true;
  evidence.crossRoutineAccessDenied=raw.externalRoutines.length===0;
  evidence.pgNetTruth={functionCount:raw.pgNet.filter(row=>row.signature!==null).length,publicExecuteCount,
   ownerEffectiveExecuteCount:raw.pgNet.filter(row=>row.ownerExecute).length,
   runtimeEffectiveExecuteCount:raw.pgNet.filter(row=>row.runtimeExecute).length,
   issuerEffectiveExecuteCount:raw.pgNet.filter(row=>row.issuerExecute).length,
   supabaseAclFixed:publicExecuteCount===0,
   providerAcl:publicExecuteCount===0?'PUBLIC_EXECUTE_CLOSED':'DEFENSE_IN_DEPTH_OPEN'};
  return Object.freeze(evidence);
 }catch(error){if(error?.message==='Buyer writer production verification failed')throw error;fail();}
}

function validateAclEdges(edges,expected){
 if(!Array.isArray(edges)||edges.length!==expected.length)fail();
 const wanted=new Set(expected.map(value=>JSON.stringify(value)));
 for(const edge of edges){
  if(!exact(edge,['grantor','grantee','privilege','grantable'])
   ||!string(edge.grantee,63)||edge.privilege!=='EXECUTE'&&edge.privilege!=='CREATE'&&edge.privilege!=='USAGE'
   ||!bool(edge.grantable)||!wanted.delete(JSON.stringify([edge.grantor,edge.grantee,edge.privilege,edge.grantable])))fail();
 }
 if(wanted.size)fail();
}

export async function observeBuyerWriterProductionState(query,creatorOid){
 try{
  if(typeof query!=='function'||!Number.isInteger(creatorOid)||creatorOid<1||creatorOid>4294967295)fail();
  const result=await query(BUYER_WRITER_PRODUCTION_VERIFY_SQL,[creatorOid,JSON.stringify(ROUTINE_POLICY)]);
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1||!exact(result.rows[0],['evidence']))fail();
  return verifyBuyerWriterProductionEvidence(result.rows[0].evidence,creatorOid);
 }catch(error){if(error?.message==='Buyer writer production verification failed')throw error;fail();}
}
