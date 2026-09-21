import {createHash} from 'node:crypto';
import {N8N_ORIGIN,WORKFLOW_ID} from './commander-n8n.js';
export const OWNED_N8N_WRITER_ID='RzOyDmXYmx58yZHi';
export const OWNED_N8N_INTAKE_ID='9DiTRFOJnwA6Aw9y';
const fail=()=>{throw new Error('Owned n8n writer synchronization refused; retained intent requires reconciliation');};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const same=(a,b)=>digest(a)===digest(b);
const path='/api/v1/credentials/'+OWNED_N8N_WRITER_ID;
const fields=['id','name','type','isManaged','isGlobal','isResolvable','resolvableAllowFallback','resolverId','createdAt','updatedAt'];
function metadata(v){
 if(!v||Object.keys(v).length!==fields.length||fields.some(k=>!Object.hasOwn(v,k))||v.id!==OWNED_N8N_WRITER_ID
  ||v.name!=='ZOLA Buyer writer'||v.type!=='httpHeaderAuth'||v.isManaged!==false||v.isGlobal!==false
  ||v.isResolvable!==false||v.resolvableAllowFallback!==false||v.resolverId!==null
  ||[v.createdAt,v.updatedAt].some(t=>typeof t!=='string'||!Number.isFinite(Date.parse(t))))fail();
 return v;
}
const identity=v=>({...v,updatedAt:null});
export function createOwnedN8nCredentialTransport(apiKey,{fetchImpl=fetch}={}){
 if(typeof apiKey!=='string'||apiKey.length<20||apiKey.length>16384||/\s/.test(apiKey))fail();
 return async(method,route,body)=>{
  if(!((method==='PATCH'&&route===path)||(method==='GET'&&(route===path||route==='/api/v1/credentials/schema/httpHeaderAuth'||route===`/api/v1/workflows/${WORKFLOW_ID}`||/^\/api\/v1\/executions\?/.test(route)))))fail();
  if(method==='GET'&&body!==undefined)fail();
  if(method==='PATCH'&&(!same(Object.keys(body??{}).sort(),['data','isPartialData'])||body.isPartialData!==false
   ||!same(Object.keys(body.data??{}).sort(),['allowedDomains','allowedHttpRequestDomains','name','value'])
   ||body.data.name!=='x-buyer-writer-key'||body.data.allowedHttpRequestDomains!=='domains'||body.data.allowedDomains!=='jarvis.blackspirehelix.com'
   ||typeof body.data.value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.data.value)))fail();
  try{
   const r=await fetchImpl(N8N_ORIGIN+route,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{'X-N8N-API-KEY':apiKey,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   if(r.status!==200||r.redirected||!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??'')||!r.body)fail();
   const parts=[];let size=0;const reader=r.body.getReader();try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>2*1024*1024)fail();parts.push(p.value);}}finally{await reader.cancel().catch(()=>{});}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  }catch{fail();}
 };
}
async function idle(request,plan){
 const w=await request('GET',`/api/v1/workflows/${WORKFLOW_ID}`);
 const graph=digest({name:w?.name,nodes:w?.nodes,connections:w?.connections,settings:w?.settings});
 if(w?.id!==WORKFLOW_ID||w.active!==false||w.activeVersionId!==null||w.activeVersion!=null
  ||![plan.baselineDigest,plan.candidateDigest].includes(graph)||graph===plan.baselineDigest&&w.versionId!==plan.baselineVersion
  ||(w.pinData!=null&&Object.keys(w.pinData).length)||(w.staticData!=null&&Object.keys(w.staticData).length))fail();
 let cursor;const cursors=new Set(),executionIds=new Set();
 for(let page=0;page<100;page++){
  const query=new URLSearchParams({limit:'100',workflowId:WORKFLOW_ID,includeData:'false',...(cursor?{cursor}:{})});
  const r=await request('GET','/api/v1/executions?'+query);
  if(!r||!Array.isArray(r.data)||r.data.length>100||!Object.hasOwn(r,'nextCursor'))fail();
  for(const e of r.data){if(typeof e.id!=='string'||executionIds.has(e.id)||e.workflowId!==WORKFLOW_ID||!['success','error','canceled','crashed'].includes(e.status)||e.finished!==true||!Number.isFinite(Date.parse(e.stoppedAt)))fail();executionIds.add(e.id);}
  if(r.nextCursor===null||r.nextCursor==='')return {versionId:w.versionId,graph};
  if(typeof r.nextCursor!=='string'||r.nextCursor.length>2048||cursors.has(r.nextCursor))fail();cursor=r.nextCursor;cursors.add(cursor);
 }
 fail();
}
// The store is root-only durable immutable records. A pending request cannot be
// inferred successful from metadata: the public API deliberately hides data.
export async function synchronizeOwnedN8nWriter({plan,writerCredential,profileDigest,sourceDigest},{request,store,fence}){
 if(!plan||!same(plan.credentialIds,[OWNED_N8N_INTAKE_ID,OWNED_N8N_WRITER_ID])||!/^[a-f0-9]{40}$/.test(plan.releaseSha??'')
  ||[profileDigest,sourceDigest].some(v=>!/^[a-f0-9]{64}$/.test(v??''))||typeof writerCredential!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(writerCredential))fail();
 await fence();const current=metadata(await request('GET',path));
 const workflow=await idle(request,plan);
 const binding={version:1,releaseSha:plan.releaseSha,profileDigest,sourceDigest,namespace:plan.namespace,credentialId:OWNED_N8N_WRITER_ID,workflow};
 const intent=store.value('intent',true),result=store.value('result',true);
 if(result&&!intent)fail();
 if(intent){
  if(!same(intent.binding,binding)||!same(identity(intent.before),identity(current)))fail();
  if(!result||!same(result.binding,binding)||!same(result.after,current))fail();
  await fence();return {status:'OWNED_N8N_WRITER_CONFIGURED',releaseSha:plan.releaseSha,productionAccepted:false};
 }
 const schema=await request('GET','/api/v1/credentials/schema/httpHeaderAuth');
 if(schema?.additionalProperties!==false||schema.type!=='object'||!same(Object.keys(schema.properties??{}).sort(),['allowedDomains','allowedHttpRequestDomains','name','useCustomAuth','value'])
  ||schema.properties.name.type!=='string'||schema.properties.value.type!=='string'||schema.properties.allowedDomains.type!=='string'
  ||!same(schema.properties.allowedHttpRequestDomains.enum,['all','domains','none'])||!same(schema.required,[]))fail();
 if(!same(workflow,await idle(request,plan))||!same(current,metadata(await request('GET',path))))fail();
 await fence();store.record('intent',{binding,before:current});await fence();
 const after=metadata(await request('PATCH',path,{data:{name:'x-buyer-writer-key',value:writerCredential,allowedHttpRequestDomains:'domains',allowedDomains:'jarvis.blackspirehelix.com'},isPartialData:false}));
 if(!same(identity(current),identity(after))||Date.parse(after.updatedAt)<Date.parse(current.updatedAt))fail();
 await fence();if(!same(workflow,await idle(request,plan))||!same(after,metadata(await request('GET',path))))fail();
 store.record('result',{binding,after});await fence();
 return {status:'OWNED_N8N_WRITER_CONFIGURED',releaseSha:plan.releaseSha,productionAccepted:false};
}
