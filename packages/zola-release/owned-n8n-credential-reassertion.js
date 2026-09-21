import {createHash} from 'node:crypto';
export const N8N_REASSERTION=Object.freeze({releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',originalOperatorSha:'5c7cc20350025db8339d8210a496a78cb51f6af4',credentialId:'RzOyDmXYmx58yZHi'});
export const n8nReassertionDigest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),digest=v=>/^[a-f0-9]{64}$/.test(v??''),sha=v=>/^[a-f0-9]{40}$/.test(v??'');
const fail=()=>{throw Error('Owned n8n administrative reassertion refused; preserve UNKNOWN intent');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const route='/api/v1/credentials/'+N8N_REASSERTION.credentialId;
function metadata(v){
 if(!exact(v,'id,name,type,isManaged,isGlobal,isResolvable,resolvableAllowFallback,resolverId,createdAt,updatedAt')||v.id!==N8N_REASSERTION.credentialId||v.name!=='ZOLA Buyer writer'||v.type!=='httpHeaderAuth'||v.isManaged!==false||v.isGlobal!==false||v.isResolvable!==false||v.resolvableAllowFallback!==false||v.resolverId!==null||[v.createdAt,v.updatedAt].some(t=>typeof t!=='string'||!Number.isFinite(Date.parse(t))))fail();return v;
}
const identity=v=>({...v,updatedAt:null});
export function ownedN8nReassertionBody(source){
 if(typeof source?.writerCredential!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(source.writerCredential))fail();
 return {data:{name:'x-buyer-writer-key',value:source.writerCredential,allowedHttpRequestDomains:'domains',allowedDomains:'jarvis.blackspirehelix.com'},isPartialData:false};
}
function binding(input){
 const {authority:a,originalIntent:i,originalResult:r,source,operatorSha}=input;
 if(r!==null||a?.operatorSha!==N8N_REASSERTION.originalOperatorSha||a.releaseSha!==N8N_REASSERTION.releaseSha||a.operationId!==N8N_REASSERTION.operationId||!sha(operatorSha)||operatorSha===a.operatorSha||!digest(a.sourceDigest)||!digest(a.profileDigest)||typeof a.namespace!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(a.stageAttemptId??'')
  ||i?.binding?.releaseSha!==a.releaseSha||i.binding.profileDigest!==a.profileDigest||i.binding.sourceDigest!==a.sourceDigest||i.binding.namespace!==a.namespace||i.binding.credentialId!==N8N_REASSERTION.credentialId
  ||source?.authority?.releaseSha!==a.releaseSha||source.authority.operationId!==a.operationId)fail();metadata(i.before);
 return {version:1,releaseSha:a.releaseSha,operationId:a.operationId,stageAttemptId:a.stageAttemptId,credentialId:N8N_REASSERTION.credentialId,operatorSha,authorityDigest:n8nReassertionDigest(a),originalIntentDigest:n8nReassertionDigest(i),sourceDigest:a.sourceDigest,bodyDigest:n8nReassertionDigest(ownedN8nReassertionBody(source))};
}
function closureProof(v){if(!exact(v,'version,ownerCount,projectCount,workflowCount,credentialReferences,buyerInactive,executionsDrained,digest,ownerDigest,projectDigest,workflows')||v.version!==1||v.ownerCount!==1||v.projectCount!==1||v.workflowCount!==8||v.credentialReferences!==0||v.buyerInactive!==true||v.executionsDrained!==true||!digest(v.digest)||!digest(v.ownerDigest)||!digest(v.projectDigest)||!Array.isArray(v.workflows)||v.workflows.length!==8||new Set(v.workflows.map(w=>w.id)).size!==8||v.workflows.some(w=>!exact(w,'id,versionId,active,definitionDigest')||typeof w.id!=='string'||typeof w.versionId!=='string'||typeof w.active!=='boolean'||!digest(w.definitionDigest)))fail();return v;}
function intentProof(input,intent){const b=binding(input);if(!exact(intent,'version,kind,binding,before,closure')||intent.version!==1||intent.kind!=='owned-n8n-credential-reassertion-intent'||!same(intent.binding,b)||!same(identity(metadata(intent.before)),identity(metadata(input.originalIntent.before))))fail();closureProof(intent.closure);return b;}
function acknowledged(intent,ack){if(!exact(ack,'version,bindingDigest,status,responseDigest,after')||ack.version!==1||ack.bindingDigest!==n8nReassertionDigest(intent.binding)||ack.status!==200||!digest(ack.responseDigest)||!same(identity(metadata(ack.after)),identity(intent.before))||Date.parse(ack.after.updatedAt)<Date.parse(intent.before.updatedAt)||ack.responseDigest!==n8nReassertionDigest(ack.after))fail();return ack.after;}
const resultFor=(intent,ack)=>({version:1,kind:'owned-n8n-credential-reassertion-result',binding:intent.binding,intentDigest:n8nReassertionDigest(intent),httpAckDigest:n8nReassertionDigest(ack),after:ack.after,originalOutcome:'UNKNOWN',providerExtraEffects:'UNVERIFIED',reasserted:true});
export function validateOwnedN8nReassertionProof({intent,httpAck,result,...input}){const b=intentProof(input,intent),after=acknowledged(intent,httpAck);if(!same(result,resultFor(intent,httpAck)))fail();return {after,binding:b,bodyDigest:b.bodyDigest};}
export async function reassertOwnedN8nWriter(input,{request,store,fence,closure}){
 const b=binding(input);await fence();let intent=store.value('intent',true),ack=store.value('http-ack',true),result=store.value('result',true);
 if((ack||result)&&!intent||result&&!ack)fail();
 const observe=async()=>{await fence();const r=await request('GET',route);if(r?.status!==200)fail();const current=metadata(r.body),c=closureProof(await closure());await fence();return {current,closure:c};};
 if(intent){intentProof(input,intent);if(!ack)fail();acknowledged(intent,ack);
  const now=await observe();if(!same(now.current,ack.after)||!same(now.closure,intent.closure))fail();
  if(result)validateOwnedN8nReassertionProof({...input,intent,httpAck:ack,result});
  else{store.record('intent',intent);store.record('http-ack',ack);result=resultFor(intent,ack);store.record('result',result);}
  store.record('intent',intent);store.record('http-ack',ack);store.record('result',result);await fence();return result;
 }
 const before=await observe();if(!same(identity(before.current),identity(metadata(input.originalIntent.before))))fail();
 intent={version:1,kind:'owned-n8n-credential-reassertion-intent',binding:b,before:before.current,closure:before.closure};intentProof(input,intent);
 store.record('intent',intent);await fence();
 // Exactly one dispatch. Any thrown transport result leaves an immutable unknown intent.
 const response=await request('PATCH',route,ownedN8nReassertionBody(input.source));
 if(!Number.isInteger(response?.status)||response.status<100||response.status>599)fail();
 let after=null;try{if(response.status===200)after=metadata(response.body);}catch{/* Retain malformed acknowledgment before refusal. */}
 ack={version:1,bindingDigest:n8nReassertionDigest(b),status:response.status,responseDigest:n8nReassertionDigest(response.body??null),after};store.record('http-ack',ack);
 acknowledged(intent,ack);const now=await observe();if(!same(now.current,after)||!same(now.closure,intent.closure))fail();
 result=resultFor(intent,ack);store.record('result',result);await fence();return result;
}
