import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {inspectReleaseCommander} from './commander.js';
import {observeExpectedHeadMerge,observeReleaseMergeability,observeVercelProduction,requestExpectedHeadMerge} from './commander-deployment.js';
import {verifyMergedRelease} from './commander-merged.js';
import {prepareVpsCutoverPlan,inspectVpsCutoverHistory,runVpsCutover} from './commander-vps.js';
import {beginPostMergeHeldEpoch,inspectPostMergeAdmissionHistory} from './postmerge-admission.js';
import {readReleaseProtectedBytes} from './commander-host.js';

const ADMISSION='/etc/blackspire/release-admission',VERCEL_TOKEN='/var/lib/blackspire-operator/vercel-token';
const API='blackspire-command.service',WORKER='blackspire-command-worker.service',TARGET='blackspire-command.target';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const reject=()=>{throw new Error('Fixed production deployment operation rejected');};

function invocation(context,args,stage,{attempt=false}={}){
 const input=args?.input,state=args?.state;
 if(JSON.stringify(input)!==JSON.stringify(context.input)||input?.releaseSha!==context.release?.releaseSha||!uuid(state?.context?.operationId)
  ||state.context.releaseSha!==input.releaseSha||state.context.previousMainSha!==input.previousMainSha
  ||state.context.workspace!==input.workspace||state.context.principal!==input.principal||!Number.isSafeInteger(args.ordinal)||args.ordinal<0)reject();
 if(attempt&&(!uuid(args.attemptId)||!digest(args.inputDigest)||!digest(args.checkOutputDigest)))reject();
 return{operationId:state.context.operationId,attemptId:args.attemptId??null,releaseSha:input.releaseSha,previousMainSha:input.previousMainSha,stage};
}
function ciProof(context){
 inspectReleaseCommander(context.journal);
 const rows=context.journal.stream('release').events().filter(row=>row?.type==='preflight_passed'&&row.releaseSha===context.input.releaseSha
  &&row.stage==='identity_recheck');
 const proof=rows.at(-1)?.proof;
 if(!proof||proof.status!=='success'||proof.releaseSha!==context.input.releaseSha||proof.mainSha!==context.input.previousMainSha
  ||![proof.ciMergeSha,proof.ciTreeSha].every(sha))reject();
 return{ciMergeSha:proof.ciMergeSha,ciTreeSha:proof.ciTreeSha};
}
const pass=evidence=>({status:'PASS',evidence});
function mergeEvidence(context,args,dependencies){
 const binding=invocation(context,args,'expected_head_merge',{attempt:Boolean(args.attemptId)}),ci=dependencies.readCiProof(context);
 const observed=dependencies.observeMerge({releaseSha:binding.releaseSha,previousMainSha:binding.previousMainSha,...ci});
 if(observed.status==='OPEN_EXACT_HEAD')return{status:'BLOCKED_EXTERNAL'};
 if(observed.status!=='MERGED_EXACT_HEAD'||!sha(observed.newMainSha))reject();
 return pass({...binding,...ci,newMainSha:observed.newMainSha,mergedExactHead:true});
}

function output(args,stage){const value=args?.state?.outputs?.[stage];if(!value||typeof value!=='object')reject();return value;}
function capturedMain(context,args,stage){
 invocation(context,args,stage,{attempt:Boolean(args.attemptId)});
 const merged=output(args,'expected_head_merge');if(!sha(merged.newMainSha))reject();return merged.newMainSha;
}
function fixedStopAndVerify(){
 const run=(file,args)=>{const result=spawnSync(file,args,{encoding:'utf8',timeout:30000,maxBuffer:4096,killSignal:'SIGKILL',stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});if(result.status!==0||result.error)reject();return result.stdout.trim();};
 run('/usr/bin/systemctl',['stop','--',TARGET]);
 for(const unit of [API,WORKER]){const fields=Object.fromEntries(run('/usr/bin/systemctl',['show','--no-pager','--property=ActiveState,MainPID','--',unit]).split('\n').map(line=>line.split('=')));
  if(fields.ActiveState!=='inactive'||fields.MainPID!=='0')reject();}
}
function preflightArtifact(context){
 const row=context.journal.stream('release').events().filter(value=>value?.type==='preflight_passed'&&value.releaseSha===context.input.releaseSha&&value.stage==='artifact_disk').at(-1);
 const value=row?.proof?.artifact?.artifactDigest;if(!digest(value))reject();return value;
}
function vpsBase(context,args,held,dependencies){
 const binding=invocation(context,args,'journaled_vps_cutover',{attempt:true}),rollback=output(args,'rollback_acceptance'),newMainSha=capturedMain(context,args,'journaled_vps_cutover');
 if(held?.status!=='POST_MERGE_HELD'||held.newMainSha!==newMainSha||!uuid(held.epochRunId)||!digest(rollback.artifactDigest)||!digest(rollback.backupProofDigest))reject();
 return{operationId:binding.attemptId,commanderRunId:binding.operationId,epochRunId:held.epochRunId,rollbackEpochRunId:randomUUID(),newMainSha,
  rollbackSha:context.input.recoverySha,artifactDigest:dependencies.readArtifactDigest(context),rollbackArtifactDigest:rollback.artifactDigest,
  backupDigest:rollback.backupProofDigest,backupManifestFile:context.release.backupManifestFile,
  admissionDigest:hash({version:1,mode:'held',releaseSha:newMainSha,runId:held.epochRunId,apiGeneration:null,workerGeneration:null})};
}
async function ensureHeld(context,args,dependencies){
 const newMainSha=capturedMain(context,args,'journaled_vps_cutover');
 return dependencies.beginHeld({commanderRunId:args.state.context.operationId,candidateSha:context.input.releaseSha,newMainSha,journal:context.journal},
  {root:ADMISSION,groupId:dependencies.admissionGroup(),stopAndVerify:dependencies.stopAndVerify});
}
async function driveVps(context,args,dependencies){
 const held=await ensureHeld(context,args,dependencies),history=inspectVpsCutoverHistory(context.journal.stream('release').events());let plan,options,reconcile;
 if(history.started){plan=Object.fromEntries(['operationId','commanderRunId','epochRunId','rollbackEpochRunId','newMainSha','rollbackSha','artifactDigest','rollbackArtifactDigest','backupDigest','backupManifestFile','admissionDigest','snapshotDigest'].map(key=>[key,history.intent[key]]));reconcile=true;}
 else{const prepared=await dependencies.prepareVps({plan:vpsBase(context,args,held,dependencies)});plan=prepared.plan;options={snapshot:prepared.snapshot};reconcile=false;}
 const result=await dependencies.runVps({plan,journal:context.journal,reconcile},options);
 if(result.status!=='VPS_CUTOVER_COMPLETE'||result.newMainSha!==plan.newMainSha)reject();
 return pass({stage:'journaled_vps_cutover',operationId:plan.commanderRunId,attemptId:plan.operationId,newMainSha:plan.newMainSha,
  epochRunId:plan.epochRunId,artifactDigest:plan.artifactDigest,backupDigest:plan.backupDigest,vpsCutover:true,replayed:result.replayed===true});
}

export function createDeploymentProductionOperations(context,overrides={}){
 const dependencies={observeMerge:observeExpectedHeadMerge,observeMergeability:observeReleaseMergeability,requestMerge:requestExpectedHeadMerge,
  verifyMerged:verifyMergedRelease,observeVercel:observeVercelProduction,readVercelToken:()=>readReleaseProtectedBytes(VERCEL_TOKEN,16384).trim(),
  beginHeld:beginPostMergeHeldEpoch,admissionGroup:()=>fs.statSync(ADMISSION).gid,stopAndVerify:fixedStopAndVerify,
  prepareVps:prepareVpsCutoverPlan,runVps:runVpsCutover,readCiProof:ciProof,readArtifactDigest:preflightArtifact,...overrides};
 const merge={
  check(args){const binding=invocation(context,args,'expected_head_merge'),ci=dependencies.readCiProof(context),proof=dependencies.observeMergeability({releaseSha:binding.releaseSha,previousMainSha:binding.previousMainSha});if(proof.status!=='PR_MERGEABLE')reject();return pass({...binding,...ci,expectedHead:true,mergeable:true});},
  execute(args){const binding=invocation(context,args,'expected_head_merge',{attempt:true});dependencies.readCiProof(context);dependencies.requestMerge({releaseSha:binding.releaseSha});},
  reconcile:args=>mergeEvidence(context,args,dependencies),observe:args=>mergeEvidence(context,args,dependencies),
 };
 const capture={check(args){invocation(context,args,'capture_new_main_sha');return pass({stage:'capture_new_main_sha',mergeConfirmed:true});},
  observe(args){const newMainSha=capturedMain(context,args,'capture_new_main_sha');return pass({stage:'capture_new_main_sha',newMainSha,captured:true});}};
 const verify={check(args){const newMainSha=capturedMain(context,args,'verify_main'),ci=dependencies.readCiProof(context),binding=invocation(context,args,'verify_main');
   const proof=dependencies.verifyMerged({releaseSha:binding.releaseSha,previousMainSha:binding.previousMainSha,...ci,newMainSha});if(proof.status!=='MERGED_IDENTITY_VERIFIED')reject();return pass({stage:'verify_main',newMainSha,mainVerified:true});},
  observe(args){const newMainSha=capturedMain(context,args,'verify_main'),ci=dependencies.readCiProof(context),binding=invocation(context,args,'verify_main');dependencies.verifyMerged({releaseSha:binding.releaseSha,previousMainSha:binding.previousMainSha,...ci,newMainSha});return pass({stage:'verify_main',newMainSha,mainVerified:true});}};
 const vercelRun=async args=>{const newMainSha=capturedMain(context,args,'verify_vercel_production_sha');invocation(context,args,'verify_vercel_production_sha');let token;
  try{token=dependencies.readVercelToken();const proof=await dependencies.observeVercel({newMainSha,token});if(proof.status!=='VERCEL_PRODUCTION_EXACT')reject();return pass({stage:'verify_vercel_production_sha',newMainSha,deploymentId:proof.deploymentId,vercelProductionExact:true});}
  catch{return{status:'BLOCKED_EXTERNAL'};}};
 const vps={check(args){invocation(context,args,'journaled_vps_cutover');const newMainSha=capturedMain(context,args,'journaled_vps_cutover');return pass({stage:'journaled_vps_cutover',newMainSha,cutoverReady:true});},
  async execute(args){await driveVps(context,args,dependencies);},reconcile:args=>driveVps(context,args,dependencies),observe:args=>driveVps(context,args,dependencies)};
 return Object.freeze({expected_head_merge:Object.freeze(merge),capture_new_main_sha:Object.freeze(capture),verify_main:Object.freeze(verify),
  verify_vercel_production_sha:Object.freeze({check:vercelRun,observe:vercelRun}),journaled_vps_cutover:Object.freeze(vps)});
}

export function observeFixedPostMergeHeld(context,args){
 const binding=invocation(context,args,'post_merge_held_epoch',{attempt:Boolean(args.attemptId)}),newMainSha=capturedMain(context,args,'post_merge_held_epoch');
 const rows=inspectPostMergeAdmissionHistory(context.journal.stream('release').events()),result=rows.find(row=>row.type==='release_postmerge_hold_result'&&row.commanderRunId===binding.operationId);
 if(!result||result.candidateSha!==binding.releaseSha||result.newMainSha!==newMainSha||!uuid(result.epochRunId))reject();
 return pass({stage:'post_merge_held_epoch',operationId:binding.operationId,newMainSha,epochRunId:result.epochRunId,intakeOpen:false,held:true});
}
