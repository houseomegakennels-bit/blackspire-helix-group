import {OWNED_SEQUENCE,assertOwnedSequenceState} from './owned-sequence-overlay.js';
import {observeSuccessorMain} from './owned-successor-main.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {observeExpectedHeadMerge} from './commander-deployment.js';
import {verifyMergedRelease} from './commander-merged.js';
export function verifyOwnedSequenceOperator(release,journal,{inspect=inspectReleaseSequenceHistory,observeMain=observeSuccessorMain,observeMerge=observeExpectedHeadMerge,verifyMerged=verifyMergedRelease}={}){
 const state=inspect(journal.stream('release').events());assertOwnedSequenceState(release,state);
 const merged=state.outputs?.expected_head_merge;
 if(!merged&&state.pending?.stage!=='expected_head_merge'){observeMain(OWNED_SEQUENCE.releaseSha);return;}
 const ci=state.outputs.ci_security;
 if(ci?.releaseSha!==release.releaseSha||ci.mainSha!==release.previousMainSha)throw Error('Owned sequence CI binding refused');
 const binding={releaseSha:release.releaseSha,previousMainSha:release.previousMainSha,ciMergeSha:ci.ciMergeSha,ciTreeSha:ci.ciTreeSha};
 const observed=observeMerge(binding);
 if(observed.status==='OPEN_EXACT_HEAD'&&!merged){observeMain(release.releaseSha);return;}
 if(observed.status!=='MERGED_EXACT_HEAD'||merged&&merged.newMainSha!==observed.newMainSha)throw Error('Owned sequence merge binding refused');
 if(verifyMerged({...binding,newMainSha:observed.newMainSha}).status!=='MERGED_IDENTITY_VERIFIED')throw Error('Owned sequence merged identity refused');
}
