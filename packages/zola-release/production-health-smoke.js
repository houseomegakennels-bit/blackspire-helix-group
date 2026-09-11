import http from 'node:http';
import {hash} from './commander-journal.js';
import {inspectHeldAcceptanceHistory} from './held-acceptance-authority.js';

export const PRODUCTION_HEALTH_URL='http://127.0.0.1:8787/health';
const HEALTH_TIMEOUT_MS=2000;
const HEALTH_MAX_BYTES=16384;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const generation=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const reject=()=>{throw new Error('Production health/smoke observation rejected');};

// The production transport has no URL argument: callers cannot redirect this
// privileged observation away from the fixed loopback API.
export function requestFixedProductionHealth({timeoutMs=HEALTH_TIMEOUT_MS,transport=http}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>HEALTH_TIMEOUT_MS||typeof transport?.request!=='function')reject();
 return new Promise((resolve,rejectRequest)=>{
  let bytes=0,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?rejectRequest(error):resolve(value);};
  const request=transport.request({protocol:'http:',hostname:'127.0.0.1',port:8787,path:'/health',method:'GET',
   timeout:timeoutMs,setHost:false,headers:{accept:'application/json','user-agent':'blackspire-zola-health/1'}},response=>{
   if(response.statusCode!==200||response.headers.location||!String(response.headers['content-type']??'').toLowerCase().startsWith('application/json')){
    response.resume();finish(new Error('HEALTH_RESPONSE_REJECTED'));return;
   }
   const chunks=[];
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>HEALTH_MAX_BYTES){request.destroy(new Error('HEALTH_RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
   response.on('end',()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(new Error('HEALTH_JSON_REJECTED'));}});
  });
  const timer=setTimeout(()=>request.destroy(new Error('HEALTH_TIMEOUT')),timeoutMs);
  request.once('timeout',()=>request.destroy(new Error('HEALTH_TIMEOUT')));
  request.once('error',error=>finish(error));request.end();
 });
}

function claimsFor(context,state,operation){
 if(!context?.journal?.stream||!sha(context.input?.releaseSha)||!id(context.input.workspace)||!id(context.input.principal)
  ||!uuid(state?.context?.operationId))reject();
 const history=inspectHeldAcceptanceHistory(context.journal.stream('release').events()),claims=history.claims;
 if(history.status!=='CONSUMING'||history.pending?.operation!==operation||!claims
  ||claims.mergeMainSha!==context.input.releaseSha||claims.expectedDeploymentSha!==context.input.releaseSha
  ||claims.commanderRunId!==state.context.operationId||claims.workspace!==context.input.workspace||claims.principal!==context.input.principal
  ||!uuid(claims.epochRunId)||!generation(claims.apiGeneration)||!generation(claims.workerGeneration))reject();
 return{history,claims};
}

function invocation(context,call,operation){
 const {state,ordinal,attemptId,inputDigest,checkOutputDigest}=call??{};
 if(!Number.isSafeInteger(ordinal)||ordinal<0||!uuid(attemptId)||!digest(inputDigest)||!digest(checkOutputDigest))reject();
 const {history,claims}=claimsFor(context,state,operation);
 return{history,claims,operationId:state.context.operationId,stageAttemptId:attemptId,ordinal};
}

function validateHealth(value,claims){
 const worker=value?.dependencies?.worker;
 if(!value||Array.isArray(value)||value.ok!==true||value.service!=='blackspire-command-api'||value.lifecycle!=='ready'
  ||value.emergencyStop!==false||value.database!=='available'||value.deploymentIdentity?.state!=='VERIFIED'
  ||value.deploymentIdentity?.build?.value!==claims.mergeMainSha||value.deploymentIdentity?.environment?.value!=='production'
  ||worker?.required!==true||worker.ok!==true||!['idle','working'].includes(worker.state)
  ||!Number.isFinite(worker.heartbeatAgeMs)||worker.heartbeatAgeMs<0||worker.heartbeatAgeMs>30000
  ||worker.generationId!==claims.workerGeneration)reject();
 return worker;
}

export async function observeFixedApiHealth({context,call,requestHealth=requestFixedProductionHealth,now=()=>performance.now()}){
 const binding=invocation(context,call,'api_health'),started=now(),health=await requestHealth(),durationMs=Math.ceil(now()-started);
 validateHealth(health,binding.claims);if(!Number.isSafeInteger(durationMs)||durationMs<0||durationMs>HEALTH_TIMEOUT_MS)reject();
 const evidence={releaseSha:binding.claims.mergeMainSha,operationId:binding.operationId,stageAttemptId:binding.stageAttemptId,
  epochRunId:binding.claims.epochRunId,workspace:binding.claims.workspace,principal:binding.claims.principal,
  apiGeneration:binding.claims.apiGeneration,workerGeneration:binding.claims.workerGeneration,endpoint:PRODUCTION_HEALTH_URL,
  apiHealthy:true,workerHealthy:true,durationMs};
 return Object.freeze({status:'PASS',evidence:Object.freeze({...evidence,observationDigest:hash(evidence)})});
}

function heldResults(context){
 const history=inspectHeldAcceptanceHistory(context.journal.stream('release').events());
 const rows=context.journal.stream('release').events().filter(row=>row?.type==='held_acceptance_operation_result');
 if(rows.length!==history.completed.length)return null;
 return Object.fromEntries(rows.map(row=>[row.operation,row.evidence]));
}

export async function observeFixedProductionSmoke({context,call,requestHealth=requestFixedProductionHealth,now=()=>performance.now()}){
 const binding=invocation(context,call,'production_smoke'),prior=heldResults(context);
 const api=prior?.api_health,worker=prior?.worker_readiness,fence=prior?.generation_fence,reads=prior?.six_live_reads;
 if(!api||!worker||!fence||!reads||api.status!=='PASS'||worker.status!=='PASS'||fence.status!=='PASS'
  ||![api.observationDigest,worker.observationDigest,fence.observationDigest,reads.collectorDigest].every(digest)
  ||reads.status!=='PASS_LIVE_ACCEPTANCE'||reads.livePass!==true||reads.readCount!==6||reads.crossOwnerDenials!==6
  ||reads.paidProviderCalls!==0||reads.mutationDelta!==0)reject();
 const started=now(),health=await requestHealth(),durationMs=Math.ceil(now()-started),currentWorker=validateHealth(health,binding.claims);
 if(!Number.isSafeInteger(durationMs)||durationMs<0||durationMs>HEALTH_TIMEOUT_MS)reject();
 const evidence={releaseSha:binding.claims.mergeMainSha,operationId:binding.operationId,stageAttemptId:binding.stageAttemptId,
  epochRunId:binding.claims.epochRunId,workspace:binding.claims.workspace,principal:binding.claims.principal,
  apiGeneration:binding.claims.apiGeneration,workerGeneration:binding.claims.workerGeneration,apiHealthy:true,workerReady:true,
  generationCurrent:currentWorker.generationId===binding.claims.workerGeneration,exactRuntimeSha:true,staleWorker:false,
  acceptancePathSucceeded:true,unexpectedMutation:false,paidProviderActivity:false,readCount:6,crossOwnerDenials:6,
  collectorDigest:reads.collectorDigest,durationMs};
 return Object.freeze({status:'PASS',evidence:Object.freeze({...evidence,observationDigest:hash(evidence)})});
}

function operation(context,name,observe){
 const check=({input,state,ordinal})=>{
  if(input!==context.input||!Number.isSafeInteger(ordinal)||ordinal<0)reject();
  const {claims}=claimsFor(context,state,name),evidence={releaseSha:claims.mergeMainSha,operationId:state.context.operationId,
   epochRunId:claims.epochRunId,workspace:claims.workspace,principal:claims.principal,apiGeneration:claims.apiGeneration,workerGeneration:claims.workerGeneration};
  return{status:'PASS',evidence:{...evidence,bindingDigest:hash(evidence)}};
 };
 return Object.freeze({check,observe:call=>observe({context,call}),execute:call=>{invocation(context,call,name);},reconcile:call=>observe({context,call})});
}

export function createHealthSmokeProductionOperations(context,{requestHealth=requestFixedProductionHealth,now=()=>performance.now()}={}){
 if(typeof requestHealth!=='function'||typeof now!=='function')reject();
 return Object.freeze({
  api_health:operation(context,'api_health',args=>observeFixedApiHealth({...args,requestHealth,now})),
  production_smoke:operation(context,'production_smoke',args=>observeFixedProductionSmoke({...args,requestHealth,now})),
 });
}
