import {n8nReassertionDigest as hash,ownedN8nReassertionBody} from './owned-n8n-credential-reassertion.js';
const fixed={releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',stageAttemptId:'f163d812-3711-471b-863a-038e85d59137'};
const originalSha='5c7cc20350025db8339d8210a496a78cb51f6af4',reassertionSha='567b7acbdf16b4e784d235e97709e4fec2adb157';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),digest=v=>/^[a-f0-9]{64}$/.test(v??'');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const fail=()=>{throw Error('Owned n8n cloud continuation refused');};
// History remains truthful: absent original result and separately acknowledged405.
// This is not a validator for a successful credential replacement.
export function validateOwnedN8nCloudHistory({authority,originalIntent,originalResult,reassertion,source,plan}){
 if(!authority||authority.operatorSha!==originalSha||Object.entries(fixed).some(([k,v])=>authority[k]!==v||plan?.[k]!==v)
  ||originalResult!==null||!exact(reassertion,'intent,httpAck,result,headers,body')||reassertion.result!==null
  ||!digest(authority.sourceDigest)||!digest(authority.profileDigest)||source?.authority?.releaseSha!==fixed.releaseSha||source.authority.operationId!==fixed.operationId)fail();
 const old=originalIntent?.binding,intent=reassertion.intent,ack=reassertion.httpAck,headers=reassertion.headers,body=reassertion.body;
 if(!old||old.releaseSha!==fixed.releaseSha||old.profileDigest!==authority.profileDigest||old.sourceDigest!==authority.sourceDigest||old.namespace!==authority.namespace||old.credentialId!=='RzOyDmXYmx58yZHi')fail();
 const binding={version:1,...fixed,credentialId:'RzOyDmXYmx58yZHi',operatorSha:reassertionSha,authorityDigest:hash(authority),originalIntentDigest:hash(originalIntent),sourceDigest:authority.sourceDigest,bodyDigest:hash(ownedN8nReassertionBody(source))};
 if(!exact(intent,'version,kind,binding,before,closure')||intent.version!==1||intent.kind!=='owned-n8n-credential-reassertion-intent'||!same(intent.binding,binding)
  ||!exact(ack,'version,bindingDigest,status,responseDigest,after')||ack.version!==1||ack.status!==405||ack.after!==null||ack.bindingDigest!==hash(binding)||!digest(ack.responseDigest)
  ||!same(headers,{version:1,status:405,method:'PATCH',credentialId:binding.credentialId,bodyDigest:binding.bodyDigest,operatorSha:reassertionSha})
  ||!exact(body,'version,status,complete,bytes,rawDigest,responseDigest')||body.version!==1||body.status!==405||body.complete!==true||!Number.isInteger(body.bytes)||body.bytes<1||body.bytes>2*1024*1024||!digest(body.rawDigest)||body.responseDigest!==ack.responseDigest)fail();
 for(const [k,v]of Object.entries({authorityDigest:hash(authority),originalIntentDigest:hash(originalIntent),reassertionIntentDigest:hash(intent),reassertionAckDigest:hash(ack),reassertionHeadersDigest:hash(headers),reassertionBodyDigest:hash(body),sourceDigest:authority.sourceDigest,profileDigest:authority.profileDigest}))if(plan[k]!==v)fail();
 return Object.freeze({originalOutcome:'UNKNOWN',administrativeReassertionStatus:405,historyDigest:hash({authority,originalIntent,originalResult,reassertion}),initialClosure:intent.closure});
}

// All reads occur under the existing continuous HELD lease. Neither callback
// accepts a mutation transport or a writable receipt store.
export function createOwnedN8nCloudContinuation({withFence,proof,metadata,closure}){
 if([withFence,proof,metadata,closure].some(fn=>typeof fn!=='function'))fail();
 const observe=async binding=>withFence(binding,async fence=>{
  const before=await proof(binding);await fence();
  const first=await metadata();if(!same(first,before.after))fail();
  const a=await closure(binding,before.initialClosure);await fence();
  const second=await metadata();if(!same(second,first))fail();
  const b=await closure(binding,before.initialClosure);if(!same(a,b))fail();
  await fence();const after=await proof(binding);if(!same(before,after))fail();await fence();
 });
 return Object.freeze({assertConfigured:observe,synchronize:observe});
}
