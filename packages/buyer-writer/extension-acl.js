import {EXTENSION_ACL_CATALOG_SQL} from './extension-acl-catalog.js';
import {BUYER_WRITER_ROUTINES} from './routine-policy.js';
const writers=['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'];
const functions=['_await_response','_encode_url_with_params_array','_http_collect_response','_urlencode_string','check_worker_is_up','http_collect_response','http_delete','http_get','http_post','wait_until_running','wake','worker_restart'];
const privileges=o=>o.kind==='function'?['EXECUTE']:o.kind==='S'?['SELECT','UPDATE','USAGE']:['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'];
const key=e=>JSON.stringify([e.grantor,e.grantee,e.privilege]);

const identifier=s=>typeof s==='string'&&/^[a-z_][a-z0-9_]{0,62}$/.test(s);

// Offline operator tooling. The emitted files still require independent review,
// isolated rehearsal and a provider-controlled no-concurrent-admin-change window.
// No credentials, database connection, environment discovery or SQL execution.
export function prepareBuyerWriterExtensionAcl(input){
 try{
  if(Buffer.byteLength(JSON.stringify(input))>2*1024*1024)throw new Error();
  const {inventory,columns,effective}=JSON.parse(JSON.stringify(input));
  const baseline=Object.fromEntries(['database','serverVersion','roles','memberships','extensions','schemas','objects'].map(k=>[k,inventory[k]]));
  baseline.columns=columns.columns;
  if(typeof baseline.serverVersion!=='string'||baseline.serverVersion.length>256||!/^17\./.test(baseline.serverVersion)||!identifier(baseline.database)||!Array.isArray(baseline.roles)||baseline.roles.length<1||baseline.roles.length>128
   ||!Array.isArray(baseline.objects)||baseline.objects.length!==17||!Array.isArray(baseline.columns)||baseline.columns.length>512)throw new Error();
  const roles=baseline.roles.map(r=>r.name);
  if(new Set(roles).size!==roles.length||roles.some(r=>!identifier(r)||writers.includes(r))||!roles.includes('postgres')||!roles.includes('supabase_admin'))throw new Error();
  const names=new Set(),objectIds=new Set();let addedEdges=0,publicEdges=0;
  const objects=baseline.objects.map(o=>{
   const name=o.schema+'.'+o.name;
   const kind=o.schema==='extensions'&&['pg_stat_statements','pg_stat_statements_info'].includes(o.name)?'v':o.schema==='net'
    ?functions.includes(o.name)?'function':['_http_response','http_request_queue'].includes(o.name)?'r':o.name==='http_request_queue_id_seq'?'S':null:null;
   if(kind===null||kind!==o.kind||names.has(name)||!/^\d+$/.test(String(o.oid))||objectIds.has(String(o.oid))
    ||o.owner!==(o.schema==='net'?'supabase_admin':'postgres')||!Array.isArray(o.edges)||o.edges.length>1024)throw new Error();
   names.add(name);objectIds.add(String(o.oid));
   if(o.kind==='function'?(typeof o.arguments!=='string'||!/^[a-f0-9]{32}$/.test(o.definitionDigest)||o.securityDefiner!==false):o.arguments!==null)throw new Error();
   const seen=new Set(),before=o.edges,added=[];
   for(const e of before){
    if(Object.keys(e).sort().join(',')!=='grantable,grantee,grantor,privilege'||!roles.includes(e.grantor)
     ||!(roles.includes(e.grantee)||e.grantee==='PUBLIC')||!privileges(o).includes(e.privilege)||typeof e.grantable!=='boolean'||seen.has(key(e)))throw new Error();
    seen.add(key(e));
   }
   const publicGrants=before.filter(e=>e.grantee==='PUBLIC');
   if(!publicGrants.length||publicGrants.some(e=>e.grantor!==o.owner||e.grantable))throw new Error();
   for(const e of publicGrants)for(const role of roles){
    const addition={grantor:o.owner,grantee:role,privilege:e.privilege,grantable:false};
    if(!seen.has(key(addition))){added.push(addition);seen.add(key(addition));}
   }
   addedEdges+=added.length;publicEdges+=publicGrants.length;
   return{...o,before,after:[...before.filter(e=>e.grantee!=='PUBLIC'),...added],added,publicGrants};
  });
  const relationNames=new Set(objects.filter(o=>['r','v'].includes(o.kind)).map(o=>o.schema+'.'+o.name)),columnKeys=new Set(),columnRelations=new Set();
  for(const c of baseline.columns){
   const relation=c.schema+'.'+c.table,k=relation+':'+c.number;
   if(!relationNames.has(relation)||!Number.isInteger(c.number)||c.number<1||columnKeys.has(k)||c.aclIsNull!==true||!Array.isArray(c.edges)||c.edges.length)throw new Error();
   columnKeys.add(k);columnRelations.add(relation);
  }
  if(columnRelations.size!==4)throw new Error();
  const expected=new Set(roles.flatMap(r=>objects.flatMap(o=>privileges(o).map(p=>JSON.stringify([r,o.schema,o.name,o.kind,o.arguments,p])))));
  if(!Array.isArray(effective.effective)||effective.effective.length!==expected.size)throw new Error();
  for(const row of effective.effective){if(!Array.isArray(row)||row.length!==8||typeof row[6]!=='boolean'||typeof row[7]!=='boolean'||!expected.delete(JSON.stringify(row.slice(0,6))))throw new Error();}
  const schemas=new Set(roles.flatMap(r=>['extensions','net'].map(s=>JSON.stringify([r,s]))));
  if(!Array.isArray(effective.schemaEffective)||effective.schemaEffective.length!==schemas.size)throw new Error();
  for(const row of effective.schemaEffective){if(!Array.isArray(row)||row.length!==4||typeof row[2]!=='boolean'||typeof row[3]!=='boolean'||!schemas.delete(JSON.stringify(row.slice(0,2))))throw new Error();}
  const manifest={version:1,baseline,objects,addedEdges,publicEdges,effective:effective.effective,schemaEffective:effective.schemaEffective};
  return{manifest,applySql:transaction(manifest,false),rollbackSql:transaction(manifest,true)};
 }catch{throw new Error('Buyer writer extension ACL capture rejected');}
}

// Read-only post-provider assertion for a separately reviewed application
// transaction. It cannot grant/revoke or assume provider authority. Revalidate
// untrusted manifests through the same generator before embedding any data.
export function buyerWriterExtensionPostcondition(manifest,creatorOid){
 if(!Number.isInteger(creatorOid)||creatorOid<1||creatorOid>4294967295)throw new Error('ACL manifest drift');
 const checked=prepareBuyerWriterExtensionAcl({inventory:manifest.baseline,columns:manifest.baseline,
  effective:{effective:manifest.effective,schemaEffective:manifest.schemaEffective}}).manifest;
 if(JSON.stringify(checked)!==JSON.stringify(manifest))throw new Error('ACL manifest drift');
 return transaction(checked,false,true,creatorOid);
}

function transaction(manifest,rollback,verifyOnly=false,expectedCreatorOid){
 const serialized=JSON.stringify(manifest);
 let dataDelimiter='$zola_manifest$';
 for(let n=1;serialized.includes(dataDelimiter);n++)dataDelimiter=`$zola_manifest_${n}$`;
 let delimiter='$zola_acl$';
 for(let n=1;serialized.includes(delimiter);n++)delimiter=`$zola_acl_${n}$`;
 return `${verifyOnly?'':`-- Review/rehearse first. Run standalone in a provider-controlled window
-- excluding concurrent ACL, role and extension changes. No network functions run.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';`}
DO ${delimiter}
DECLARE
 m jsonb:=${dataDelimiter}${serialized}${dataDelimiter}::jsonb;
 routine_policy jsonb:=$zola_routine_policy$${JSON.stringify(BUYER_WRITER_ROUTINES)}$zola_routine_policy$::jsonb;
 observed_catalog jsonb; base jsonb:=m->'baseline'; observed jsonb; obj jsonb; edge jsonb; item jsonb;
 before_ok boolean; after_ok boolean; change_needed boolean; allowed boolean; grantable boolean;
 initial_role text:=current_user; target text; target_oid oid; phase integer; writer_name text;
 rollback_mode boolean:=${rollback};
BEGIN
 ${verifyOnly?`IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))<>3 THEN
  RAISE EXCEPTION 'All scoped writer roles required';
 END IF;`: `IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname=session_user),false) THEN
  RAISE EXCEPTION 'Provider session authority required';
 END IF;`}
 IF rollback_mode AND (EXISTS(SELECT FROM pg_roles WHERE rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') AND rolcanlogin)
  OR EXISTS(SELECT FROM pg_stat_activity WHERE usename IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))) THEN
  RAISE EXCEPTION 'Writer identities must be disabled and drained before ACL rollback';
 END IF;
 FOR phase IN 0..1 LOOP
  ${EXTENSION_ACL_CATALOG_SQL.replace(') as metadata', ') INTO observed_catalog')};
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')) NOT IN (0,3) THEN
   RAISE EXCEPTION 'All scoped writer roles required';
  END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')
   AND (rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR (rolname='buyer_writer_owner' AND rolcanlogin))) THEN
   RAISE EXCEPTION 'Writer role drift';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))=3 THEN
   IF (CASE WHEN left(obj_description((SELECT oid FROM pg_namespace WHERE nspname='buyer_writer'),'pg_namespace'),length('blackspire-buyer-writer:v2:'))='blackspire-buyer-writer:v2:' THEN
       substring(obj_description((SELECT oid FROM pg_namespace WHERE nspname='buyer_writer'),'pg_namespace') FROM length('blackspire-buyer-writer:v2:')+1)::jsonb IS DISTINCT FROM
        (SELECT jsonb_build_object('creatorOid',${expectedCreatorOid===undefined?`(SELECT datdba::text FROM pg_database WHERE datname=current_database())`:`${expectedCreatorOid}::text`},'relations',jsonb_agg(jsonb_build_object(
          'schema',expected.schema_name,'name',expected.relation_name,'oid',c.oid::text,'relkind',c.relkind,
          'relowner',c.relowner::text,'relispartition',c.relispartition,'relpersistence',c.relpersistence,
          'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity,
          'parentOids',coalesce((SELECT jsonb_agg(i.inhparent::text ORDER BY i.inhparent) FROM pg_inherits i WHERE i.inhrelid=c.oid),'[]'::jsonb)
         ) ORDER BY expected.schema_name,expected.relation_name))
         FROM (VALUES('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
          ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales')) expected(schema_name,relation_name)
         LEFT JOIN pg_namespace n ON n.nspname=expected.schema_name
         LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.relation_name)
       ELSE true END) THEN
    RAISE EXCEPTION 'Writer relation identity drift';
   END IF;
   IF EXISTS(SELECT FROM pg_inherits i JOIN pg_class c ON c.oid IN (i.inhparent,i.inhrelid)
       JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (
        ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
        ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'))) THEN
    RAISE EXCEPTION 'Writer relation inheritance drift';
   END IF;
   IF (SELECT count(*) FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid
       WHERE r.rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')) NOT BETWEEN 3 AND 4
    OR (SELECT count(DISTINCT r.rolname) FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid
       WHERE r.rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') AND a.admin_option AND NOT a.inherit_option
       AND (r.rolname='buyer_writer_owner' OR NOT a.set_option) AND a.grantor=10
       AND coalesce((SELECT rolsuper FROM pg_roles WHERE oid=10),false))<>3
    OR NOT EXISTS(SELECT FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles u ON u.oid=a.member
       WHERE r.rolname='buyer_writer_owner' AND u.rolname='postgres'
       ${expectedCreatorOid===undefined?'':`AND u.oid=${expectedCreatorOid}::oid`}
       AND u.oid=(SELECT datdba FROM pg_database WHERE datname=current_database())
       AND CASE WHEN left(obj_description((SELECT oid FROM pg_namespace WHERE nspname='buyer_writer'),'pg_namespace'),length('blackspire-buyer-writer:v2:'))='blackspire-buyer-writer:v2:' THEN
        substring(obj_description((SELECT oid FROM pg_namespace WHERE nspname='buyer_writer'),'pg_namespace') FROM length('blackspire-buyer-writer:v2:')+1)::jsonb=
         (SELECT jsonb_build_object('creatorOid',u.oid::text,'relations',jsonb_agg(jsonb_build_object(
           'schema',expected.schema_name,'name',expected.relation_name,'oid',c.oid::text,'relkind',c.relkind,
           'relowner',c.relowner::text,'relispartition',c.relispartition,'relpersistence',c.relpersistence,
           'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity,
           'parentOids',coalesce((SELECT jsonb_agg(i.inhparent::text ORDER BY i.inhparent) FROM pg_inherits i WHERE i.inhrelid=c.oid),'[]'::jsonb)
          ) ORDER BY expected.schema_name,expected.relation_name))
          FROM (VALUES('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
           ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales')) expected(schema_name,relation_name)
          LEFT JOIN pg_namespace n ON n.nspname=expected.schema_name
          LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.relation_name)
        ELSE false END
       AND NOT a.inherit_option AND a.set_option)
    OR EXISTS(SELECT FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles u ON u.oid=a.member
       WHERE (r.rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') OR u.rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))
       AND NOT (r.rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') AND u.rolname='postgres'
        ${expectedCreatorOid===undefined?'':`AND u.oid=${expectedCreatorOid}::oid`}
        AND u.oid=(SELECT datdba FROM pg_database WHERE datname=current_database()) AND NOT a.inherit_option
        AND ((a.admin_option AND NOT a.set_option AND a.grantor=10 AND coalesce((SELECT rolsuper FROM pg_roles WHERE oid=10),false))
         OR (r.rolname='buyer_writer_owner' AND a.set_option AND pg_get_userbyid(a.grantor)='postgres')))) THEN
    RAISE EXCEPTION 'Trusted writer bootstrap relationship required';
   END IF;
   IF EXISTS(SELECT FROM pg_namespace n CROSS JOIN (VALUES('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
       WHERE n.nspname !~ '^pg_temp' AND has_schema_privilege(w.role_name,n.oid,'CREATE')
       AND NOT (w.role_name='buyer_writer_owner' AND n.nspname='buyer_writer')) THEN
    RAISE EXCEPTION 'Unexpected writer schema CREATE privilege';
   END IF;
   IF EXISTS(SELECT FROM (VALUES('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
       WHERE has_database_privilege(w.role_name,current_database(),'CREATE')) THEN
    RAISE EXCEPTION 'Unexpected writer database CREATE privilege';
   END IF;
   IF EXISTS(SELECT FROM pg_database d CROSS JOIN (VALUES('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
       WHERE d.datname<>current_database() AND d.datallowconn AND has_database_privilege(w.role_name,d.oid,'CONNECT')) THEN
    RAISE EXCEPTION 'Unexpected writer cross-database CONNECT privilege';
   END IF;
   IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
       WHERE n.nspname='public' AND c.relname IN ('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
       AND c.relkind IN ('r','p') AND a.grantee=0
       AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
    OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute x ON x.attrelid=c.oid
       CROSS JOIN LATERAL aclexplode(x.attacl) a
       WHERE n.nspname='public' AND c.relname IN ('SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport')
       AND c.relkind IN ('r','p') AND x.attnum>0 AND NOT x.attisdropped AND x.attacl IS NOT NULL AND a.grantee=0
       AND a.privilege_type IN ('SELECT','INSERT','UPDATE','REFERENCES')) THEN
    RAISE EXCEPTION 'Unexpected target PUBLIC privileges';
   END IF;
   IF EXISTS(WITH RECURSIVE protected(oid) AS (
       SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (
        ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
        ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'))
       UNION SELECT i.inhrelid FROM pg_inherits i JOIN protected p ON p.oid=i.inhparent)
       SELECT FROM protected p JOIN pg_trigger t ON t.tgrelid=p.oid WHERE NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'Unexpected Buyer Writer relation trigger';
   END IF;
   IF EXISTS(WITH RECURSIVE protected(oid) AS (
       SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (
        ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
        ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'))
       UNION SELECT i.inhrelid FROM pg_inherits i JOIN protected p ON p.oid=i.inhparent)
       SELECT FROM protected p JOIN pg_class c ON c.oid=p.oid JOIN pg_rewrite r ON r.ev_class=p.oid
       WHERE NOT (r.rulename='_RETURN' AND c.relkind IN ('v','m') AND r.ev_type='1' AND r.is_instead)) THEN
    RAISE EXCEPTION 'Unexpected Buyer Writer relation rewrite rule';
   END IF;
   IF EXISTS(WITH RECURSIVE protected(oid) AS (
       SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (
        ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
        ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'))
       UNION SELECT i.inhrelid FROM pg_inherits i JOIN protected p ON p.oid=i.inhparent),
      expression_objects(classid,objid) AS (
       SELECT 'pg_constraint'::regclass,co.oid FROM pg_constraint co JOIN protected p ON p.oid=co.conrelid WHERE co.conbin IS NOT NULL
       UNION SELECT 'pg_attrdef'::regclass,a.oid FROM pg_attrdef a JOIN protected p ON p.oid=a.adrelid
       UNION SELECT 'pg_policy'::regclass,po.oid FROM pg_policy po JOIN protected p ON p.oid=po.polrelid
       UNION SELECT 'pg_class'::regclass,i.indexrelid FROM pg_index i JOIN protected p ON p.oid=i.indrelid WHERE i.indexprs IS NOT NULL OR i.indpred IS NOT NULL),
      dependency_walk(rootclassid,rootobjid,classid,objid,depth) AS (
       SELECT classid,objid,classid,objid,0 FROM expression_objects
       UNION SELECT w.rootclassid,w.rootobjid,d.refclassid,d.refobjid,w.depth+1 FROM dependency_walk w JOIN pg_depend d ON d.classid=w.classid AND d.objid=w.objid
        WHERE w.depth<4 AND (w.depth=0 OR w.classid IN ('pg_operator'::regclass,'pg_cast'::regclass,'pg_type'::regclass)))
      SELECT FROM dependency_walk w JOIN pg_proc p ON w.classid='pg_proc'::regclass AND p.oid=w.objid JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname<>'pg_catalog' AND NOT (n.nspname='auth' AND p.proname='uid' AND p.pronargs=0 AND p.prorettype='uuid'::regtype
       AND w.rootclassid='pg_policy'::regclass AND EXISTS(SELECT FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid JOIN pg_namespace pn ON pn.oid=c.relnamespace
        WHERE po.oid=w.rootobjid AND pn.nspname='public' AND c.relname='SearchJob' AND po.polname='user_read_own_search_jobs' AND po.polcmd='r'
         AND po.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]))) THEN
    RAISE EXCEPTION 'Unexpected protected expression routine';
   END IF;
   IF EXISTS(WITH RECURSIVE protected(oid) AS (
       SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (
        ('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
        ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales'))
       UNION SELECT i.inhrelid FROM pg_inherits i JOIN protected p ON p.oid=i.inhparent)
      SELECT FROM protected p JOIN pg_attribute a ON a.attrelid=p.oid JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname<>'pg_catalog') THEN
    RAISE EXCEPTION 'Unexpected protected column type';
   END IF;
   IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN (VALUES('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
       WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'
       AND has_schema_privilege(w.role_name,n.oid,'USAGE')
       AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
        has_table_privilege(w.role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') ELSE false END
       AND NOT (w.role_name='buyer_writer_owner' AND n.nspname='buyer_writer')) THEN
    RAISE EXCEPTION 'Unexpected writer relation privilege';
   END IF;
   IF EXISTS(SELECT FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN (VALUES('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
       CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privilege(name)
       WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')
       AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'
       AND has_schema_privilege(w.role_name,n.oid,'USAGE')
       AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_column_privilege(w.role_name,c.oid,a.attnum,privilege.name) ELSE false END
       AND NOT (w.role_name='buyer_writer_owner' AND (n.nspname='buyer_writer' OR (n.nspname='public' AND CASE
        WHEN c.relname='SearchJob' THEN (privilege.name='SELECT' AND a.attname=ANY(ARRAY['id','user_id','state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only','status','updated_at'])) OR (privilege.name='UPDATE' AND a.attname=ANY(ARRAY['status','total_sales_analyzed','total_buyers_found','error_message','updated_at']))
        WHEN c.relname IN ('RawSale','CleanSale') THEN privilege.name='INSERT' AND a.attname=ANY(ARRAY['search_job_id','buyer_name','seller_name','property_address','mailing_address','county','state','sale_price','sale_date','property_type','parcel_id','deed_type','lender_name'])
        WHEN c.relname='BuyerProfile' THEN (privilege.name='SELECT' AND a.attname=ANY(ARRAY['id','buyer_name','mailing_address','county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at'])) OR (privilege.name='INSERT' AND a.attname=ANY(ARRAY['buyer_name','mailing_address','county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at'])) OR (privilege.name='UPDATE' AND a.attname=ANY(ARRAY['county','state','is_llc','is_cash_buyer','purchase_count','total_spend','first_purchase_date','last_purchase_date','property_types','score','score_breakdown','parcel_ids','updated_at']))
        WHEN c.relname='BuyerReport' THEN privilege.name='INSERT' AND a.attname=ANY(ARRAY['search_job_id','buyer_profile_id','buyer_name_snapshot','mailing_address_snapshot','score','purchase_count','total_spend','is_llc','is_cash_buyer'])
        ELSE false END)))) THEN
    RAISE EXCEPTION 'Unexpected writer relation privilege';
   END IF;
   IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN (VALUES('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
       WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'
       AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(w.role_name,c.oid,'SELECT,UPDATE,USAGE') ELSE false END
       AND NOT (w.role_name='buyer_writer_owner' AND n.nspname='buyer_writer')) THEN
    RAISE EXCEPTION 'Unexpected writer sequence privilege';
   END IF;
   IF EXISTS(SELECT FROM jsonb_to_recordset(routine_policy) expected(signature text,digest text,language text,"securityDefiner" boolean,config text[],volatility text,owner text,arguments text[],result text)
       LEFT JOIN pg_namespace pn ON pn.nspname='buyer_writer'
       LEFT JOIN pg_proc p ON p.pronamespace=pn.oid AND p.oid::regprocedure::text=expected.signature
       LEFT JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid IS NULL OR p.proowner<>CASE WHEN expected.owner='creator' THEN ${expectedCreatorOid===undefined?`(SELECT datdba FROM pg_database WHERE datname=current_database())`:`${expectedCreatorOid}::oid`} ELSE (SELECT oid FROM pg_roles WHERE rolname='buyer_writer_owner') END
       OR p.prosecdef IS DISTINCT FROM expected."securityDefiner" OR l.lanname IS DISTINCT FROM expected.language
       OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.digest
       OR p.proconfig IS DISTINCT FROM expected.config OR p.provolatile::text IS DISTINCT FROM expected.volatility
       OR coalesce(p.proargnames,'{}'::text[]) IS DISTINCT FROM expected.arguments OR p.prorettype::regtype::text IS DISTINCT FROM expected.result
       OR p.pronargdefaults<>0 OR p.proretset OR p.provariadic<>0 OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
       OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u') THEN
    RAISE EXCEPTION 'Writer routine definition drift';
   END IF;
   IF (SELECT array_agg(ARRAY[a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable::text] ORDER BY a.grantee,a.privilege_type,a.grantor,a.is_grantable)
       FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='buyer_writer') IS DISTINCT FROM
      (SELECT array_agg(ARRAY[edge.grantor::text,edge.grantee::text,edge.privilege,edge.grantable::text] ORDER BY edge.grantee,edge.privilege,edge.grantor,edge.grantable)
       FROM (VALUES
        ((SELECT oid FROM pg_roles WHERE rolname='buyer_writer_owner'),(SELECT oid FROM pg_roles WHERE rolname='buyer_writer_owner'),'CREATE',false),
        ((SELECT oid FROM pg_roles WHERE rolname='buyer_writer_owner'),(SELECT oid FROM pg_roles WHERE rolname='buyer_writer_owner'),'USAGE',false),
        ((SELECT oid FROM pg_roles WHERE rolname='buyer_writer_owner'),(SELECT oid FROM pg_roles WHERE rolname='buyer_writer_runtime'),'USAGE',false),
        ((SELECT oid FROM pg_roles WHERE rolname='buyer_writer_owner'),(SELECT oid FROM pg_roles WHERE rolname='buyer_writer_issuer'),'USAGE',false)
       ) edge(grantor,grantee,privilege,grantable))
    OR EXISTS(SELECT FROM jsonb_to_recordset(routine_policy) expected(signature text)
       JOIN pg_namespace pn ON pn.nspname='buyer_writer'
       JOIN pg_proc p ON p.pronamespace=pn.oid AND p.oid::regprocedure::text=expected.signature
       CROSS JOIN LATERAL (SELECT array_agg(ARRAY[a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable::text] ORDER BY a.grantee,a.privilege_type,a.grantor,a.is_grantable)
        FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) actual(edges)
       CROSS JOIN LATERAL (SELECT array_agg(ARRAY[p.proowner::text,g.oid::text,'EXECUTE','false'] ORDER BY g.oid,p.proowner)
        FROM pg_roles g WHERE g.oid=p.proowner
         OR (expected.signature='buyer_writer.lock_public_scope()' AND g.rolname='buyer_writer_owner')
         OR (expected.signature IN ('buyer_writer.lock_scope()','buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)','buyer_writer.context(text,text,uuid,uuid,bigint)') AND g.rolname='buyer_writer_runtime')
         OR (expected.signature IN ('buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)') AND g.rolname='buyer_writer_issuer')) reviewed(edges)
       WHERE actual.edges IS DISTINCT FROM reviewed.edges) THEN
    RAISE EXCEPTION 'Writer schema or routine ACL drift';
   END IF;
   IF NOT has_schema_privilege('buyer_writer_runtime','buyer_writer','USAGE')
    OR NOT has_schema_privilege('buyer_writer_issuer','buyer_writer','USAGE')
    OR EXISTS(SELECT FROM unnest(ARRAY['buyer_writer.lock_scope()','buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)','buyer_writer.context(text,text,uuid,uuid,bigint)']) s
       LEFT JOIN pg_proc p ON p.oid::regprocedure::text=s
        AND p.pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='buyer_writer')
       WHERE p.oid IS NULL OR NOT has_function_privilege('buyer_writer_runtime',p.oid,'EXECUTE'))
    OR EXISTS(SELECT FROM unnest(ARRAY['buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)']) s
       LEFT JOIN pg_proc p ON p.oid::regprocedure::text=s
        AND p.pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='buyer_writer')
       WHERE p.oid IS NULL OR NOT has_function_privilege('buyer_writer_issuer',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'Writer entrypoint privilege drift';
   END IF;
   IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       CROSS JOIN (VALUES('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')) w(role_name)
       WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_temp' AND p.prorettype<>'event_trigger'::regtype
       AND has_schema_privilege(w.role_name,n.oid,'USAGE') AND has_function_privilege(w.role_name,p.oid,'EXECUTE')
       AND NOT (
        (w.role_name='buyer_writer_owner' AND p.oid::regprocedure::text IN
          (SELECT x.signature FROM jsonb_to_recordset(routine_policy) x(signature text)))
        OR (w.role_name='buyer_writer_runtime' AND p.oid::regprocedure::text IN
          ('buyer_writer.lock_scope()','buyer_writer.apply(text,text,jsonb)','buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)','buyer_writer.context(text,text,uuid,uuid,bigint)'))
        OR (w.role_name='buyer_writer_issuer' AND p.oid::regprocedure::text IN
          ('buyer_writer.lock_scope()','buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)','buyer_writer.cancel(uuid,uuid,text)','buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)'))
       )) THEN
    RAISE EXCEPTION 'Unexpected reachable writer routine';
   END IF;
  END IF;
  observed_catalog:=jsonb_set(observed_catalog,'{roles}',(SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(observed_catalog->'roles') WITH ORDINALITY t(value,ord)
   WHERE value->>'name' NOT IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')));
  observed_catalog:=jsonb_set(observed_catalog,'{memberships}',(SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(observed_catalog->'memberships') WITH ORDINALITY t(value,ord)
   WHERE value->>'role' NOT IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') AND value->>'member' NOT IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')));
  IF (observed_catalog-'objects') IS DISTINCT FROM (base-'objects') OR jsonb_array_length(observed_catalog->'objects')<>17 THEN
   RAISE EXCEPTION 'ACL catalog preconditions changed';
  END IF;
  before_ok:=true;after_ok:=true;
  FOR obj IN SELECT value FROM jsonb_array_elements(m->'objects') LOOP
   SELECT value INTO observed FROM jsonb_array_elements(observed_catalog->'objects') WHERE value->>'oid'=obj->>'oid';
   IF observed IS NULL OR (observed-'edges') IS DISTINCT FROM (obj-ARRAY['edges','before','after','added','publicGrants']) THEN
    RAISE EXCEPTION 'ACL object identity changed';
   END IF;
   before_ok:=before_ok AND ((observed->'edges') @> (obj->'before')) AND ((observed->'edges') <@ (obj->'before')) AND jsonb_array_length(observed->'edges')=jsonb_array_length(obj->'before');
   after_ok:=after_ok AND ((observed->'edges') @> (obj->'after')) AND ((observed->'edges') <@ (obj->'after')) AND jsonb_array_length(observed->'edges')=jsonb_array_length(obj->'after');
  END LOOP;
  IF phase=0 THEN
   IF NOT before_ok AND NOT after_ok THEN RAISE EXCEPTION 'Partial or unexpected ACL state';END IF;
   ${verifyOnly?`IF NOT (before_ok OR after_ok) THEN RAISE EXCEPTION 'Provider ACL baseline or replacement required';END IF;
   change_needed:=false;`:'change_needed:=CASE WHEN rollback_mode THEN after_ok ELSE before_ok END;'}
  ELSIF ${verifyOnly?'NOT (before_ok OR after_ok)':'NOT (CASE WHEN rollback_mode THEN before_ok ELSE after_ok END)'} THEN RAISE EXCEPTION 'ACL result verification failed';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(m->'effective') LOOP
   SELECT (value->>'oid')::oid INTO target_oid FROM jsonb_array_elements(base->'objects') WHERE value->>'schema'=item->>1 AND value->>'name'=item->>2;
   IF item->>3='function' THEN
    allowed:=has_function_privilege(item->>0,target_oid,item->>5);grantable:=has_function_privilege(item->>0,target_oid,(item->>5)||' WITH GRANT OPTION');
   ELSIF item->>3='S' THEN
    allowed:=has_sequence_privilege(item->>0,target_oid,item->>5);grantable:=has_sequence_privilege(item->>0,target_oid,(item->>5)||' WITH GRANT OPTION');
   ELSE
    allowed:=has_table_privilege(item->>0,target_oid,item->>5);grantable:=has_table_privilege(item->>0,target_oid,(item->>5)||' WITH GRANT OPTION');
   END IF;
   IF allowed IS DISTINCT FROM (item->>6)::boolean OR grantable IS DISTINCT FROM (item->>7)::boolean THEN RAISE EXCEPTION 'Consumer privilege changed';END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(m->'schemaEffective') LOOP
   IF has_schema_privilege(item->>0,item->>1,'USAGE') IS DISTINCT FROM (item->>2)::boolean
    OR has_schema_privilege(item->>0,item->>1,'CREATE') IS DISTINCT FROM (item->>3)::boolean THEN RAISE EXCEPTION 'Consumer schema privilege changed';END IF;
  END LOOP;
  IF phase=1 AND NOT rollback_mode THEN
   FOR writer_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') LOOP
    FOR obj IN SELECT value FROM jsonb_array_elements(m->'objects') LOOP
     target_oid:=(obj->>'oid')::oid;
     -- Object ACLs inherited from PUBLIC or another role are authority only
     -- when the writer can also resolve the containing schema. This permits a
     -- provider to retain unreachable defaults without granting Buyer Writer a
     -- database or network capability.
     IF (CASE WHEN obj->>'kind'='S' THEN has_sequence_privilege(writer_name,target_oid,'SELECT,UPDATE,USAGE')
      WHEN obj->>'kind'='function' THEN has_schema_privilege(writer_name,obj->>'schema','USAGE') AND has_function_privilege(writer_name,target_oid,'EXECUTE')
      ELSE has_schema_privilege(writer_name,obj->>'schema','USAGE') AND (has_table_privilege(writer_name,target_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(writer_name,target_oid,'SELECT,INSERT,UPDATE,REFERENCES')) END) THEN
      RAISE EXCEPTION 'Unexpected writer extension privilege';
     END IF;
    END LOOP;
   END LOOP;
  END IF;
  ${verifyOnly?'':`IF phase=0 AND change_needed THEN
   FOR obj IN SELECT value FROM jsonb_array_elements(m->'objects') LOOP
    EXECUTE format('SET LOCAL ROLE %I',obj->>'owner');
    target:=CASE WHEN obj->>'kind'='function' THEN 'FUNCTION '||((obj->>'oid')::oid)::regprocedure::text
     WHEN obj->>'kind'='S' THEN format('SEQUENCE %I.%I',obj->>'schema',obj->>'name') ELSE format('TABLE %I.%I',obj->>'schema',obj->>'name') END;
    FOR edge IN SELECT value FROM jsonb_array_elements(CASE WHEN rollback_mode THEN obj->'publicGrants' ELSE obj->'added' END) LOOP
     EXECUTE format('GRANT %s ON %s TO %s',edge->>'privilege',target,CASE WHEN edge->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(edge->>'grantee') END);
    END LOOP;
    FOR edge IN SELECT value FROM jsonb_array_elements(CASE WHEN rollback_mode THEN obj->'added' ELSE obj->'publicGrants' END) LOOP
     EXECUTE format('REVOKE %s ON %s FROM %s RESTRICT',edge->>'privilege',target,CASE WHEN edge->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(edge->>'grantee') END);
    END LOOP;
    EXECUTE format('SET LOCAL ROLE %I',initial_role);
   END LOOP;
  END IF;`}
 END LOOP;
END ${delimiter};
${verifyOnly?'':'COMMIT;'}
`;
}
