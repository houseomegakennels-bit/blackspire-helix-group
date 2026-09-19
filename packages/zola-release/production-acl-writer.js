import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {createBoundedWriterAdmissionJournal} from './bounded-writer-admission-journal.js';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateBuyerWriterGatewayServiceConfiguration} from '../buyer-writer/gateway-entry.js';
import {BUYER_WRITER_LOCAL_STATEMENTS} from '../buyer-writer/local-gateway-server.js';
import {captureBuyerJobVersion} from '../buyer-writer/criteria.js';
import {APPLICATION_FUNCTION_PG_NET_SQL} from './pg-net-isolation.js';
import {BUYER_WRITER_GATEWAY_CONFIG} from './pg-net-host-observer.js';

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

function writerGroupId(run=execFileSync){
 const raw=run('/usr/bin/getent',['group','blackspire-writer'],{encoding:'utf8',timeout:1000,maxBuffer:4096,
  stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim(),fields=raw.split(':');
 if(fields.length!==4||fields[0]!=='blackspire-writer'||!/^[1-9][0-9]{0,9}$/.test(fields[2]))reject();
 return Number(fields[2]);
}
function apiGroupId(){
 const raw=execFileSync('/usr/bin/getent',['group','blackspire-api'],{encoding:'utf8',timeout:1000,maxBuffer:4096,
  stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim(),fields=raw.split(':');
 if(fields.length!==4||fields[0]!=='blackspire-api'||!/^[1-9][0-9]{0,9}$/.test(fields[2]))reject();
 return Number(fields[2]);
}

// Operator-only catalog observer. The canonical root:writer 0640 gateway file
// is deliberately unreadable by API/worker identities. Only these two exact
// catalog statements are reachable, and both run inside a read-only transaction.
export async function queryFixedProviderAcl(configurationFile,sql,values,{Pool,lookup=execFileSync,readSnapshot=readRootOwnedJsonSnapshot}={}){
 let pool,client;
 try{
  if(configurationFile!==BUYER_WRITER_GATEWAY_CONFIG||![PROVIDER_ACL_CHECK_SQL,APPLICATION_FUNCTION_PG_NET_SQL].includes(sql)
   ||!Array.isArray(values)||values.length!==0)reject();
  const groupId=writerGroupId(lookup),snapshot=readSnapshot(configurationFile,{groupId,maxBytes:65536});
  const config=validateBuyerWriterGatewayServiceConfiguration(snapshot.value),runtime=config.runtime;
  if(snapshot.identity.uid!==0||snapshot.identity.gid!==groupId||(snapshot.identity.mode&0o7777)!==0o640
   ||config.workspace!=='blackspire-command'||config.authority.gatewayIdentity!=='blackspire-writer')reject();
  if(runtime.host!=='db.kchtrvfcixnimvxxctkj.supabase.co'||runtime.port!==5432||runtime.database!=='postgres')reject();
  if(!runtime||typeof runtime.password!=='string'||runtime.password.length<1||runtime.password.length>1024
   ||Object.keys(runtime).some(key=>!['host','port','database','password','ca'].includes(key)))reject();
  const DriverPool=Pool??(await import('pg')).Pool;
  pool=new DriverPool({host:runtime.host,port:runtime.port,database:runtime.database,user:'buyer_writer_runtime',password:runtime.password,
   ssl:{rejectUnauthorized:true,...(runtime.ca?{ca:runtime.ca}:{})},application_name:'zola-provider-acl-observer',max:1,
   connectionTimeoutMillis:2000,query_timeout:8000,idleTimeoutMillis:1000,
   options:'-c default_transaction_read_only=on -c statement_timeout=7000 -c lock_timeout=1000 -c search_path=pg_catalog'});
  client=await pool.connect();await client.query('begin read only');const result=await client.query(sql,values);await client.query('rollback');
  const second=readSnapshot(configurationFile,{groupId,maxBytes:65536});
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
  if(!row.ownerExecute||!row.postgresExecute||!row.serviceRoleExecute)reject();
  identities.push({name:row.functionName,arguments:row.arguments,owner:row.owner,publicExecute:row.publicExecute,
   ownerExecute:row.ownerExecute,postgresExecute:row.postgresExecute,serviceRoleExecute:row.serviceRoleExecute,
   writerExecute:row.writerExecute});
 }
 if(expected.size)return null;
 const publicExecuteCount=rows.filter(row=>row.publicExecute).length;
 return Object.freeze({providerAclObserved:true,...bound,functionCount:rows.length,publicExecuteCount,
  ownerExecuteCount:rows.filter(row=>row.ownerExecute).length,postgresExecuteCount:rows.filter(row=>row.postgresExecute).length,
  serviceRoleExecuteCount:rows.filter(row=>row.serviceRoleExecute).length,writerExecuteCount:rows.filter(row=>row.writerExecute).length,
  providerRisk:publicExecuteCount>0?'PUBLIC_EXECUTE_EXTERNALLY_OPEN':'PUBLIC_EXECUTE_NOT_OBSERVED',
  catalogDigest:hash(identities.sort((a,b)=>a.name.localeCompare(b.name)||a.arguments.localeCompare(b.arguments)))});
}

const isolationKeys=['pgNetIsolationVerified','applicationDbCredentialsAbsent','gatewayTransportVerified','arbitrarySqlDenied',
 'arbitraryFunctionDenied','arbitraryUrlDenied','applicationPgNetCallSitesZero','applicationDbPgNetReferencesZero'];
const isolationEvidenceKeys=[...isolationKeys,'applicationPgNetCallSiteCount','applicationDbPgNetReferenceCount',
 'sourceScanDigest','functionBodyDigest'];

function completeIsolationEvidence(value){
 return exact(value,isolationEvidenceKeys)&&isolationKeys.every(key=>value[key]===true)
  &&value.applicationPgNetCallSiteCount===0&&value.applicationDbPgNetReferenceCount===0
  &&digest(value.sourceScanDigest)&&digest(value.functionBodyDigest);
}

export function createProviderAclCheckOperation({query,isolationProof}){
 if(typeof query!=='function')reject();
 const observe=async args=>{
  const bound=binding(args);
  try{
   const provider=aclEvidence(await query(PROVIDER_ACL_CHECK_SQL,[]),bound);
   if(provider===null||typeof isolationProof!=='function')return blocked();
   const isolation=await isolationProof();
   if(isolation?.status!=='PASS'||!completeIsolationEvidence(isolation.evidence))return blocked();
   return Object.freeze({status:'PASS',evidence:Object.freeze({...provider,...isolation.evidence,
    providerAcl:provider.publicExecuteCount===0,providerRiskRecorded:provider.publicExecuteCount>0})});
  }catch(error){
   if(error?.message==='Fixed production ACL/writer operation rejected')throw error;
   return blocked();
  }
 };
 return Object.freeze({check:observe,observe});
}

const WRITER_CAPABILITY='buyer.writer.acceptance';
const WRITER_WORKSPACE='blackspire-command';
export const WRITER_ACCEPTANCE_TARGET_FILE='/var/lib/blackspire-operator/writer-acceptance.json';
const ISSUE_SQL=BUYER_WRITER_LOCAL_STATEMENTS.issue;
const RECONCILE_SQL=BUYER_WRITER_LOCAL_STATEMENTS.reconcile;
const APPLY_SQL=BUYER_WRITER_LOCAL_STATEMENTS.apply;
const RECEIPT_SQL=BUYER_WRITER_LOCAL_STATEMENTS.receipt;
const inspectionKeys=['schema','kind','releaseSha','operationId','attemptId','workspace','principal','capability','mutationId',
 'state','businessRowsChanged','paidProviderCalls','receiptDigest','compensationComplete','outcomeUnknown'];
const admittedReceiptKeys=['admittedGatewayReceiptWitness','admittedGatewayReceiptDigest','admittedGatewayReceiptAttemptId'];
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
function acceptanceInspection(bound,state){
 if(state!=='PREPARED')reject();
 return Object.freeze({schema:1,kind:'zola_bounded_writer_acceptance',...bound,capability:WRITER_CAPABILITY,mutationId:mutationUuid(bound),state,
  businessRowsChanged:0,paidProviderCalls:0,receiptDigest:null,compensationComplete:false,outcomeUnknown:false});
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
async function withFixedWriter(bound,work,{groupId,readAcceptanceSnapshot=readRootOwnedJsonSnapshot,
 acceptanceFile=WRITER_ACCEPTANCE_TARGET_FILE,openAdmittedClient}={}){
 let database;
 try{
  if(typeof acceptanceFile!=='string'||acceptanceFile!==WRITER_ACCEPTANCE_TARGET_FILE||typeof work!=='function'
   ||typeof openAdmittedClient!=='function')reject();
  const gid=groupId??apiGroupId(),acceptance=fixedAcceptanceTarget(acceptanceFile,bound,gid,readAcceptanceSnapshot);
  database=await openAdmittedClient(bound);
  if(database?.isHealthy?.()!==true||typeof database.runtimeQuery!=='function'||typeof database.issuerQuery!=='function'||typeof database.close!=='function')reject();
  const result=await work(database,acceptance.target);
  const acceptanceAfter=fixedAcceptanceTarget(acceptanceFile,bound,gid,readAcceptanceSnapshot);
  if(JSON.stringify(acceptance.snapshot)!==JSON.stringify(acceptanceAfter.snapshot)||database.isHealthy()!==true)reject();
  return result;
 }finally{try{await database?.close();}catch{}}
}
function fixedPermitDigest(bound){
 return createHash('sha256').update('zola-bounded-writer-acceptance\0').update(JSON.stringify(bound)).digest('hex');
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
function durableWriter(database,bound,stream){
 const journal=createBoundedWriterAdmissionJournal(stream,bound);
 const recover=()=>journal.recoverAll(database);
 const query=kind=>async(sql,values)=>{
  const operation=Object.entries({issue:ISSUE_SQL,apply:APPLY_SQL,reconcile:RECONCILE_SQL,receipt:RECEIPT_SQL})
   .find(([,statement])=>statement===sql)?.[0];
  if(!operation)reject();
  // Any earlier uncertain request must recover before a subsequent request.
  const previous=await recover();
  if(previous.has(operation))return {rows:[{result:previous.get(operation).result}]};
  return database[kind](sql,values,journal.options(operation));
 };
 return {issuerQuery:query('issuerQuery'),runtimeQuery:query('runtimeQuery'),recover};
}
async function compensate(database,bound,target){
 const ids=acceptanceIdentity(bound,target),result=await database.issuerQuery(RECONCILE_SQL,
  [ids.jobId,ids.ownerId,WRITER_WORKSPACE,ids.dispatchId,target.updatedAt]);
 const value=result?.rows?.length===1?result.rows[0]?.result:null;
 if(!exact(value,['dispatchId','generation','state'])||value.dispatchId!==ids.dispatchId||!['absent','cancelled','failed'].includes(value.state)
  ||(value.state==='absent'?value.generation!==null:!Number.isSafeInteger(value.generation)||value.generation<1))reject();
 if(value.state==='absent')return null;
 if(value.state==='failed'){
  if(!(await database.recover()).has('apply'))return null;
  const receipt=(await database.runtimeQuery(RECEIPT_SQL,[fixedPermitDigest(bound),WRITER_WORKSPACE,ids.jobId,ids.dispatchId,
   value.generation,'fail',0]))?.rows?.[0]?.result;
  if(!exact(receipt,['found','receipt'])||receipt.found!==true||!exact(receipt.receipt,['ok','operation','chunkIndex'])
   ||receipt.receipt.ok!==true||receipt.receipt.operation!=='fail'||receipt.receipt.chunkIndex!==0)reject();
 }
 if(value.state!=='failed')return null;
 const recovered=await database.recover(),issue=recovered.get('issue'),apply=recovered.get('apply');
 if(!issue||!apply||!recovered.has('reconcile')||!recovered.has('receipt')
  ||!exact(issue.result,['dispatchId','generation'])||issue.result.dispatchId!==ids.dispatchId
  ||issue.result.generation!==value.generation
  ||!exact(apply.result,['ok','operation','chunkIndex'])||apply.result.ok!==true
  ||apply.result.operation!=='fail'||apply.result.chunkIndex!==0)reject();
 const witness=[...recovered].map(([operation,result])=>({operation,handleDigest:result.handleDigest,
  requestCorrelated:result.requestCorrelated,result:result.result}));
 return Object.freeze({schema:1,kind:'zola_bounded_writer_acceptance',...bound,capability:WRITER_CAPABILITY,
  mutationId:mutationUuid(bound),state:'COMPENSATED',businessRowsChanged:0,paidProviderCalls:0,
  receiptDigest:hash(recovered.get('receipt').result),compensationComplete:true,outcomeUnknown:false,
  admittedGatewayReceiptWitness:true,admittedGatewayReceiptDigest:hash(witness),
  admittedGatewayReceiptAttemptId:bound.attemptId});
}

// Fixed production host transport. The caller cannot supply a URL, SQL,
// credential, job/owner identity, payload, or row budget. The only dispatched
// write is the writer's terminal INVALID_SOURCE_DATA path for a separately
// provisioned deterministic acceptance job; reconciliation is absorbing and
// never retries an unknown issuance/write outcome.
export async function inspectFixedWriterAcceptance(binding,host={}){
 const bound=Object.freeze({...binding});
 if(typeof host.openAdmittedClient!=='function'||bound.attemptId!==null&&!host.admissionJournal)return null;
 if(bound.attemptId===null){
  bindingShape(bound,false);
  return withFixedWriter(bound,async()=>acceptanceInspection(bound,'PREPARED'),host);
 }
 bindingShape(bound,true);
 return withFixedWriter(bound,(database,target)=>compensate(durableWriter(database,bound,host.admissionJournal),bound,target),host);
}

export async function runFixedWriterAcceptance(value,host={}){
 const request=validateFixedRequest(value),bound=Object.freeze(Object.fromEntries(
  ['releaseSha','operationId','workspace','principal','attemptId','inputDigest','checkOutputDigest'].map(key=>[key,request[key]])));
 return withFixedWriter(bound,async(client,target)=>{
  const database=durableWriter(client,bound,host.admissionJournal);
  const ids=acceptanceIdentity(bound,target),permitDigest=fixedPermitDigest(bound),source=acceptanceSource(bound);
  try{
   const issued=await database.issuerQuery(ISSUE_SQL,[ids.jobId,ids.ownerId,WRITER_WORKSPACE,permitDigest,
    JSON.stringify(source),JSON.stringify(target.criteria),target.updatedAt,ids.dispatchId]);
   const result=issued?.rows?.length===1?issued.rows[0]?.result:null;
   if(!exact(result,['dispatchId','generation'])||result.dispatchId!==ids.dispatchId||!Number.isSafeInteger(result.generation)||result.generation<1)reject();
   const response=(await database.runtimeQuery(APPLY_SQL,[permitDigest,WRITER_WORKSPACE,JSON.stringify({
    version:1,jobId:ids.jobId,dispatchId:ids.dispatchId,generation:result.generation,operation:'fail',chunkIndex:0,chunkCount:1,
    payload:{code:'INVALID_SOURCE_DATA'}})]))?.rows?.[0]?.result;
   if(!exact(response,['ok','operation','chunkIndex'])||response.ok!==true||response.operation!=='fail'||response.chunkIndex!==0)throw new Error('unknown');
  }catch{
   const compensated=await compensate(database,bound,target);
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
 const keys=[...inspectionKeys,...(bound.attemptId===null?[]:['inputDigest','checkOutputDigest']),
  ...(expectedState==='COMPENSATED'?admittedReceiptKeys:[])];
 if(!exact(value,keys)||value.schema!==1||value.kind!=='zola_bounded_writer_acceptance'
  ||!Object.entries(bound).every(([key,item])=>value[key]===item)||value.capability!==WRITER_CAPABILITY
  ||value.mutationId!==mutationUuid(bound)||value.state!==expectedState
  ||value.businessRowsChanged!==0||value.paidProviderCalls!==0||typeof value.compensationComplete!=='boolean'
  ||typeof value.outcomeUnknown!=='boolean'||(value.receiptDigest!==null&&!digest(value.receiptDigest)))reject();
 if(expectedState==='PREPARED'&&(value.receiptDigest!==null||value.compensationComplete||value.outcomeUnknown))reject();
 if(expectedState==='COMPENSATED'&&(!digest(value.receiptDigest)||!value.compensationComplete||value.outcomeUnknown
  ||value.admittedGatewayReceiptWitness!==true||!digest(value.admittedGatewayReceiptDigest)
  ||value.admittedGatewayReceiptAttemptId!==bound.attemptId))reject();
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
   mutationId:mutationUuid(bound),receiptDigest:observed.receiptDigest,businessRowsChanged:0,paidProviderCalls:0,compensationComplete:true,
   admittedGatewayReceiptWitness:true,admittedGatewayReceiptDigest:observed.admittedGatewayReceiptDigest,
   admittedGatewayReceiptAttemptId:observed.admittedGatewayReceiptAttemptId})});
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
