import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {RECOVERY_ARTIFACT,RECOVERY_SHA} from '../zola-rollback/intake.js';
import {validateIntegratedRecoveryReport} from '../zola-rollback/integrated-report.js';
import {hash} from './commander-journal.js';
import {verifyProtectedReleaseBackup} from './commander-backup.js';
import {inspectReleaseSequence} from './commander-sequence.js';
import {inspectVpsCutoverHistory} from './commander-vps.js';
import {inspectHeldAcceptanceHistory} from './held-acceptance-authority.js';
import {observeHeldLifecycle} from './held-lifecycle.js';

const RELEASE_ROOT='/opt/blackspire-command/releases';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const reject=()=>{throw new Error('Production rollback observation rejected');};
const ordinal=Object.freeze({rollback_acceptance:14,rollback_verification:31});

function contextBinding(context){
 const input=context?.input;
 if(!input||typeof context?.journal?.stream!=='function'||![input.releaseSha,input.previousMainSha,input.recoverySha].every(sha)
  ||typeof input.workspace!=='string'||typeof input.principal!=='string'||!digest(input.inputDigest))reject();
 return{releaseSha:input.releaseSha,rollbackSha:input.recoverySha,workspace:input.workspace,principal:input.principal};
}
function invocation(value,stage,{pending=true}={}){
 const operationId=value?.state?.context?.operationId,attemptId=value?.attemptId;
 if(!uuid(operationId)||value.state.context.releaseSha!==value.input?.releaseSha||value.state.context.recoverySha!==value.input?.recoverySha
  ||value.state.context.workspace!==value.input?.workspace||value.state.context.principal!==value.input?.principal
  ||value.ordinal!==ordinal[stage]||value.state.nextOrdinal!==ordinal[stage]
  ||pending&&(!uuid(attemptId)||value.state.pending?.attemptId!==attemptId||value.state.pending?.stage!==stage))reject();
 if(!pending&&value.state.pending!==null)reject();
 return{operationId,attemptId:attemptId??null};
}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function safeProof(value,stage,binding,ids){
 if(!value||value.status!=='PASS'||value.stage!==stage||!same(value.binding,binding)||value.operationId!==ids.operationId
  ||value.attemptId!==ids.attemptId||!digest(value.observationDigest))reject();
 const common=['status','stage','binding','operationId','attemptId','observationDigest','artifactDigest','backupManifestDigest','backupSnapshotDigest','backupProofDigest'];
 const keys=stage==='rollback_acceptance'?[...common,'runtimeProofDigest','apiRecoveryCompatible','workerRecoveryCompatible','admissionCompatible','runtimeCompatible','journalResumable']
  :[...common,'rollbackJournalDigest','previousStateDigest','apiGeneration','workerGeneration','previousPointerRecoverable','rollbackExecutable','noAttemptMixing','noStaleGeneration'];
 if(!exact(value,keys)||!['artifactDigest','backupManifestDigest','backupSnapshotDigest','backupProofDigest'].every(key=>digest(value[key])))reject();
 if(stage==='rollback_acceptance'&&(!digest(value.runtimeProofDigest)||['apiRecoveryCompatible','workerRecoveryCompatible','admissionCompatible','runtimeCompatible','journalResumable'].some(key=>value[key]!==true)))reject();
 if(stage==='rollback_verification'&&(!digest(value.rollbackJournalDigest)||!digest(value.previousStateDigest)
  ||![value.apiGeneration,value.workerGeneration].every(item=>typeof item==='string'&&/^[a-f0-9]{32}$/.test(item))
  ||value.apiGeneration===value.workerGeneration||['previousPointerRecoverable','rollbackExecutable','noAttemptMixing','noStaleGeneration'].some(key=>value[key]!==true)))reject();
 return structuredClone(value);
}
function rows(context,stage){return context.journal.stream('release').events().filter(row=>row?.type===`${stage}_probe_intent`||row?.type===`${stage}_probe_result`);}
function history(context,stage,binding,ids){
 const found=rows(context,stage);if(found.length!==2)reject();const [intent,result]=found;
 if(intent.schema!==1||result.schema!==1||intent.type!==`${stage}_probe_intent`||result.type!==`${stage}_probe_result`
  ||!same(intent.binding,binding)||!same(result.binding,binding)||intent.operationId!==ids.operationId||result.operationId!==ids.operationId
  ||intent.attemptId!==ids.attemptId||result.attemptId!==ids.attemptId||!['PASS','BLOCKED_EXTERNAL'].includes(result.status))reject();
 if(result.status==='PASS')safeProof(result.proof,stage,binding,ids);else if(Object.hasOwn(result,'proof'))reject();
 return result;
}
function append(context,event){context.journal.stream('release').append(event);}

async function artifactAndBackup(context,binding){
 const artifactRoot=path.join(RELEASE_ROOT,binding.rollbackSha);
 if(!fs.existsSync(artifactRoot)||!fs.existsSync(context.release.backupManifestFile))return{status:'BLOCKED_EXTERNAL'};
 const artifact=await inspectBuyerWriterArtifact({artifactRoot,releaseSha:binding.rollbackSha,environment:'production'});
 if(artifact.releaseSha!==binding.rollbackSha||artifact.environment!=='production'||!digest(artifact.artifactDigest)
  ||binding.rollbackSha!==RECOVERY_SHA||artifact.artifactDigest!==RECOVERY_ARTIFACT)reject();
 const backup=verifyProtectedReleaseBackup({releaseSha:binding.releaseSha,manifestFile:context.release.backupManifestFile});
 if(backup.status!=='PROTECTED_BACKUP_VERIFIED'||backup.releaseSha!==binding.releaseSha
  ||!digest(backup.snapshotSha256)||!digest(backup.manifestSha256)||backup.sourceIdentityBound!==true)reject();
 const secondArtifact=await inspectBuyerWriterArtifact({artifactRoot,releaseSha:binding.rollbackSha,environment:'production'});
 const secondBackup=verifyProtectedReleaseBackup({releaseSha:binding.releaseSha,manifestFile:context.release.backupManifestFile});
 if(!same(artifact,secondArtifact)||!same(backup,secondBackup))reject();
 return{status:'PASS',artifactDigest:artifact.artifactDigest,backupManifestDigest:backup.manifestSha256,
  backupSnapshotDigest:backup.snapshotSha256,backupProofDigest:hash(backup)};
}
function recoveryProbe(){
 let bytes;
 try{bytes=execFileSync('/opt/nodejs/node-v22.23.1-linux-x64/bin/node',['--disable-warning=ExperimentalWarning',
   new URL('../../scripts/zola-recovery-integrated.js',import.meta.url).pathname],{encoding:'utf8',timeout:190000,maxBuffer:65536,
   stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});}
 catch{return{status:'BLOCKED_EXTERNAL'};}
 let report;try{report=validateIntegratedRecoveryReport(JSON.parse(bytes));}catch{reject();}
 return{status:'PASS',runtimeProofDigest:hash(report),apiRecoveryCompatible:true,workerRecoveryCompatible:true,
  admissionCompatible:true,runtimeCompatible:true};
}
function acceptanceJournal(context,ids,{pending}){
 const state=inspectReleaseSequence(context.journal.stream('release').events());
 if(!state.started||state.completed||state.context.operationId!==ids.operationId||state.context.releaseSha!==context.input.releaseSha
  ||state.context.recoverySha!==context.input.recoverySha||state.nextOrdinal!==14
  ||pending&&(state.pending?.stage!=='rollback_acceptance'||state.pending.attemptId!==ids.attemptId)
  ||!pending&&state.pending!==null)reject();
 return true;
}
function defaultAcceptancePrecheck(context,binding,ids){
 acceptanceJournal(context,ids,{pending:false});
 if(binding.rollbackSha!==RECOVERY_SHA||!fs.existsSync(path.join(RELEASE_ROOT,binding.rollbackSha))
  ||!fs.existsSync(context.release.backupManifestFile))return{status:'BLOCKED_EXTERNAL'};
 return{status:'PASS',rollbackCandidatePresent:true,protectedBackupPresent:true};
}
function defaultVerificationPrecheck(context,binding,ids){
 const events=context.journal.stream('release').events(),accepted=rows(context,'rollback_acceptance').at(-1);
 if(accepted?.status!=='PASS'||accepted.operationId!==ids.operationId||accepted.proof?.binding?.rollbackSha!==binding.rollbackSha)reject();
 const cutover=inspectVpsCutoverHistory(events),held=inspectHeldAcceptanceHistory(events);
 if(!cutover.completed||cutover.rollingBack||cutover.rollbackComplete||cutover.intent.commanderRunId!==ids.operationId
  ||held.status!=='CONSUMING'||held.claims.commanderRunId!==ids.operationId||held.claims.workspace!==binding.workspace
  ||held.claims.principal!==binding.principal||held.pending)reject();
 return{status:'PASS',rollbackArtifactRetained:true,cutoverJournalComplete:true,heldGenerationsCurrent:true};
}
async function defaultAcceptance(context,binding,ids){
 acceptanceJournal(context,ids,{pending:true});
 const integrity=await artifactAndBackup(context,binding);if(integrity.status!=='PASS')return integrity;
 const runtime=recoveryProbe();if(runtime.status!=='PASS')return runtime;
 return{status:'PASS',...integrity,...runtime,journalResumable:true};
}
async function defaultAcceptanceIntegrity(context,binding,proof){
 const integrity=await artifactAndBackup(context,binding);if(integrity.status!=='PASS')return integrity;
 if(!['artifactDigest','backupManifestDigest','backupSnapshotDigest'].every(key=>integrity[key]===proof[key]))reject();
 return{status:'PASS'};
}
async function defaultVerification(context,binding,ids,acceptanceProof){
 const integrity=await artifactAndBackup(context,binding);if(integrity.status!=='PASS')return integrity;
 if(!['artifactDigest','backupManifestDigest','backupSnapshotDigest'].every(key=>integrity[key]===acceptanceProof[key]))reject();
 const events=context.journal.stream('release').events(),cutover=inspectVpsCutoverHistory(events);
 if(!cutover.completed||cutover.rollingBack||cutover.rollbackComplete||cutover.pending||cutover.intent.rollbackSha!==binding.rollbackSha
  ||cutover.intent.commanderRunId!==ids.operationId||cutover.intent.rollbackArtifactDigest!==integrity.artifactDigest
  ||cutover.intent.backupManifestFile!==context.release.backupManifestFile||cutover.intent.backupDigest!==integrity.backupProofDigest)reject();
 const cutoverStage=events.find(row=>row?.type==='sequence_stage_confirmed'&&row.stage==='journaled_vps_cutover');
 if(!cutoverStage||cutoverStage.attemptId!==cutover.intent.operationId)reject();
 const held=inspectHeldAcceptanceHistory(events);
 if(held.status!=='CONSUMING'||held.claims.commanderRunId!==ids.operationId||held.claims.mergeMainSha!==cutover.intent.newMainSha
  ||held.claims.workspace!==binding.workspace||held.claims.principal!==binding.principal
  ||held.completed.join(',')!=='api_health,worker_readiness,generation_fence,six_live_reads,production_smoke,zero_paid_nexus,zero_unintended_mutation'
  ||held.pending&&held.pending.operation!=='rollback_verification')reject();
 const lifecycle=await observeHeldLifecycle({releaseSha:held.claims.mergeMainSha,runId:held.claims.epochRunId});
 if(lifecycle.proof.api.generation!==held.claims.apiGeneration||lifecycle.proof.worker.generation!==held.claims.workerGeneration
  ||lifecycle.proof.artifactDigest!==cutover.intent.artifactDigest)reject();
 const snapshot=cutover.intent.snapshot;
 if(snapshot.current!==path.join(RELEASE_ROOT,binding.rollbackSha)||hash(snapshot)!==cutover.intent.snapshotDigest
  ||!snapshot.state||typeof snapshot.state!=='object'||!snapshot.api||!snapshot.worker)reject();
 return{status:'PASS',...integrity,rollbackJournalDigest:hash(cutover.intent),previousStateDigest:hash(snapshot.state),
  apiGeneration:held.claims.apiGeneration,workerGeneration:held.claims.workerGeneration,previousPointerRecoverable:true,
  rollbackExecutable:true,noAttemptMixing:true,noStaleGeneration:true};
}

function operation(context,stage,precheck,collector,integrity){
 const binding=contextBinding(context);
 return Object.freeze({
  async check(value){const ids=invocation(value,stage,{pending:false}),checked=await precheck(context,binding,ids);
   if(checked?.status==='BLOCKED_EXTERNAL')return checked;if(checked?.status!=='PASS')reject();
   const evidence={stageReady:true,stage,releaseSha:binding.releaseSha,rollbackSha:binding.rollbackSha,operationId:ids.operationId,...checked};delete evidence.status;
   return{status:'PASS',evidence};},
  async execute(value){const ids=invocation(value,stage);if(rows(context,stage).length)reject();
   append(context,{schema:1,type:`${stage}_probe_intent`,binding,operationId:ids.operationId,attemptId:ids.attemptId});
   const result=await collector(context,binding,ids);
   if(result?.status==='BLOCKED_EXTERNAL'){append(context,{schema:1,type:`${stage}_probe_result`,binding,operationId:ids.operationId,attemptId:ids.attemptId,status:'BLOCKED_EXTERNAL'});return;}
   if(result?.status!=='PASS')reject();
   const core={stage,binding,operationId:ids.operationId,attemptId:ids.attemptId,...result};delete core.status;
   const proof={status:'PASS',...core,observationDigest:hash(core)};safeProof(proof,stage,binding,ids);
   append(context,{schema:1,type:`${stage}_probe_result`,binding,operationId:ids.operationId,attemptId:ids.attemptId,status:'PASS',proof});
  },
  async reconcile(value){const ids=invocation(value,stage),result=history(context,stage,binding,ids);
   if(result.status==='BLOCKED_EXTERNAL')return{status:'BLOCKED_EXTERNAL'};
   if(integrity){const current=await integrity(context,binding,result.proof,ids);if(current?.status==='BLOCKED_EXTERNAL')return current;if(current?.status!=='PASS')reject();}
   return{status:'PASS',evidence:result.proof};},
  async observe(value){const ids=invocation(value,stage),result=await collector(context,binding,ids);
   if(result?.status==='BLOCKED_EXTERNAL')return result;if(result?.status!=='PASS')reject();
   const core={stage,binding,operationId:ids.operationId,attemptId:ids.attemptId,...result};delete core.status;
   return{status:'PASS',evidence:{status:'PASS',...core,observationDigest:hash(core)}};},
 });
}

export function createRollbackProductionOperations(context,dependencies={}){
 const acceptancePrecheck=dependencies.checkAcceptance??defaultAcceptancePrecheck;
 const verificationPrecheck=dependencies.checkVerification??defaultVerificationPrecheck;
 const acceptance=dependencies.observeAcceptance??defaultAcceptance;
 const acceptanceIntegrity=dependencies.observeAcceptanceIntegrity??defaultAcceptanceIntegrity;
 const verification=dependencies.observeVerification??((ctx,binding,ids)=>{
  const accepted=rows(ctx,'rollback_acceptance').at(-1);if(accepted?.status!=='PASS')reject();
  return defaultVerification(ctx,binding,ids,accepted.proof);
 });
 const verificationIntegrity=dependencies.observeVerificationIntegrity??(async(ctx,binding,proof)=>{
  const accepted=rows(ctx,'rollback_acceptance').at(-1);if(accepted?.status!=='PASS')reject();
  const current=await artifactAndBackup(ctx,binding);if(current.status!=='PASS')return current;
  if(!['artifactDigest','backupManifestDigest','backupSnapshotDigest'].every(key=>current[key]===proof[key]&&current[key]===accepted.proof[key]))reject();
  return{status:'PASS'};
 });
 if(![acceptancePrecheck,verificationPrecheck,acceptance,acceptanceIntegrity,verification,verificationIntegrity].every(value=>typeof value==='function'))reject();
 return Object.freeze({rollback_acceptance:operation(context,'rollback_acceptance',acceptancePrecheck,acceptance,acceptanceIntegrity),
  rollback_verification:operation(context,'rollback_verification',verificationPrecheck,verification,verificationIntegrity)});
}
