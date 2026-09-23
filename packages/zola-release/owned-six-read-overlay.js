import {createHash} from 'node:crypto';
export const OWNED_SIX_READ=Object.freeze({
 frozenRoot:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260923',
 frozenSha:'4ea5783d25392c1975fb10fc80880f0ae62ff1b8',
 canonicalRoot:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921',
 releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',
 profileDigest:'2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505',
 sourceDigest:'19264cdf8249394aafb48aaf5110291147bd109be5f4d74d3a08635f4bc50938'
});
const fail=()=>{throw Error('Owned six-read continuation refused');};
export function ownedSixReadConfigMatches(config,context){
 const owned=context.release?.backendProfile==='owned-postgres-v1';
 if(!owned)return config.version===4&&config.backendProfile===undefined&&config.profileDigest===undefined;
 return config.version===6&&context.release.schema===3&&context.release.releaseSha===OWNED_SIX_READ.releaseSha
  &&context.release.operationId===OWNED_SIX_READ.operationId&&context.release.profileDigest===OWNED_SIX_READ.profileDigest
  &&context.input.releaseSha===OWNED_SIX_READ.releaseSha&&config.backendProfile==='owned-postgres-v1'
  &&config.profileDigest===OWNED_SIX_READ.profileDigest;
}
export function transformOwnedSixReadSource(source){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==OWNED_SIX_READ.sourceDigest)fail();
 const needle='config.version!==4',pieces=source.split(needle);if(pieces.length!==2)fail();
 // Inject one pure predicate. All original journal, identity, generation, expiry,
 // no-replay, config digest and collector evidence checks remain byte-identical.
 return "const OWNED_SIX_READ="+JSON.stringify(OWNED_SIX_READ)+";\n"+ownedSixReadConfigMatches.toString()+"\n"+pieces[0]+'!ownedSixReadConfigMatches(config,context)'+pieces[1];
}
export function assertOwnedSixReadStart({state,n8nEvents,stages}){
 if(!state?.started||state.context?.releaseSha!==OWNED_SIX_READ.releaseSha||state.context?.operationId!==OWNED_SIX_READ.operationId
  ||!Object.hasOwn(state.outputs??{},'n8n_migration')||state.outputs.n8n_migration?.stage!=='n8n_migration'
  ||!Array.isArray(stages)||stages[13]!=='six_reads'||stages[8]!=='n8n_migration'
  ||!Number.isSafeInteger(state.nextOrdinal)||state.nextOrdinal<13||state.nextOrdinal>stages.length
  ||state.pending&&(state.pending.stage!==stages[state.nextOrdinal]||state.pending.operationId!==OWNED_SIX_READ.operationId)
  ||!Array.isArray(n8nEvents))fail();
 const current=n8nEvents.filter(e=>e.operationId===OWNED_SIX_READ.operationId);
 for(let i=0;i<current.length;i++){const row=current[i];if(row.releaseSha!==OWNED_SIX_READ.releaseSha)fail();
  if(row.type==='intent'&&!current.slice(i+1).some(done=>done.type==='confirmed'&&done.operation===row.operation&&done.stageAttemptId===row.stageAttemptId))fail();
 }
 return true;
}
export function assertOwnedSixReadSource({wrapperRoot,frozenRoot,frozenSha,wrapperClean,frozenClean,ancestor,wrapperSha}){
 if(wrapperRoot!=='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-premerge-six-permit-20260923'
  ||frozenRoot!==OWNED_SIX_READ.frozenRoot||frozenSha!==OWNED_SIX_READ.frozenSha||wrapperClean!==true||frozenClean!==true||ancestor!==true
  ||!/^[a-f0-9]{40}$/.test(wrapperSha??'')||wrapperSha===frozenSha)fail();return true;
}
