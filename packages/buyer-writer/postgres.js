import {BUYER_WRITER_ENTRYPOINTS,BUYER_WRITER_ROUTINES} from './routine-policy.js';

// Explicit credentials only. No environment, credential file, database URL or
// listener is loaded here. Deployment must supply the locked PostgreSQL driver.
const statements = {
  runtime: new Set([
    'select buyer_writer.context($1,$2,$3,$4,$5) as result',
  ]),
  admission: new Set([
    'select buyer_writer.reserve_operation($1,$2,$3,$4,$5::timestamptz) as result',
    'select buyer_writer.execute_admitted_apply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) as result',
    'select buyer_writer.correlate_admission($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
  ]),
  issuer: new Set([
    'select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result',
    'select buyer_writer.cancel($1,$2,$3) as result',
    'select buyer_writer.reconcile($1,$2,$3,$4,$5::timestamptz) as result',
  ]),
};
const signatures = BUYER_WRITER_ENTRYPOINTS;
const routinePolicy=JSON.stringify(BUYER_WRITER_ROUTINES);
const unavailable = () => new Error('Buyer writer database unavailable');

// Run while connected to template1 as the dedicated writer. Cross-database
// catalogs are not visible from the application database, so the narrow
// database-level exception below is paired with this object-level attestation.
export const TEMPLATE1_IDENTITY_SQL=`select (
 session_user=$1 and current_user=$1 and current_database()='template1'
 and d.datistemplate and d.datdba=10
 and coalesce((select rolsuper from pg_roles where oid=10),false)
 and not has_database_privilege(current_user,d.oid,'CREATE')
 and not has_database_privilege(current_user,d.oid,'TEMP')
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
   and n.nspname<>'public' and has_schema_privilege(current_user,n.oid,'USAGE'))
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
   and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
   and c.relkind in('r','p','v','m','f')
   and (has_table_privilege(current_user,c.oid,'SELECT') or has_table_privilege(current_user,c.oid,'INSERT')
    or has_table_privilege(current_user,c.oid,'UPDATE') or has_table_privilege(current_user,c.oid,'DELETE')
    or has_table_privilege(current_user,c.oid,'TRUNCATE') or has_table_privilege(current_user,c.oid,'REFERENCES')
    or has_table_privilege(current_user,c.oid,'TRIGGER') or has_table_privilege(current_user,c.oid,'MAINTAIN')
    or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema' and c.relkind='S'
   and (has_sequence_privilege(current_user,c.oid,'SELECT') or has_sequence_privilege(current_user,c.oid,'UPDATE')
    or has_sequence_privilege(current_user,c.oid,'USAGE')))
 and not exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname !~ '^pg_(catalog|toast|temp)' and n.nspname<>'information_schema'
   and has_schema_privilege(current_user,n.oid,'USAGE') and has_function_privilege(current_user,p.oid,'EXECUTE'))
) as safe from pg_database d where d.datname=current_database()`;

// ACLs inherited from PUBLIC or another role count whenever their schema is
// reachable. Unreachable provider-owned defaults do not become writer authority.
export const WRITER_IDENTITY_SQL = `select (
 session_user=$1 and current_user=$1
 and r.rolcanlogin and not(r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls or r.rolinherit)
 and (select count(*) from pg_auth_members m join pg_roles role on role.oid=m.roleid
   where role.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission')) between 4 and 5
 and (select count(distinct role.rolname) from pg_auth_members m join pg_roles role on role.oid=m.roleid
   where role.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission') and m.admin_option and not m.inherit_option
   and (role.rolname='buyer_writer_owner' or not m.set_option) and m.grantor=10
   and coalesce((select rolsuper from pg_roles where oid=10),false))=4
 and exists(select from pg_auth_members m join pg_roles role on role.oid=m.roleid join pg_roles member on member.oid=m.member
   where role.rolname='buyer_writer_owner' and member.rolname='postgres'
   and member.oid=$4::oid and member.oid=(select datdba from pg_database where datname=current_database())
   and case when left(obj_description('buyer_writer'::regnamespace,'pg_namespace'),length('blackspire-buyer-writer:v2:'))='blackspire-buyer-writer:v2:' then
    substring(obj_description('buyer_writer'::regnamespace,'pg_namespace') from length('blackspire-buyer-writer:v2:')+1)::jsonb=
     (select jsonb_build_object('creatorOid',$4::text,'relations',jsonb_agg(jsonb_build_object(
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
   and not m.admin_option and not m.inherit_option and m.set_option)
 and not exists(select from pg_auth_members m join pg_roles role on role.oid=m.roleid join pg_roles member on member.oid=m.member
   where role.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission')
   and not(member.rolname='postgres' and member.oid=$4::oid and member.oid=(select datdba from pg_database where datname=current_database()) and not m.inherit_option and (
    (m.admin_option and not m.set_option and m.grantor=10 and coalesce((select rolsuper from pg_roles where oid=10),false))
    or (role.rolname='buyer_writer_owner' and not m.admin_option and m.set_option and pg_get_userbyid(m.grantor)='postgres'))))
 and not exists(select from pg_auth_members m join pg_roles member on member.oid=m.member
   where member.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission'))
 and exists(select from pg_roles where rolname='buyer_writer_owner' and not(rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit))
 and has_schema_privilege(current_user,'buyer_writer','USAGE')
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_temp' and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not has_database_privilege(current_user,current_database(),'CREATE')
 and not exists(select from pg_namespace n where n.nspname !~ '^pg_temp' and n.nspname<>'buyer_writer'
   and has_schema_privilege('buyer_writer_owner',n.oid,'CREATE'))
 and not has_database_privilege('buyer_writer_owner',current_database(),'CREATE')
 and not exists(select from pg_database d cross join (values('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
   where d.datname<>current_database() and d.datallowconn and has_database_privilege(w.role_name,d.oid,'CONNECT')
   and not(d.datname='template1' and d.datistemplate and d.datdba=10
    and coalesce((select rolsuper from pg_roles where oid=10),false)
    and not has_database_privilege(w.role_name,d.oid,'CREATE')
    and not has_database_privilege(w.role_name,d.oid,'TEMP')))
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
   where a.attnum>0 and not a.attisdropped and n.nspname<>'pg_catalog')
 and not exists(select from pg_inherits i join pg_class c on c.oid in(i.inhparent,i.inhrelid)
   join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in(
    ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
    ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'),('buyer_writer','operation_admissions')))
 and coalesce((select bool_and(coalesce(has_function_privilege(current_user,to_regprocedure(s),'EXECUTE'),false)) from unnest($2::text[]) s),false)
 and not exists(select from jsonb_to_recordset($3::jsonb) expected(signature text,digest text,language text,"securityDefiner" boolean,config text[],volatility text,owner text,arguments text[],result text)
   left join pg_proc p on p.oid=to_regprocedure(expected.signature) left join pg_language l on l.oid=p.prolang
   where p.oid is null or p.proowner<>case when expected.owner='creator' then $4::oid else (select oid from pg_roles where rolname='buyer_writer_owner') end
   or p.prosecdef is distinct from expected."securityDefiner" or l.lanname is distinct from expected.language
   or encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') is distinct from expected.digest
   or p.proconfig is distinct from expected.config or p.provolatile::text is distinct from expected.volatility
   or coalesce(p.proargnames,'{}'::text[]) is distinct from expected.arguments or p.prorettype::regtype::text is distinct from expected.result
   or p.pronargdefaults<>0 or p.proretset or p.provariadic<>0 or p.proallargtypes is not null or p.proargmodes is not null
   or p.prokind<>'f' or p.proisstrict or p.proleakproof or p.proparallel<>'u')
 and (select array_agg(array[a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable::text] order by a.grantee,a.privilege_type,a.grantor,a.is_grantable)
      from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='buyer_writer')=
     (select array_agg(array[edge.grantor::text,edge.grantee::text,edge.privilege,edge.grantable::text] order by edge.grantee,edge.privilege,edge.grantor,edge.grantable)
      from (values
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_owner'),'CREATE',false),
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_owner'),'USAGE',false),
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_runtime'),'USAGE',false),
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_issuer'),'USAGE',false),
       ((select oid from pg_roles where rolname='buyer_writer_owner'),(select oid from pg_roles where rolname='buyer_writer_admission'),'USAGE',false)
      ) edge(grantor,grantee,privilege,grantable))
  and not exists(select from jsonb_to_recordset($3::jsonb) expected(signature text)
   join pg_namespace pn on pn.nspname='buyer_writer'
   join pg_proc p on p.pronamespace=pn.oid and p.oid::regprocedure::text=expected.signature
   cross join lateral (select array_agg(array[a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable::text] order by a.grantee,a.privilege_type,a.grantor,a.is_grantable)
     from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) actual(edges)
   cross join lateral (select array_agg(array[p.proowner::text,g.oid::text,'EXECUTE','false'] order by g.oid,p.proowner)
     from pg_roles g where g.oid=p.proowner
      or (expected.signature='buyer_writer.lock_public_scope()' and g.rolname='buyer_writer_owner')
      or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.context(text,text,uuid,uuid,bigint)') and g.rolname='buyer_writer_runtime')
      or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)') and g.rolname='buyer_writer_issuer')
      or (expected.signature in('buyer_writer.lock_scope()','buyer_writer.reserve_operation(text,uuid,uuid,text,timestamp with time zone)','buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)','buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)') and g.rolname='buyer_writer_admission')) reviewed(edges)
  where actual.edges is distinct from reviewed.edges)
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
   and c.relkind in('r','p') and a.grantee=0
   and a.privilege_type in('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute x on x.attrelid=c.oid
   cross join lateral aclexplode(x.attacl) a
   where n.nspname='public' and c.relname in('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
   and c.relkind in('r','p') and x.attnum>0 and not x.attisdropped and x.attacl is not null and a.grantee=0
   and a.privilege_type in('SELECT','INSERT','UPDATE','REFERENCES'))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in('r','p','v','m','f') and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
   and has_schema_privilege(current_user,n.oid,'USAGE')
   and case when c.relkind in('r','p','v','m','f') then
    has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') else false end)
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind='S' and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
   and has_sequence_privilege(current_user,c.oid,'SELECT,UPDATE,USAGE'))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
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
    when c.relname='BuyerReport' then privilege.name='INSERT' and a.attname=any(array['search_job_id','buyer_profile_id','buyer_name_snapshot','mailing_address_snapshot','score','purchase_count','total_spend','is_llc','is_cash_buyer'])
    else false end)))
 and not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)' and n.nspname<>'buyer_writer'
   and case when c.relkind='S' then has_sequence_privilege('buyer_writer_owner',c.oid,'SELECT,UPDATE,USAGE') else false end)
 and not exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   cross join (values(current_user),('buyer_writer_owner')) w(role_name)
   where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_temp'
   and p.prorettype<>'event_trigger'::regtype
   and has_schema_privilege(w.role_name,n.oid,'USAGE')
   and has_function_privilege(w.role_name,p.oid,'EXECUTE')
   and not(
    (w.role_name=current_user and p.oid=any(array(select to_regprocedure(s)::oid from unnest($2::text[]) s)))
    or (w.role_name='buyer_writer_owner' and p.oid=any(array(select to_regprocedure(expected.signature)::oid
      from jsonb_to_recordset($3::jsonb) expected(signature text))))))
 and current_setting('statement_timeout')='10s' and current_setting('lock_timeout')='5s'
 and current_setting('search_path')='pg_catalog'
) as safe from pg_roles r where r.rolname=$1`;

const fenceSql=`with checked as materialized (${WRITER_IDENTITY_SQL})
select checked.safe,case when checked.safe then buyer_writer.lock_scope() else false end as locked from checked`;
const operationSql=text=>{
  const prefix='select ',suffix=' as result';
  if(!text.startsWith(prefix)||!text.endsWith(suffix))throw unavailable();
  const shifted=text.slice(prefix.length,-suffix.length).replaceAll(/\$(\d+)/g,(_,n)=>`$${Number(n)+4}`);
  // Keep the volatile SECURITY DEFINER call inside the CASE arm itself. A
  // lateral subquery can be pulled up/reordered by PostgreSQL and is therefore
  // not an execution fence even when it carries a checked.safe predicate.
  const expression=text==='select buyer_writer.cancel($1,$2,$3) as result'
    ?`case when checked.safe then ${shifted} end`
    :`case when checked.safe then ${shifted} else null::jsonb end`;
  return `with checked as materialized (${WRITER_IDENTITY_SQL})
select checked.safe,${expression} as result
from checked`;
};

function configuration(value,kind) {
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).some(k=>!['host','port','database','password','ca'].includes(k))
    ||typeof value.host!=='string'||value.host.length>253||!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value.host)
    ||!Number.isInteger(value.port)||value.port<1||value.port>65535
    ||typeof value.database!=='string'||!/^[a-zA-Z0-9_-]{1,63}$/.test(value.database)
    ||typeof value.password!=='string'||value.password.length<1||value.password.length>1024||value.password.includes('\0')
    ||(value.ca!==undefined&&(typeof value.ca!=='string'||value.ca.length>65536||!value.ca.includes('-----BEGIN CERTIFICATE-----'))))throw unavailable();
  return {
    host:value.host,port:value.port,database:value.database,password:value.password,
    user:`buyer_writer_${kind}`,ssl:{rejectUnauthorized:true,...(value.ca===undefined?{}:{ca:value.ca})},
    application_name:`blackspire-buyer-writer-${kind}`,client_encoding:'UTF8',
    options:'-c statement_timeout=10000 -c lock_timeout=5000 -c search_path=pg_catalog -c idle_in_transaction_session_timeout=10000',
    connectionTimeoutMillis:2000,query_timeout:11000,idleTimeoutMillis:10000,
    max:kind==='runtime'?4:2,maxUses:100,maxLifetimeSeconds:60,
  };
}

export async function createBuyerWriterPostgres({runtime,issuer,creatorOid,Pool}) {
  const configs={runtime:configuration(runtime,'runtime'),issuer:configuration(issuer,'issuer')};
  if(!Number.isInteger(creatorOid)||creatorOid<1||creatorOid>4294967295
    ||runtime.password===issuer.password||runtime.host.toLowerCase()!==issuer.host.toLowerCase()
    ||runtime.port!==issuer.port||runtime.database!==issuer.database)throw unavailable();
  const pools={};const counts={runtime:0,issuer:0};const clients=new Set();
  let closed=false,healthy=true,closing;
  const close=()=>{
    if(closing)return closing;
    closed=true;
    // Every checked-out connection is explicitly owned by this component.
    for(const destroy of clients)destroy();
    let timer;
    closing=Promise.race([
      Promise.allSettled(Object.values(pools).map(pool=>Promise.resolve().then(()=>pool.end()))).then(results=>{
        if(results.some(r=>r.status==='rejected'))throw unavailable();
      }),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(unavailable()),2000);}),
    ]).finally(()=>clearTimeout(timer));
    return closing;
  };
  const templateSafe=async kind=>{
    let client,timer,expired=false,released=false;
    const release=destroy=>{if(client&&!released){released=true;client.release(destroy);}};
    try{return await Promise.race([
      (async()=>{client=await pools[`${kind}Template`].connect();if(expired||closed){release(true);throw unavailable();}
        const result=await client.query(TEMPLATE1_IDENTITY_SQL,[configs[kind].user]);
        if(expired||closed||result?.rows?.length!==1||result.rows[0]?.safe!==true)throw unavailable();return true;})(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;release(true);reject(unavailable());},4000);}),
    ]);}catch{release(true);throw unavailable();}finally{clearTimeout(timer);release(false);}
  };
  const run=async(kind,text,values,probe=false)=>{
    if(closed||!healthy||counts[kind]>=configs[kind].max||(!probe&&(!statements[kind].has(text)||!Array.isArray(values))))throw unavailable();
    counts[kind]++;
    let client,released=false,timer,expired=false,inTransaction=false;
    const release=destroy=>{
      if(!client||released)return;
      released=true;client.release(destroy);
    };
    const destroy=()=>release(true);
    const deadline=performance.now()+14000;
    try {
      await templateSafe(kind);
      return await Promise.race([
        (async()=>{
          client=await pools[kind].connect();
          if(expired||closed){release(true);throw unavailable();}
          clients.add(destroy);
          const identityValues=[configs[kind].user,signatures[kind],routinePolicy,creatorOid];
          if(probe){
            const result=await client.query(WRITER_IDENTITY_SQL,identityValues);
            if(expired||closed||performance.now()>=deadline||result?.rows?.length!==1||result.rows[0]?.safe!==true)throw unavailable();
            return;
          }
          await client.query('begin');inTransaction=true;
          const fenced=await client.query(fenceSql,identityValues);
          if(expired||closed||performance.now()>=deadline||fenced?.rows?.length!==1||fenced.rows[0]?.safe!==true||fenced.rows[0]?.locked!==true)throw unavailable();
          const written=await client.query(operationSql(text),[...identityValues,...values]);
          if(expired||closed||performance.now()>=deadline||written?.rows?.length!==1||written.rows[0]?.safe!==true)throw unavailable();
          await client.query('commit');inTransaction=false;
          if(expired||closed||performance.now()>=deadline)throw unavailable();
          return written;
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;destroy();reject(unavailable());},14000);}),
      ]);
    }catch(error){
      if(inTransaction&&!released)try{await client.query('rollback');}catch{}
      destroy();const safe=unavailable();
      if(['42501','23505','22023','22P02','22003','22008','54000'].includes(error?.code))safe.code=error.code;
      throw safe;
    }finally{
      clearTimeout(timer);release(false);clients.delete(destroy);counts[kind]--;
    }
  };
  try {
    const DriverPool=Pool??(await import('pg')).Pool;
    for(const kind of ['runtime','issuer']) {
      pools[kind]=new DriverPool(configs[kind]);
      pools[kind].on('error',()=>{healthy=false;});
    }
    for(const kind of ['runtime','issuer']) {
      pools[`${kind}Template`]=new DriverPool({...configs[kind],database:'template1',application_name:`blackspire-buyer-writer-${kind}-template-attestation`,max:1});
      pools[`${kind}Template`].on('error',()=>{healthy=false;});
    }
    await run('runtime',null,null,true);await run('issuer',null,null,true);
    return Object.freeze({runtimeQuery:(text,values)=>run('runtime',text,values),issuerQuery:(text,values)=>run('issuer',text,values),isHealthy:()=>!closed&&healthy,close});
  }catch{
    await close();throw unavailable();
  }
}
