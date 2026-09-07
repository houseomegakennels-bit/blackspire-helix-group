import {EXTENSION_ACL_CATALOG_SQL} from './extension-acl-catalog.js';
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
export function buyerWriterExtensionPostcondition(manifest){
 const checked=prepareBuyerWriterExtensionAcl({inventory:manifest.baseline,columns:manifest.baseline,
  effective:{effective:manifest.effective,schemaEffective:manifest.schemaEffective}}).manifest;
 if(JSON.stringify(checked)!==JSON.stringify(manifest))throw new Error('ACL manifest drift');
 return transaction(checked,false,true);
}

function transaction(manifest,rollback,verifyOnly=false){
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
 FOR phase IN 0..1 LOOP
  ${EXTENSION_ACL_CATALOG_SQL.replace(') as metadata', ') INTO observed_catalog')};
  IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')
   AND (rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR (rolname='buyer_writer_owner' AND rolcanlogin))) THEN
   RAISE EXCEPTION 'Writer role drift';
  END IF;
  IF EXISTS(SELECT FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles u ON u.oid=a.member
   WHERE (r.rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') OR u.rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))
   AND NOT (r.rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') AND u.rolname='postgres'
    AND ((a.admin_option AND NOT a.inherit_option AND NOT a.set_option)
     OR (r.rolname='buyer_writer_owner' AND NOT a.admin_option AND a.inherit_option AND a.set_option AND pg_get_userbyid(a.grantor)='postgres')))) THEN
   RAISE EXCEPTION 'Writer membership drift';
  END IF;
  IF rollback_mode AND (EXISTS(SELECT FROM pg_roles WHERE rolname IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') AND rolcanlogin)
   OR EXISTS(SELECT FROM pg_stat_activity WHERE usename IN ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'))) THEN
   RAISE EXCEPTION 'Writer identities must be disabled and drained before ACL rollback';
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
   ${verifyOnly?`IF NOT after_ok THEN RAISE EXCEPTION 'Provider ACL poststate required';END IF;
   change_needed:=false;`:'change_needed:=CASE WHEN rollback_mode THEN after_ok ELSE before_ok END;'}
  ELSIF NOT (CASE WHEN rollback_mode THEN before_ok ELSE after_ok END) THEN RAISE EXCEPTION 'ACL result verification failed';
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
     IF (CASE WHEN obj->>'kind'='function' THEN has_function_privilege(writer_name,target_oid,'EXECUTE')
      WHEN obj->>'kind'='S' THEN has_sequence_privilege(writer_name,target_oid,'SELECT,UPDATE,USAGE')
      ELSE has_table_privilege(writer_name,target_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(writer_name,target_oid,'SELECT,INSERT,UPDATE,REFERENCES') END) THEN
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
