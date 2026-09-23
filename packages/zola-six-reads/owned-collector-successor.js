import {createHash} from 'node:crypto';
export const successorHash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const SUCCESSOR=Object.freeze({root:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-collector-successor-20260923',baseSha:'30fcdaa81c8f6fb070cc0f5ec67e597ecd17330a',frozenRoot:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-denial-renewal-20260923',canonicalRoot:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921',releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',attemptId:'e0a5951a-287f-4f84-9ec8-5b44c926153b',runId:'c2681636-b47f-4c66-8569-be0744c60f16',configDigest:'bc04dc2c98d5d4ee167e2ace3e0dde0b40ff7256ab7de90b0b87500e29b21148',collectorDigest:'c5ec95649f3cf7849869a9973331ca543b11cfb570d9d59cb577dd66d37062fd',originalClaimsDigest:'7858b38cee35a4b83c881b7e600e93fee28c0a48fe5f3b8efe25675b746bf65f',originalReleasePrefixDigest:'0ed573b0739b69fa90d76d76d04037e8e86c7f07b40898761098ad404c5a28c8'});
export const successorFail=()=>{throw Error('OWNED_COLLECTOR_SUCCESSOR_REJECTED');};
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const digest=v=>/^[a-f0-9]{64}$/.test(v??'');
export const SUCCESSOR_TYPES=Object.freeze(['premerge_observation_failure','premerge_successor_reads_intent','premerge_successor_reads_active','premerge_successor_reads_result','premerge_successor_reads_retired']);
export function successorPrefixDigest(events){let previous='0'.repeat(64);for(const [sequence,event] of events.entries())previous=successorHash({sequence,previous,event});return previous;}
export function validateTerminalEvent(row,policy=SUCCESSOR){
 if(!exact(row,'schema,type,attemptId,originalClaimsDigest,collectorDigest,terminalProofDigest,archiveProofDigest,originalReleasePrefixDigest')||row.schema!==2||row.type!==SUCCESSOR_TYPES[0]||row.attemptId!==policy.attemptId||['originalClaimsDigest','collectorDigest','originalReleasePrefixDigest'].some(k=>row[k]!==policy[k])||!digest(row.terminalProofDigest)||!digest(row.archiveProofDigest))successorFail();return row;
}
export function successorEvidence(value){
 if(!exact(value,'readCount,crossOwnerDenials,paidProviderCalls,mutationDelta,collectorDigest')||value.readCount!==6||value.crossOwnerDenials!==6||value.paidProviderCalls!==0||value.mutationDelta!==0||!digest(value.collectorDigest))successorFail();return structuredClone(value);
}
// Ordinary history is validated on the complete transcript. Its UNKNOWN outcome
// remains intact. A separate, linked protocol governs one fresh observation segment.
export function inspectSuccessorHistory(events,{inspectOriginal,inspectSequence,validateClaims,identity},policy=SUCCESSOR){
 const original=inspectOriginal(events);let terminal=null,intent=null,active=false,result=null,retired=false;
 for(let i=0;i<events.length;i++){
  const row=events[i],type=String(row?.type??'');
  if(!type.startsWith('premerge_successor_')&&type!=='premerge_observation_failure')continue;
  if(!SUCCESSOR_TYPES.includes(type)||row.schema!==2)successorFail();
  const state=inspectSequence(events.slice(0,i));
  if(state.pending?.stage!=='six_reads'||state.nextOrdinal!==13||state.pending.attemptId!==policy.attemptId||state.context?.releaseSha!==policy.releaseSha||state.context.operationId!==policy.operationId||state.outputs.admission_lease?.epochRunId!==policy.runId)successorFail();
  if(type==='premerge_observation_failure'){
   if(successorPrefixDigest(events.slice(0,i))!==policy.originalReleasePrefixDigest)successorFail();
   if(terminal||!original.intent||!original.retired||original.result||original.intent.claimsDigest!==policy.originalClaimsDigest||original.intent.configDigest!==policy.configDigest||events.slice(i+1).some(e=>String(e.type).startsWith('premerge_reads_')))successorFail();
   const preceding=inspectOriginal(events.slice(0,i));if(!preceding.retired||preceding.result)successorFail();terminal=validateTerminalEvent(row,policy);continue;
  }
  if(!terminal||row.attemptId!==policy.attemptId)successorFail();
  if(type==='premerge_successor_reads_intent'){
   if(intent||!exact(row,'schema,type,attemptId,inputDigest,checkOutputDigest,configDigest,claims,claimsDigest,terminalProofDigest,archiveProofDigest'))successorFail();
   const claims=validateClaims(row.claims),old=original.intent.claims;
   if(!identity(claims)||row.claimsDigest!==successorHash(claims)||row.configDigest!==policy.configDigest||row.inputDigest!==state.pending.inputDigest||row.checkOutputDigest!==state.pending.checkOutputDigest||row.terminalProofDigest!==terminal.terminalProofDigest||row.archiveProofDigest!==terminal.archiveProofDigest||claims.permitId===old.permitId||claims.tokenDigest===old.tokenDigest||claims.issuedAt<old.expiresAt||['commanderRunId','candidateSha','expectedDeploymentSha','epochRunId','workspace','principal','apiGeneration','workerGeneration','operations','reads'].some(k=>successorHash(claims[k])!==successorHash(old[k])))successorFail();intent=row;
  }else{
   if(!intent||retired||row.claimsDigest!==intent.claimsDigest)successorFail();
   const keys='schema,type,attemptId,claimsDigest';
   if(type==='premerge_successor_reads_active'){if(active||result||!exact(row,keys))successorFail();active=true;}
   else if(type==='premerge_successor_reads_result'){if(!active||result||!exact(row,keys+',evidence,evidenceDigest')||row.evidenceDigest!==successorHash(successorEvidence(row.evidence)))successorFail();result=row;}
   else{if(!active||!exact(row,keys+',outcome')||row.outcome!==(result?'PASS':'UNKNOWN'))successorFail();retired=true;}
  }
 }
 if(!terminal)successorFail();
 return {intent,active,result,retired,terminal,original};
}
