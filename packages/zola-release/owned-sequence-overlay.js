import {createHash} from 'node:crypto';
export const OWNED_SEQUENCE=Object.freeze({releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',previousMainSha:'f3ac3d33c00885de3ebc6d7f5313a4965e75f0e8',retirementProofDigest:'d38512c835293518d9b065c32dff8094090b7e7c30fcf5c5bd0a2010823de04a'});
export const OWNED_SEQUENCE_SOURCE_HASHES=Object.freeze({'commander-sequence.js':'b000f0490d375b25ff6f54611aee3526d60c1e6a4c513e9f885bea2a451bd20a','retired-release-history.js':'3073341934dc28a837a41ea6cbd11bf15fdaaf429451a33dda1c3bac76f1dfd4'});
const extendedSourceHashes=Object.freeze({"commander-sequence.js":"e48ac2e64de33c0d1ca1aac6914746b9160a0974b80d9341ae0eaba45ada613a","retired-release-history.js":"c261bbe9b10aad4a2bd4f5ebb633d5be3388b612a7fabc30c54baabf47aca094"});
const fail=()=>{throw Error('Fixed owned sequence overlay refused');};
const selector=name=>`${name}.schema===5&&${name}.successorReleaseSha==='${OWNED_SEQUENCE.releaseSha}'&&${name}.successorOperationId==='${OWNED_SEQUENCE.operationId}'&&${name}.proofDigest==='${OWNED_SEQUENCE.retirementProofDigest}'`;
export function transformOwnedSequenceSource(name,source){
 if(!Object.hasOwn(OWNED_SEQUENCE_SOURCE_HASHES,name)||typeof source!=='string')fail();
 const sourceDigest=createHash('sha256').update(source).digest('hex');
 const extended=sourceDigest===extendedSourceHashes[name];
 if(!extended&&sourceDigest!==OWNED_SEQUENCE_SOURCE_HASHES[name])fail();
 if(extended&&name==='commander-sequence.js'){
  const needle="state.retired.schema===6?MIXED_RETIREMENT.previousMainSha:'2775fd5043ad422418a4177f686671961e9a9738'";
  const parts=source.split(needle);if(parts.length!==2)fail();
  return parts.join("state.retired.schema===6?MIXED_RETIREMENT.previousMainSha:("+selector('state.retired')+"?'"+OWNED_SEQUENCE.previousMainSha+"':'2775fd5043ad422418a4177f686671961e9a9738')");
 }
 const old=name==='commander-sequence.js'?"input.previousMainSha!=='2775fd5043ad422418a4177f686671961e9a9738'":'start.previousMainSha!==BLOCKED_RELEASE.previousMainSha';
 const oldMain=name==='commander-sequence.js'?"'2775fd5043ad422418a4177f686671961e9a9738'":'BLOCKED_RELEASE.previousMainSha';
 const selected=name==='commander-sequence.js'?'state.retired':'event',field=name==='commander-sequence.js'?'input':'start';
 // The first parser occurrence is exclusively the validated schema-five branch.
 const index=source.indexOf(old);if(index<0)fail();
 return source.slice(0,index)+`${field}.previousMainSha!==(${selector(selected)}?'${OWNED_SEQUENCE.previousMainSha}':${oldMain})`+source.slice(index+old.length);
}
export function assertOwnedSequenceState(release,state){
 const r=state?.retired;
 if(release?.schema!==3||release.releaseSha!==OWNED_SEQUENCE.releaseSha||release.operationId!==OWNED_SEQUENCE.operationId||release.previousMainSha!==OWNED_SEQUENCE.previousMainSha
  ||r?.schema!==5||r.successorReleaseSha!==OWNED_SEQUENCE.releaseSha||r.successorOperationId!==OWNED_SEQUENCE.operationId||r.proofDigest!==OWNED_SEQUENCE.retirementProofDigest
  ||state.started&&(state.context.releaseSha!==release.releaseSha||state.context.operationId!==release.operationId||state.context.previousMainSha!==release.previousMainSha))fail();
 return true;
}
