// Fixed, read-only production catalog observation. This statement never reads
// pg_authid, password hashes, settings containing credentials, or application
// rows. The provisioner runs it in the same transaction as role reconciliation.
export const BUYER_WRITER_PRODUCTION_VERIFY_SQL=`with
writer_roles(name) as (values ('buyer_writer_owner'),('buyer_writer_runtime'),('buyer_writer_issuer')),
expected_net(name) as (values
 ('_await_response'),('_encode_url_with_params_array'),('_http_collect_response'),('_urlencode_string'),
 ('check_worker_is_up'),('http_collect_response'),('http_delete'),('http_get'),('http_post'),
 ('wait_until_running'),('wake'),('worker_restart')),
role_state as (
 select r.rolname as name,r.rolcanlogin as login,r.rolinherit as inherit,r.rolsuper as superuser,
  r.rolcreatedb as "createDb",r.rolcreaterole as "createRole",r.rolreplication as replication,r.rolbypassrls as "bypassRls"
 from pg_roles r join writer_roles w on w.name=r.rolname
), membership_state as (
 select pg_get_userbyid(m.roleid) as role,pg_get_userbyid(m.member) as member,pg_get_userbyid(m.grantor) as grantor,
  m.admin_option as admin,m.inherit_option as inherit,m.set_option as "set"
 from pg_auth_members m where pg_get_userbyid(m.roleid) in(select name from writer_roles)
  or pg_get_userbyid(m.member) in(select name from writer_roles)
), schema_state as (
 select n.oid,n.nspname as name,pg_get_userbyid(n.nspowner) as owner,
  coalesce((select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
   'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type)
   from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a),'[]'::jsonb) as edges
 from pg_namespace n where n.nspname='buyer_writer'
), routine_state as (
 select p.oid,p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,p.prosecdef as "securityDefiner",
  coalesce(p.proconfig @> array['search_path=pg_catalog'],false) as "searchPathLocked",
  coalesce((select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
   'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type)
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb) as edges,
  has_function_privilege('buyer_writer_runtime',p.oid,'EXECUTE') as "runtimeExecute",
  has_function_privilege('buyer_writer_runtime',p.oid,'EXECUTE WITH GRANT OPTION') as "runtimeGrant",
  has_function_privilege('buyer_writer_issuer',p.oid,'EXECUTE') as "issuerExecute",
  has_function_privilege('buyer_writer_issuer',p.oid,'EXECUTE WITH GRANT OPTION') as "issuerGrant"
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='buyer_writer'
), direct_relations as (
 select w.name as role,n.nspname as schema,c.relname as name,c.relkind::text as kind,
  has_table_privilege(w.name,c.oid,'SELECT') as "select",has_table_privilege(w.name,c.oid,'INSERT') as "insert",
  has_table_privilege(w.name,c.oid,'UPDATE') as "update",has_table_privilege(w.name,c.oid,'DELETE') as "delete",
  has_table_privilege(w.name,c.oid,'TRUNCATE') as "truncate",has_table_privilege(w.name,c.oid,'REFERENCES') as "references",
  has_table_privilege(w.name,c.oid,'TRIGGER') as "trigger",has_table_privilege(w.name,c.oid,'MAINTAIN') as maintain,
  has_any_column_privilege(w.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') as "anyColumn"
 from writer_roles w cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
 where w.name in('buyer_writer_runtime','buyer_writer_issuer') and c.relkind in('r','p','v','m','f')
  and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
), direct_sequences as (
 select w.name as role,n.nspname as schema,c.relname as name,
  has_sequence_privilege(w.name,c.oid,'SELECT') as "select",has_sequence_privilege(w.name,c.oid,'UPDATE') as "update",
  has_sequence_privilege(w.name,c.oid,'USAGE') as usage
 from writer_roles w cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
 where w.name in('buyer_writer_runtime','buyer_writer_issuer') and c.relkind='S'
  and n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
), schema_create as (
 select w.name as role,n.nspname as schema from writer_roles w cross join pg_namespace n
 where w.name in('buyer_writer_runtime','buyer_writer_issuer') and n.nspname !~ '^pg_temp'
  and has_schema_privilege(w.name,n.oid,'CREATE')
), external_routines as (
 select w.name as role,n.nspname as schema,p.oid::regprocedure::text as signature,
  pg_get_userbyid(p.proowner) as owner
 from writer_roles w cross join pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where w.name in('buyer_writer_runtime','buyer_writer_issuer') and p.prosecdef
  and p.prorettype<>'event_trigger'::regtype
  and n.nspname not in('pg_catalog','information_schema','buyer_writer')
  and has_schema_privilege(w.name,n.oid,'USAGE')
  and has_function_privilege(w.name,p.oid,'EXECUTE')
), net_state as (
 select e.name,p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,
  exists(select from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.grantee=0 and a.privilege_type='EXECUTE') as "publicExecute",
  coalesce(has_function_privilege('buyer_writer_owner',p.oid,'EXECUTE'),false) as "ownerExecute",
  coalesce(has_function_privilege('buyer_writer_runtime',p.oid,'EXECUTE'),false) as "runtimeExecute",
  coalesce(has_function_privilege('buyer_writer_issuer',p.oid,'EXECUTE'),false) as "issuerExecute"
 from expected_net e left join pg_namespace n on n.nspname='net'
 left join pg_proc p on p.pronamespace=n.oid and p.proname=e.name
)
select jsonb_build_object(
 'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by name),'[]'::jsonb) from role_state r),
 'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by role,member,grantor),'[]'::jsonb) from membership_state m),
 'schema',(select to_jsonb(s)-'oid' from schema_state s),
 'routines',(select coalesce(jsonb_agg(to_jsonb(r)-'oid' order by signature),'[]'::jsonb) from routine_state r),
 'directRelations',(select coalesce(jsonb_agg(to_jsonb(d) order by role,schema,name),'[]'::jsonb) from direct_relations d
   where "select" or "insert" or "update" or "delete" or "truncate" or "references" or "trigger" or maintain or "anyColumn"),
 'directSequences',(select coalesce(jsonb_agg(to_jsonb(d) order by role,schema,name),'[]'::jsonb) from direct_sequences d
   where "select" or "update" or usage),
 'schemaCreate',(select coalesce(jsonb_agg(to_jsonb(s) order by role,schema),'[]'::jsonb) from schema_create s),
 'externalRoutines',(select coalesce(jsonb_agg(to_jsonb(r) order by role,schema,signature),'[]'::jsonb) from external_routines r),
 'databaseCreate',jsonb_build_object(
   'buyer_writer_runtime',coalesce(has_database_privilege('buyer_writer_runtime',current_database(),'CREATE'),false),
   'buyer_writer_issuer',coalesce(has_database_privilege('buyer_writer_issuer',current_database(),'CREATE'),false)),
 'pgNet',(select coalesce(jsonb_agg(to_jsonb(n) order by name,signature),'[]'::jsonb) from net_state n)
) as evidence`;

export const BUYER_WRITER_ROUTINES=Object.freeze([
 'buyer_writer.apply(text,text,jsonb)',
 'buyer_writer.cancel(uuid,uuid,text)',
 'buyer_writer.commit_buyers(buyer_writer.dispatches)',
 'buyer_writer.context(text,text,uuid,uuid,bigint)',
 'buyer_writer.criteria(jsonb)',
 'buyer_writer.eligible(jsonb,jsonb)',
 'buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)',
 'buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)',
 'buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)',
 'buyer_writer.valid_context(jsonb)',
 'buyer_writer.valid_sale(jsonb)',
]);
export const BUYER_WRITER_RUNTIME_ROUTINES=Object.freeze([
 'buyer_writer.apply(text,text,jsonb)','buyer_writer.context(text,text,uuid,uuid,bigint)',
 'buyer_writer.receipt(text,text,uuid,uuid,bigint,text,integer)',
]);
export const BUYER_WRITER_ISSUER_ROUTINES=Object.freeze([
 'buyer_writer.cancel(uuid,uuid,text)',
 'buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid)',
 'buyer_writer.reconcile(uuid,uuid,text,uuid,timestamp with time zone)',
]);
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
export function verifyBuyerWriterProductionEvidence(raw){
 try{
  if(Buffer.byteLength(JSON.stringify(raw))>1024*1024
   ||!exact(raw,['roles','memberships','schema','routines','directRelations','directSequences','schemaCreate','externalRoutines','databaseCreate','pgNet'])
   ||![raw.roles,raw.memberships,raw.routines,raw.directRelations,raw.directSequences,raw.schemaCreate,raw.externalRoutines,raw.pgNet].every(Array.isArray))fail();
  const roleNames=['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'];
  if(!sameSet(raw.roles.map(role=>role?.name),roleNames))fail();
  for(const role of raw.roles){
   if(!exact(role,['name','login','inherit','superuser','createDb','createRole','replication','bypassRls'])
    ||![role.login,role.inherit,role.superuser,role.createDb,role.createRole,role.replication,role.bypassRls].every(bool))fail();
   const login=role.name!=='buyer_writer_owner';
   if(role.login!==login||role.inherit||role.superuser||role.createDb||role.createRole||role.replication||role.bypassRls)fail();
  }
  for(const edge of raw.memberships){
   if(!exact(edge,['role','member','grantor','admin','inherit','set'])||![edge.role,edge.member,edge.grantor].every(value=>string(value,63))
    ||![edge.admin,edge.inherit,edge.set].every(bool))fail();
   // Match the installer's PostgreSQL 17 managed-CREATEROLE exception. The
   // automatic ADMIN edge may be recorded with the created role as grantor.
   const managerAdmin=roleNames.includes(edge.role)&&edge.member==='postgres'
    &&edge.admin&&!edge.inherit&&!edge.set;
   const ownerSet=edge.role==='buyer_writer_owner'&&edge.member==='postgres'&&edge.grantor==='postgres'
    &&!edge.admin&&edge.inherit&&edge.set;
   if(!managerAdmin&&!ownerSet)fail();
  }
  if(!exact(raw.schema,['name','owner','edges'])||raw.schema.name!=='buyer_writer'||raw.schema.owner!=='buyer_writer_owner'
   ||!Array.isArray(raw.schema.edges))fail();
  const schemaEdges=[
   ['buyer_writer_owner','CREATE',false],['buyer_writer_owner','USAGE',false],
   ['buyer_writer_runtime','USAGE',false],['buyer_writer_issuer','USAGE',false],
  ];
  validateAclEdges(raw.schema.edges,schemaEdges);
  if(!sameSet(raw.routines.map(routine=>routine?.signature),BUYER_WRITER_ROUTINES))fail();
  for(const routine of raw.routines){
   if(!exact(routine,['signature','owner','securityDefiner','searchPathLocked','edges','runtimeExecute','runtimeGrant','issuerExecute','issuerGrant'])
    ||routine.owner!=='buyer_writer_owner'||!Array.isArray(routine.edges)
    ||![routine.securityDefiner,routine.searchPathLocked,routine.runtimeExecute,routine.runtimeGrant,routine.issuerExecute,routine.issuerGrant].every(bool))fail();
   const runtime=BUYER_WRITER_RUNTIME_ROUTINES.includes(routine.signature),issuer=BUYER_WRITER_ISSUER_ROUTINES.includes(routine.signature);
   if(routine.runtimeExecute!==runtime||routine.issuerExecute!==issuer||routine.runtimeGrant||routine.issuerGrant)fail();
   if((runtime||issuer)&&(!routine.securityDefiner||!routine.searchPathLocked))fail();
   validateAclEdges(routine.edges,[['buyer_writer_owner','EXECUTE',false],...(runtime?[['buyer_writer_runtime','EXECUTE',false]]:[]),
    ...(issuer?[['buyer_writer_issuer','EXECUTE',false]]:[])]);
  }
  if(raw.directRelations.length||raw.directSequences.length||raw.schemaCreate.length||raw.externalRoutines.length
   ||!exact(raw.databaseCreate,['buyer_writer_runtime','buyer_writer_issuer'])
   ||raw.databaseCreate.buyer_writer_runtime!==false||raw.databaseCreate.buyer_writer_issuer!==false)fail();
  if(raw.pgNet.length!==12||!sameSet(raw.pgNet.map(row=>row?.name),BUYER_WRITER_PG_NET_FUNCTIONS))fail();
  for(const row of raw.pgNet)if(!exact(row,['name','signature','owner','publicExecute','ownerExecute','runtimeExecute','issuerExecute'])
   ||!string(row.signature)||!string(row.owner,63)||![row.publicExecute,row.ownerExecute,row.runtimeExecute,row.issuerExecute].every(bool))fail();
  const publicExecuteCount=raw.pgNet.filter(row=>row.publicExecute).length;
  const evidence=structuredClone(raw);
  evidence.compliant=true;
  evidence.unexpectedMembershipCount=0;
  evidence.directTableAccessDenied=true;
  evidence.directSequenceAccessDenied=true;
  evidence.schemaCreateDenied=true;
  evidence.crossRoutineAccessDenied=raw.externalRoutines.length===0;
  evidence.pgNetTruth={functionCount:12,publicExecuteCount,
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
  if(!exact(edge,['grantor','grantee','privilege','grantable'])||edge.grantor!=='buyer_writer_owner'
   ||!string(edge.grantee,63)||edge.privilege!=='EXECUTE'&&edge.privilege!=='CREATE'&&edge.privilege!=='USAGE'
   ||!bool(edge.grantable)||!wanted.delete(JSON.stringify([edge.grantee,edge.privilege,edge.grantable])))fail();
 }
 if(wanted.size)fail();
}

export async function observeBuyerWriterProductionState(query){
 try{
  if(typeof query!=='function')fail();
  const result=await query(BUYER_WRITER_PRODUCTION_VERIFY_SQL,[]);
  if(!result||!Array.isArray(result.rows)||result.rows.length!==1||!exact(result.rows[0],['evidence']))fail();
  return verifyBuyerWriterProductionEvidence(result.rows[0].evidence);
 }catch(error){if(error?.message==='Buyer writer production verification failed')throw error;fail();}
}
