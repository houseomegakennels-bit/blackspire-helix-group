import {PARTIAL_RELEASE,validatePartialRetirementEvent} from './partial-retirement-history.js';
import {MIXED_RETIREMENT,validateMixedRetirementEvent} from './mixed-retirement-history.js';
const fail=()=>{throw Error('SUCCESSOR_RUNTIME_PREDECESSOR_REFUSED');};
export function successorRuntimePredecessor(releaseSha){
 if(typeof releaseSha!=='string'||!(/^[a-f0-9]{40}$/).test(releaseSha))fail();
 return releaseSha===MIXED_RETIREMENT.successorReleaseSha?MIXED_RETIREMENT:PARTIAL_RELEASE;
}
export function validateSuccessorRetirement(event,releaseSha){
 const p=successorRuntimePredecessor(releaseSha);
 if(!event||typeof event!=='object')fail();
 const {historicalMutationState,status,...raw}=event;
 if((Object.hasOwn(event,'historicalMutationState')||Object.hasOwn(event,'status'))
  &&(historicalMutationState!==true||status!=='RETIRED_WITH_RETAINED_EFFECTS'))fail();
 if(p===MIXED_RETIREMENT)validateMixedRetirementEvent(raw);else validatePartialRetirementEvent(raw);
 if(event.successorReleaseSha!==releaseSha||event.releaseSha!==p.releaseSha)fail();
 return p;
}
export function successorCanonicalRoot(releaseSha){
 return successorRuntimePredecessor(releaseSha)===MIXED_RETIREMENT
  ?'/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-successor-20260924'
  :'/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921';
}
export async function observeRuntimeSuccessorLineage(request){
 if(successorRuntimePredecessor(request.releaseSha)===MIXED_RETIREMENT){
  const {observeMixedSuccessorLineage}=await import('./mixed-successor-preparation.js');
  return observeMixedSuccessorLineage(request);
 }
 const {observeOwnedMigrationSuccessor}=await import('../buyer-writer/owned-migration-successor.js');
 return observeOwnedMigrationSuccessor(request);
}
