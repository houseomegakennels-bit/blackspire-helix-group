import {createHash,createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateBuyerWriterConfiguration} from '../buyer-writer/configuration.js';
import {createBuyerWriterPostgres} from '../buyer-writer/postgres.js';
import {createWriterGateway,createWriterReceiptGateway} from '../buyer-writer/gateway.js';
import {captureBuyerJobVersion} from '../buyer-writer/criteria.js';

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
const WRITER_WORKSPACE='blackspire-command';
const WRITER_HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
export const WRITER_ACCEPTANCE_TARGET_FILE='/var/lib/blackspire-operator/writer-acceptance.json';
const ISSUE_SQL='select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result';
const RECONCILE_SQL='select buyer_writer.reconcile($1,$2,$3,$4,$5::timestamptz) as result';
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

function derivedUuid(label,value){
 const bytes=createHash('sha256').update(label).update('\0').update(JSON.stringify(value)).digest('hex');
 return `${bytes.slice(0,8)}-${bytes.slice(8,12)}-4${bytes.slice(13,16)}-8${bytes.slice(17,20)}-${bytes.slice(20,32)}`;
}
function acceptanceIdentity(bound,target){
 const {ownerId,jobId}=target;
 const dispatchId=mutationUuid(bound);
 return Object.freeze({ownerId,jobId,dispatchId});
}
function acceptanceSource(bound){
 const empty=Buffer.from('[]');
 return Object.freeze({version:1,mode:'frontend_payload',sources:Object.freeze([Object.freeze({
  sourceId:derivedUuid('zola-buyer-writer-source',{workspace:bound.workspace,principal:bound.principal}),
  sourceType:'zola_acceptance',endpointId:'fixed_zero_row',endpointConfigDigest:createHash('sha256').update(bound.releaseSha).digest('hex'),cashDisabled:true,
 })]),budgets:Object.freeze({maxRequests:1,maxRows:1,maxBytes:2}),rawPayload:Object.freeze({
  digest:createHash('sha256').update(empty).digest('hex'),rowCount:0,byteCount:empty.length,
 })});
}
function acceptanceInspection(bound,state,receiptDigest=null){
 return Object.freeze({schema:1,kind:'zola_bounded_writer_acceptance',...bound,capability:WRITER_CAPABILITY,mutationId:mutationUuid(bound),state,
  businessRowsChanged:0,paidProviderCalls:0,receiptDigest,compensationComplete:state==='COMPENSATED',outcomeUnknown:false});
}
function fixedConfiguration(configurationFile,groupId,readSnapshot=readRootOwnedJsonSnapshot){
 const snapshot=readSnapshot(configurationFile,{groupId,maxBytes:65536});
 const config=validateBuyerWriterConfiguration(snapshot.value,{workspace:WRITER_WORKSPACE,environment:'production'});
 if(config.runtime.host!==WRITER_HOST||config.issuer.host!==WRITER_HOST||config.runtime.port!==5432||config.issuer.port!==5432
  ||config.runtime.database!=='postgres'||config.issuer.database!=='postgres')reject();
 return {snapshot,config};
}
function fixedAcceptanceTarget(file,bound,groupId,readSnapshot=readRootOwnedJsonSnapshot){
 const snapshot=readSnapshot(file,{groupId,maxBytes:32768}),value=snapshot.value;
 if(!exact(value,['schema','kind','releaseSha','workspace','principal','capability','jobId','ownerId','criteria','updatedAt'])
  ||value.schema!==1||value.kind!=='zola_bounded_writer_acceptance_target'||value.releaseSha!==bound.releaseSha
  ||value.workspace!==bound.workspace||value.principal!==bound.principal||value.capability!==WRITER_CAPABILITY
  ||!uuid(value.jobId)||!uuid(value.ownerId))reject();
 let captured;
 try{captured=captureBuyerJobVersion({...value.criteria,updated_at:value.updatedAt});}catch{reject();}
 return{snapshot,target:Object.freeze({jobId:value.jobId,ownerId:value.ownerId,criteria:captured.criteria,updatedAt:captured.updatedAt})};
}
async function withFixedWriter(configurationFile,bound,work,{groupId,readSnapshot=readRootOwnedJsonSnapshot,
 readAcceptanceSnapshot=readRootOwnedJsonSnapshot,acceptanceFile=WRITER_ACCEPTANCE_TARGET_FILE,openDatabase=createBuyerWriterPostgres}={}){
 let database;
 try{
  if(typeof configurationFile!=='string'||typeof acceptanceFile!=='string'||acceptanceFile!==WRITER_ACCEPTANCE_TARGET_FILE||typeof work!=='function')reject();
  const gid=groupId??apiGroupId(),before=fixedConfiguration(configurationFile,gid,readSnapshot);
  const acceptance=fixedAcceptanceTarget(acceptanceFile,bound,gid,readAcceptanceSnapshot);
  database=await openDatabase({runtime:before.config.runtime,issuer:before.config.issuer});
  if(database?.isHealthy?.()!==true||typeof database.runtimeQuery!=='function'||typeof database.issuerQuery!=='function'||typeof database.close!=='function')reject();
  const result=await work(before.config,database,acceptance.target);
  const after=fixedConfiguration(configurationFile,gid,readSnapshot),acceptanceAfter=fixedAcceptanceTarget(acceptanceFile,bound,gid,readAcceptanceSnapshot);
  if(JSON.stringify(before.snapshot)!==JSON.stringify(after.snapshot)||JSON.stringify(acceptance.snapshot)!==JSON.stringify(acceptanceAfter.snapshot)
   ||database.isHealthy()!==true)reject();
  return result;
 }finally{try{await database?.close();}catch{}}
}
function fixedPermit(config,bound){
 return createHmac('sha256',Buffer.from(config.issuerCredential,'base64url'))
  .update('zola-bounded-writer-acceptance\0').update(JSON.stringify(bound)).digest('base64url');
}
function validateFixedRequest(request){
 const bound=request&&typeof request==='object'&&!Array.isArray(request)?Object.fromEntries(
  ['releaseSha','operationId','workspace','principal','attemptId','inputDigest','checkOutputDigest'].map(key=>[key,request[key]])):null;
 if(!exact(request,['releaseSha','operationId','workspace','principal','attemptId','inputDigest','checkOutputDigest','capability','mutationId',
  'operation','failureCode','maximumBusinessRows','paidProviderAllowed'])||!sha(request.releaseSha)||!uuid(request.operationId)||!slug(request.workspace)
  ||!slug(request.principal)||!uuid(request.attemptId)||!digest(request.inputDigest)||!digest(request.checkOutputDigest)
  ||request.capability!==WRITER_CAPABILITY||request.mutationId!==mutationUuid(bound)||request.operation!=='fail'
  ||request.failureCode!=='INVALID_SOURCE_DATA'||request.maximumBusinessRows!==0||request.paidProviderAllowed!==false)reject();
 return Object.freeze({...request});
}
async function compensate(config,database,bound,target){
 const ids=acceptanceIdentity(bound,target),result=await database.issuerQuery(RECONCILE_SQL,
  [ids.jobId,ids.ownerId,WRITER_WORKSPACE,ids.dispatchId,target.updatedAt]);
 const value=result?.rows?.length===1?result.rows[0]?.result:null;
 if(!exact(value,['dispatchId','generation','state'])||value.dispatchId!==ids.dispatchId||!['absent','cancelled','failed'].includes(value.state)
  ||(value.state==='absent'?value.generation!==null:!Number.isSafeInteger(value.generation)||value.generation<1))reject();
 if(value.state==='absent')return null;
 let proof={dispatchId:ids.dispatchId,generation:value.generation,state:value.state};
 if(value.state==='failed'){
  const permit=fixedPermit(config,bound),receipt=createWriterReceiptGateway({credential:config.writerCredential,workspace:WRITER_WORKSPACE,query:database.runtimeQuery});
  const response=await receipt({rawHeaders:['x-buyer-writer-key',config.writerCredential,'x-buyer-job-permit',permit],jobId:ids.jobId,
   body:Buffer.from(JSON.stringify({version:1,dispatchId:ids.dispatchId,generation:value.generation,operation:'fail',chunkIndex:0}))});
  if(response?.status!==200||response.body?.found!==true||response.body?.receipt?.ok!==true||response.body.receipt.operation!=='fail')reject();
  proof={...proof,receipt:response.body.receipt};
 }
 return acceptanceInspection(bound,'COMPENSATED',hash(proof));
}

// Fixed production host transport. The caller cannot supply a URL, SQL,
// credential, job/owner identity, payload, or row budget. The only dispatched
// write is the writer's terminal INVALID_SOURCE_DATA path for a separately
// provisioned deterministic acceptance job; reconciliation is absorbing and
// never retries an unknown issuance/write outcome.
export async function inspectFixedWriterAcceptance(binding,{configurationFile,...host}={}){
 const bound=Object.freeze({...binding});
 if(bound.attemptId===null){
  bindingShape(bound,false);
  return withFixedWriter(configurationFile,bound,async()=>acceptanceInspection(bound,'PREPARED'),host);
 }
 bindingShape(bound,true);
 return withFixedWriter(configurationFile,bound,(config,database,target)=>compensate(config,database,bound,target),host);
}

export async function runFixedWriterAcceptance(value,{configurationFile,...host}={}){
 const request=validateFixedRequest(value),bound=Object.freeze(Object.fromEntries(
  ['releaseSha','operationId','workspace','principal','attemptId','inputDigest','checkOutputDigest'].map(key=>[key,request[key]])));
 return withFixedWriter(configurationFile,bound,async(config,database,target)=>{
  const ids=acceptanceIdentity(bound,target),permit=fixedPermit(config,bound),source=acceptanceSource(bound);
  try{
   const issued=await database.issuerQuery(ISSUE_SQL,[ids.jobId,ids.ownerId,WRITER_WORKSPACE,createHash('sha256').update(permit).digest('hex'),
    JSON.stringify(source),JSON.stringify(target.criteria),target.updatedAt,ids.dispatchId]);
   const result=issued?.rows?.length===1?issued.rows[0]?.result:null;
   if(!exact(result,['dispatchId','generation'])||result.dispatchId!==ids.dispatchId||!Number.isSafeInteger(result.generation)||result.generation<1)reject();
   const writer=createWriterGateway({credential:config.writerCredential,workspace:WRITER_WORKSPACE,query:database.runtimeQuery});
   const response=await writer({rawHeaders:['x-buyer-writer-key',config.writerCredential,'x-buyer-job-permit',permit],jobId:ids.jobId,
    body:Buffer.from(JSON.stringify({version:1,dispatchId:ids.dispatchId,generation:result.generation,operation:'fail',chunkIndex:0,chunkCount:1,
     payload:{code:'INVALID_SOURCE_DATA'}}))});
   if(response?.status!==200||response.body?.ok!==true||response.body.operation!=='fail'||response.body.chunkIndex!==0)throw new Error('unknown');
  }catch{
   const compensated=await compensate(config,database,bound,target);
   if(compensated===null)throw new Error('Bounded writer acceptance outcome unknown');
  }
 },host);
}

function bindingShape(value,attempt){
 const keys=attempt?['releaseSha','operationId','workspace','principal','attemptId','inputDigest','checkOutputDigest']
  :['releaseSha','operationId','workspace','principal','attemptId'];
 if(!exact(value,keys)||!sha(value.releaseSha)||!uuid(value.operationId)||!slug(value.workspace)||!slug(value.principal)||
  (attempt?(!uuid(value.attemptId)||!digest(value.inputDigest)||!digest(value.checkOutputDigest)):value.attemptId!==null))reject();
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
