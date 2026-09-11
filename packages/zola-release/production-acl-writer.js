import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateBuyerWriterConfiguration} from '../buyer-writer/configuration.js';

export const PROVIDER_ACL_FUNCTIONS=Object.freeze([
 '_await_response','_encode_url_with_params_array','_http_collect_response','_urlencode_string',
 'check_worker_is_up','http_collect_response','http_delete','http_get','http_post',
 'wait_until_running','wake','worker_restart',
]);

// This is intentionally one read-only catalog statement. It neither invokes a
// pg_net function nor accepts identifiers/SQL from the release input.
export const PROVIDER_ACL_CHECK_SQL=`with required(name) as (values
 ('_await_response'),('_encode_url_with_params_array'),('_http_collect_response'),('_urlencode_string'),
 ('check_worker_is_up'),('http_collect_response'),('http_delete'),('http_get'),('http_post'),
 ('wait_until_running'),('wake'),('worker_restart'))
select r.name as "functionName",pg_get_function_identity_arguments(p.oid) as arguments,
 pg_get_userbyid(p.proowner) as owner,
 exists(select from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where a.grantee=0 and a.privilege_type='EXECUTE') as "publicExecute",
 has_function_privilege(pg_get_userbyid(p.proowner),p.oid,'EXECUTE') as "ownerExecute",
 coalesce(has_function_privilege('postgres',p.oid,'EXECUTE'),false) as "postgresExecute",
 coalesce(has_function_privilege('service_role',p.oid,'EXECUTE'),false) as "serviceRoleExecute",
 exists(select from pg_roles w where w.rolname in ('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')
  and has_function_privilege(w.rolname,p.oid,'EXECUTE')) as "writerExecute"
from required r left join pg_namespace n on n.nspname='net'
left join pg_proc p on p.pronamespace=n.oid and p.proname=r.name
order by r.name,arguments`;

function apiGroupId(){
 const raw=execFileSync('/usr/bin/getent',['group','blackspire-api'],{encoding:'utf8',timeout:1000,maxBuffer:4096,
  stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim(),fields=raw.split(':');
 if(fields.length!==4||fields[0]!=='blackspire-api'||!/^[1-9][0-9]{0,9}$/.test(fields[2]))reject();
 return Number(fields[2]);
}

// Connect with the already-scoped writer runtime identity. This role can read
// PostgreSQL catalog privilege metadata but cannot alter ACLs or invoke the
// protected writer outside its fixed routines. The transaction is explicitly
// read-only and the protected configuration is re-read before accepting proof.
export async function queryFixedProviderAcl(configurationFile,sql,values,{Pool}={}){
 let pool,client;
 try{
  if(sql!==PROVIDER_ACL_CHECK_SQL||!Array.isArray(values)||values.length!==0)reject();
  const groupId=apiGroupId(),snapshot=readRootOwnedJsonSnapshot(configurationFile,{groupId,maxBytes:65536});
  const config=validateBuyerWriterConfiguration(snapshot.value,{workspace:'blackspire-command',environment:'production'}),runtime=config.runtime;
  if(runtime.host!=='db.kchtrvfcixnimvxxctkj.supabase.co'||runtime.port!==5432||runtime.database!=='postgres')reject();
  const DriverPool=Pool??(await import('pg')).Pool;
  pool=new DriverPool({host:runtime.host,port:runtime.port,database:runtime.database,user:'buyer_writer_runtime',password:runtime.password,
   ssl:{rejectUnauthorized:true,...(runtime.ca?{ca:runtime.ca}:{})},application_name:'zola-provider-acl-observer',max:1,
   connectionTimeoutMillis:2000,query_timeout:8000,idleTimeoutMillis:1000,
   options:'-c default_transaction_read_only=on -c statement_timeout=7000 -c lock_timeout=1000 -c search_path=pg_catalog'});
  client=await pool.connect();await client.query('begin read only');const result=await client.query(sql,values);await client.query('rollback');
  const second=readRootOwnedJsonSnapshot(configurationFile,{groupId,maxBytes:65536});
  if(JSON.stringify(snapshot)!==JSON.stringify(second))reject();return result;
 }catch(error){
  try{await client?.query('rollback');}catch{}
  if(error?.message==='Fixed production ACL/writer operation rejected')throw error;
  throw new Error('Provider ACL observation unavailable');
 }finally{try{client?.release(true);}catch{}try{await pool?.end();}catch{}}
}

const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const slug=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{2,63}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const reject=()=>{throw new Error('Fixed production ACL/writer operation rejected');};
const blocked=()=>Object.freeze({status:'BLOCKED_EXTERNAL'});

function binding(args,{attempt=false}={}){
 const {input,state}=args??{},operationId=state?.context?.operationId;
 if(!input||!sha(input.releaseSha)||!slug(input.workspace)||!slug(input.principal)||!uuid(operationId)
  ||state.context.releaseSha!==input.releaseSha||state.context.workspace!==input.workspace||state.context.principal!==input.principal)reject();
 const value={releaseSha:input.releaseSha,operationId,workspace:input.workspace,principal:input.principal};
 if(attempt){
  if(!uuid(args.attemptId)||!digest(args.inputDigest)||!digest(args.checkOutputDigest))reject();
  Object.assign(value,{attemptId:args.attemptId,inputDigest:args.inputDigest,checkOutputDigest:args.checkOutputDigest});
 }
 return Object.freeze(value);
}

function aclEvidence(value,bound){
 const rows=value?.rows;
 if(!Array.isArray(rows)||rows.length!==PROVIDER_ACL_FUNCTIONS.length)return null;
 const expected=new Set(PROVIDER_ACL_FUNCTIONS);const identities=[];
 for(const row of rows){
  if(!exact(row,['functionName','arguments','owner','publicExecute','ownerExecute','postgresExecute','serviceRoleExecute','writerExecute'])
   ||!expected.delete(row.functionName)||typeof row.arguments!=='string'||row.arguments.length>1024
   ||typeof row.owner!=='string'||row.owner.length>63
   ||![row.publicExecute,row.ownerExecute,row.postgresExecute,row.serviceRoleExecute,row.writerExecute].every(item=>typeof item==='boolean'))reject();
  if(row.publicExecute)return blocked();
  if(!row.ownerExecute||!row.postgresExecute||!row.serviceRoleExecute||row.writerExecute)reject();
  identities.push({name:row.functionName,arguments:row.arguments,owner:row.owner});
 }
 if(expected.size)return null;
 return Object.freeze({status:'PASS',evidence:Object.freeze({providerAcl:true,...bound,functionCount:rows.length,
  catalogDigest:hash(identities.sort((a,b)=>a.name.localeCompare(b.name)||a.arguments.localeCompare(b.arguments)))})});
}

export function createProviderAclCheckOperation({query}){
 if(typeof query!=='function')reject();
 const observe=async args=>{
  const bound=binding(args);
  try{
   const result=aclEvidence(await query(PROVIDER_ACL_CHECK_SQL,[]),bound);
   return result??blocked();
  }catch(error){
   if(error?.message==='Fixed production ACL/writer operation rejected')throw error;
   return blocked();
  }
 };
 return Object.freeze({check:observe,observe});
}

const WRITER_CAPABILITY='buyer.writer.acceptance';
const inspectionKeys=['schema','kind','releaseSha','operationId','attemptId','workspace','principal','capability','mutationId',
 'state','businessRowsChanged','paidProviderCalls','receiptDigest','compensationComplete','outcomeUnknown'];
function mutationUuid(bound){
 const bytes=createHash('sha256').update(JSON.stringify(bound)).digest('hex');
 return `${bytes.slice(0,8)}-${bytes.slice(8,12)}-4${bytes.slice(13,16)}-8${bytes.slice(17,20)}-${bytes.slice(20,32)}`;
}
function writerRequest(bound){
 return Object.freeze({...bound,capability:WRITER_CAPABILITY,mutationId:mutationUuid(bound),operation:'fail',
  failureCode:'INVALID_SOURCE_DATA',maximumBusinessRows:0,paidProviderAllowed:false});
}
function verifyInspection(value,bound,expectedState){
 const keys=bound.attemptId===null?inspectionKeys:[...inspectionKeys,'inputDigest','checkOutputDigest'];
 if(!exact(value,keys)||value.schema!==1||value.kind!=='zola_bounded_writer_acceptance'
  ||!Object.entries(bound).every(([key,item])=>value[key]===item)||value.capability!==WRITER_CAPABILITY
  ||value.mutationId!==mutationUuid(bound)||value.state!==expectedState
  ||value.businessRowsChanged!==0||value.paidProviderCalls!==0||typeof value.compensationComplete!=='boolean'
  ||typeof value.outcomeUnknown!=='boolean'||(value.receiptDigest!==null&&!digest(value.receiptDigest)))reject();
 if(expectedState==='PREPARED'&&(value.receiptDigest!==null||value.compensationComplete||value.outcomeUnknown))reject();
 if(expectedState==='COMPENSATED'&&(!digest(value.receiptDigest)||!value.compensationComplete||value.outcomeUnknown))reject();
 return value;
}

// runAcceptance is the fixed production transport composition: it must issue
// the attempt-bound permit, invoke the existing writer gateway once, reconcile
// its receipt on outcome uncertainty, and finish through the writer's bounded
// failure/compensation path. This operation supplies no unrestricted payload.
export function createBoundedWriterE2eOperation({inspectAcceptance,runAcceptance}){
 if(typeof inspectAcceptance!=='function'||typeof runAcceptance!=='function')reject();
 const check=async args=>{
  const base=binding(args),bound={...base,attemptId:null};
  try{
   const observed=await inspectAcceptance(Object.freeze(bound));
   if(observed===null||observed===undefined)return blocked();
   verifyInspection(observed,bound,'PREPARED');
   return Object.freeze({status:'PASS',evidence:Object.freeze({writerPrepared:true,...base,capability:WRITER_CAPABILITY,
    mutationId:mutationUuid(bound),businessRowsChanged:0,paidProviderCalls:0})});
  }catch(error){
   if(error?.message==='Fixed production ACL/writer operation rejected')throw error;
   return blocked();
  }
 };
 const execute=async args=>{
  const bound=binding(args,{attempt:true}),request=writerRequest(bound);
  await runAcceptance(request);
 };
 const reconcile=async args=>{
  const bound=binding(args,{attempt:true});
  let observed;
  try{observed=await inspectAcceptance(Object.freeze(bound));}
  catch{return blocked();}
  if(observed===null||observed===undefined)return blocked();
  verifyInspection(observed,bound,'COMPENSATED');
  return Object.freeze({status:'PASS',evidence:Object.freeze({boundedWriterAcceptance:true,...bound,capability:WRITER_CAPABILITY,
   mutationId:mutationUuid(bound),receiptDigest:observed.receiptDigest,businessRowsChanged:0,paidProviderCalls:0,compensationComplete:true})});
 };
 const observe=async args=>{
  const base=binding(args),bound={...base,attemptId:null};
  try{
   const observed=await inspectAcceptance(Object.freeze(bound));
   if(observed===null||observed===undefined)return blocked();
   verifyInspection(observed,bound,'COMPENSATED');
   return Object.freeze({status:'PASS',evidence:Object.freeze({boundedWriterAcceptance:true,...base,capability:WRITER_CAPABILITY,
    mutationId:mutationUuid(bound),receiptDigest:observed.receiptDigest,businessRowsChanged:0,paidProviderCalls:0,compensationComplete:true})});
  }catch(error){if(error?.message==='Fixed production ACL/writer operation rejected')throw error;return blocked();}
 };
 return Object.freeze({check,execute,reconcile,observe});
}
