import {prepareBuyerWorkflowPackage} from '../buyer-writer/n8n-package.js';
import {hash} from './commander-journal.js';

export const N8N_ORIGIN='https://cpearson0312.app.n8n.cloud';
export const WORKFLOW_ID='VvMHSIbycYCx4CZN';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=value=>hash(JSON.stringify(canonical(value)));
const reject=code=>{const error=new Error('Zola workflow transition refused');error.code=code;throw error;};
const authored=value=>({name:value.name,nodes:value.nodes,connections:value.connections,settings:value.settings});
const graph=value=>({nodes:value.nodes,connections:value.connections});
const emptyData=value=>value==null||(typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0);
const preparedPlans=new WeakSet();
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

export function prepareN8nTransition({configuration,backupBytes}){
 try{
  const prepared=prepareBuyerWorkflowPackage(configuration);
  if(!prepared.payload||configuration.workflowId!==WORKFLOW_ID||configuration.gatewayOrigin!=='https://jarvis.blackspirehelix.com'
   ||hash(backupBytes)!==configuration.backupSha256)reject('PACKAGE_REJECTED');
  const backup=JSON.parse(backupBytes),candidate=JSON.parse(prepared.payload);
  if(!emptyData(backup.staticData)||!emptyData(backup.pinData)||backup.id!==WORKFLOW_ID||backup.active!==true||backup.versionId!==configuration.workflowVersion||backup.activeVersionId!==backup.versionId
   ||backup.activeVersion?.versionId!==backup.versionId||backup.activeVersion?.workflowId!==WORKFLOW_ID
   ||digest(graph(backup.activeVersion))!==digest(graph(backup)))reject('BACKUP_REJECTED');
  // Public PUT accepts only documented writable fields. Never send pinData or
  // active/version metadata, and never PUT while the workflow is still active.
  if(Object.keys(candidate.pinData??{}).length)reject('PACKAGE_REJECTED');
  const payload=authored(candidate);
  const plan=Object.freeze({releaseSha:configuration.releaseSha,baselineVersion:backup.versionId,
   baselineDigest:digest(authored(backup)),candidateDigest:digest(payload),candidateGraphDigest:digest(graph(payload)),
   backupSha256:configuration.backupSha256,namespace:digest({workflowId:WORKFLOW_ID,backupSha256:configuration.backupSha256,payload}),
   credentialIds:Object.freeze([configuration.ingressCredentialId,configuration.writerCredentialId]),payload:freeze(payload)});
  preparedPlans.add(plan);return plan;
 }catch{reject('PACKAGE_REJECTED');}
}

function observation(value,plan,allowRetainedData=false){
 if(!value||(!allowRetainedData&&(!emptyData(value.staticData)||!emptyData(value.pinData)))||value.id!==WORKFLOW_ID||!uuid(value.versionId)||typeof value.active!=='boolean'
  ||!Array.isArray(value.nodes)||!value.connections||!value.settings)reject('WORKFLOW_SCHEMA_REJECTED');
 const current=digest(authored(value));
 const kind=current===plan.baselineDigest?'BASELINE':current===plan.candidateDigest?'CANDIDATE':'DRIFT';
 if(kind==='DRIFT'||(kind==='BASELINE'&&value.versionId!==plan.baselineVersion))reject('WORKFLOW_DRIFT');
 if(value.active){
  if(value.activeVersionId!==value.versionId||value.activeVersion?.versionId!==value.versionId
   ||value.activeVersion?.workflowId!==WORKFLOW_ID||digest(graph(value.activeVersion))!==digest(graph(value)))reject('PUBLISHED_VERSION_DRIFT');
 }else if(value.activeVersionId!==null||value.activeVersion!=null)reject('INACTIVE_STATE_AMBIGUOUS');
 return{kind,active:value.active,versionId:value.versionId,definitionDigest:current};
}

// Bounded concrete transport; errors never include body, key or URL. Tests may
// inject a transport, but the production CLI cannot configure origins or paths.
export function createN8nTransport(apiKey,{fetchImpl=fetch,origin=N8N_ORIGIN}={}){
 if(typeof apiKey!=='string'||apiKey.length<20||apiKey.length>16384||/[\r\n\s]/.test(apiKey))reject('KEY_REJECTED');
 return async(method,pathname,body)=>{
  if(!['GET','PUT','POST'].includes(method)||!/^\/api\/v1\/(?:workflows\/VvMHSIbycYCx4CZN(?:\/(?:activate|deactivate))?|executions(?:\?[^#]*)?|credentials(?:\?[^#]*)?)$/.test(pathname))reject('REQUEST_REJECTED');
  try{
   const response=await fetchImpl(origin+pathname,{method,headers:{'X-N8N-API-KEY':apiKey,...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(response.redirected||!response.ok)reject('REMOTE_REJECTED');
   if(response.status===204)return null;
   if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)reject('RESPONSE_REJECTED');
   const chunks=[];let size=0;const reader=response.body.getReader();
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2*1024*1024)reject('RESPONSE_REJECTED');chunks.push(part.value);}}
   finally{await reader.cancel().catch(()=>{});}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }catch{reject('REMOTE_OUTCOME_UNKNOWN');}
 };
}

async function inventory(request,pathname){
 const rows=[],cursors=new Set();let cursor;
 for(let page=0;page<100;page++){
  const query=new URLSearchParams({limit:'100',...(pathname==='executions'?{workflowId:WORKFLOW_ID,includeData:'false'}:{}),...(cursor?{cursor}:{})});
  const result=await request('GET',`/api/v1/${pathname}?${query}`);
  if(!result||!Array.isArray(result.data)||result.data.length>100||!Object.hasOwn(result,'nextCursor'))reject('INVENTORY_INCOMPLETE');
  rows.push(...result.data);
  if(result.nextCursor===null||result.nextCursor==='')return rows;
  if(typeof result.nextCursor!=='string'||result.nextCursor.length>2048||cursors.has(result.nextCursor))reject('INVENTORY_INCOMPLETE');
  cursor=result.nextCursor;cursors.add(cursor);
 }
 reject('INVENTORY_INCOMPLETE');
}

export async function executeN8nTransition({plan,mode,request,journal,verifyWriter,exclusiveWindowUntil,now=()=>Date.now()}){
 if(!preparedPlans.has(plan)||!['inspect','deactivate','update','publish','rollback','reconcile'].includes(mode))reject('COMMAND_REJECTED');
 const base=`/api/v1/workflows/${WORKFLOW_ID}`;
 const events=journal.events();
 if(events.some(event=>event.namespace!==plan.namespace))reject('JOURNAL_PLAN_MISMATCH');
 const record=(type,details={})=>journal.append({type,namespace:plan.namespace,releaseSha:plan.releaseSha,...details});
 const observe=async()=>observation(await request('GET',base),plan,mode==='rollback'||mode==='reconcile');
 let current=await observe();
 if(mode==='inspect'||mode==='reconcile'){
  const again=await observe();if(digest(current)!==digest(again))reject('WORKFLOW_DRIFT');
  const pending=events.filter(event=>event.type==='intent'&&!events.some(done=>done.type==='confirmed'&&done.operation===event.operation));
  if(mode==='reconcile'&&pending.length){
   if(pending.length!==1)reject('JOURNAL_STATE_AMBIGUOUS');
   const intent=pending[0],target=intent.target;
   if(current.kind!==target.kind||current.active!==target.active||(target.versionId&&current.versionId!==target.versionId)
    ||(intent.operation==='update'&&current.versionId===plan.baselineVersion))reject('OUTCOME_UNKNOWN_RECONCILE_ONLY');
   record('confirmed',{operation:intent.operation,state:current,reconciled:true});
  }
  record('observation',{state:current});
  return{status:'OBSERVED',state:current,mutationSent:false,releaseReady:false};
 }
 const beforeIntents=events.filter(event=>event.type==='intent');
 if(beforeIntents.some(event=>event.operation===mode))reject('PRIOR_INTENT_RECONCILE_ONLY');
 // Every previous operation must have a positively confirmed target. A GET
 // showing the old state after lost acknowledgement never authorizes retry.
 for(const intent of mode==='rollback'?[]:beforeIntents){
  if(!events.some(event=>event.type==='confirmed'&&event.operation===intent.operation))reject('PRIOR_INTENT_RECONCILE_ONLY');
 }
 const windowCheck=()=>{
  const until=Date.parse(exclusiveWindowUntil),time=now();
  if(!Number.isFinite(until)||until<=time||until-time>15*60*1000)reject('EXCLUSIVE_WINDOW_REQUIRED');
 };
 windowCheck();
 if(mode!=='rollback')await verifyWriter();
 if(mode!=='rollback'){
  const credentials=await inventory(request,'credentials');
  if(new Set(credentials.map(row=>row.id)).size!==credentials.length||plan.credentialIds.some(id=>credentials.filter(row=>row.id===id&&row.type==='httpHeaderAuth').length!==1))reject('CREDENTIALS_UNRESOLVED');
 }
 let target,method='POST',pathname;
 if(mode==='deactivate'){
  if(current.kind!=='BASELINE'||!current.active)reject('TRANSITION_REJECTED');
  target={...current,active:false};pathname=base+'/deactivate';
 }else if(mode==='update'){
  if(current.kind!=='BASELINE'||current.active||!events.some(event=>event.type==='confirmed'&&event.operation==='deactivate'))reject('TRANSITION_REJECTED');
  target={kind:'CANDIDATE',active:false};method='PUT';pathname=base;
 }else if(mode==='publish'){
  if(current.kind!=='CANDIDATE'||current.active||!events.some(event=>event.type==='confirmed'&&event.operation==='update'&&event.state.versionId===current.versionId))reject('TRANSITION_REJECTED');
  target={...current,active:true};pathname=base+'/activate';
 }else{
  if(current.kind!=='CANDIDATE'||!current.active)reject('TRANSITION_REJECTED');
  target={...current,active:false};pathname=base+'/deactivate';
 }
 if(mode==='update'||mode==='publish'){
  const executions=await inventory(request,'executions');
  if(new Set(executions.map(row=>row.id)).size!==executions.length||executions.some(row=>row.workflowId!==WORKFLOW_ID||row.finished!==true||!row.stoppedAt||!['success','error','canceled','crashed'].includes(row.status)))reject('EXECUTIONS_NOT_QUIESCENT');
 }
 const repeated=await observe();if(digest(current)!==digest(repeated))reject('WORKFLOW_DRIFT');
 if(mode!=='rollback')await verifyWriter();
 windowCheck();
 const body=mode==='update'?plan.payload:mode==='publish'?{versionId:current.versionId}:{};
 record('intent',{operation:mode,before:current,target}); // fsync before send
 let acknowledged=false;
 try{await request(method,pathname,body);acknowledged=true;}catch{/* never retry */}
 record('response',{operation:mode,acknowledged});
 try{
  current=await observe();
  if(current.kind!==target.kind||current.active!==target.active||(target.versionId&&current.versionId!==target.versionId))reject('TARGET_NOT_CONFIRMED');
  if(mode==='update'&&current.versionId===plan.baselineVersion)reject('TARGET_NOT_CONFIRMED');
  const repeated=await observe();if(digest(current)!==digest(repeated))reject('WORKFLOW_DRIFT');
  record('confirmed',{operation:mode,state:current});
  if(mode==='publish')await verifyWriter();
  return{status:'CONFIRMED',state:current,mutationSent:true,acknowledged,releaseReady:false};
 }catch{record('unknown',{operation:mode});reject('OUTCOME_UNKNOWN_RECONCILE_ONLY');}
}
