import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from './commander-journal.js';
import {RELEASE_REGISTRY_DIGEST} from './commander-sequence.js';
import {observeFixedPostMergeHeld} from './production-deployment-operations.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {runHeldLifecycle,inspectHeldLifecycleHistory} from './held-lifecycle.js';
import {engageReleaseAdmissionHold,reconcileReleaseAdmissionHold,inspectAdmissionHoldHistory} from './admission-hold.js';
import {HELD_ACCEPTANCE_OPERATIONS,authorizeHeldAcceptanceOperation,completeHeldAcceptanceOperation,
 consumeHeldAcceptancePermit,finishHeldAcceptancePermit,inspectHeldAcceptanceHistory,mintHeldAcceptancePermit} from './held-acceptance-authority.js';
import {prepareGuardedOpen,publishGuardedOpen} from './postmerge-admission.js';
import {FINAL_RELEASE_RECORD_ROOT,inspectFinalReleaseRecord,writeAcceptedHeldReleaseRecord,writeOpenReleaseRecord} from './final-release-record.js';
import {RELEASE_ADMISSION_ROOT} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {collectSixReads,readCases,requireProductionCollectorReport,validateCollectorConfig} from '../zola-six-reads/collector.js';
import {createProductionCollectorHost,openCollectorJournal} from '../zola-six-reads/collector-host.js';

export const FIXED_PREMERGE_SIX_READ_CONFIGURATION='/var/lib/blackspire-operator/preparation/six-read-premerge-config.json';
export const FIXED_LIVE_SIX_READ_CONFIGURATION='/var/lib/blackspire-operator/preparation/six-read-live-config.json';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const reject=()=>{throw new Error('Fixed production HELD operation rejected');};
const blocked=()=>Object.freeze({status:'BLOCKED_EXTERNAL'});
const pass=evidence=>Object.freeze({status:'PASS',evidence:Object.freeze(evidence)});
const REPOSITORY_ROOT=fileURLToPath(new URL('../../',import.meta.url));

function invocation(context,call,stage,{attempt=false}={}){
 const input=call?.input,state=call?.state;
 if(JSON.stringify(input)!==JSON.stringify(context.input)||!sha(input?.releaseSha)||!uuid(state?.context?.operationId)
  ||state.context.releaseSha!==input.releaseSha||state.context.workspace!==input.workspace||state.context.principal!==input.principal
  ||!Number.isSafeInteger(call.ordinal)||call.ordinal<0)reject();
 if(attempt&&(!uuid(call.attemptId)||!digest(call.inputDigest)||!digest(call.checkOutputDigest)
  ||state.pending?.stage!==stage||state.pending.attemptId!==call.attemptId))reject();
 return{operationId:state.context.operationId,attemptId:call.attemptId??null,state,input};
}
function merged(call){const value=call?.state?.outputs?.capture_new_main_sha?.newMainSha;if(!sha(value))reject();return value;}
function heldBinding(context,call){
 const ids=invocation(context,call,call.state.pending?.stage??'mint_acceptance_permit',{attempt:Boolean(call.attemptId)}),history=inspectHeldAcceptanceHistory(context.journal.stream('release').events());
 const claims=history.claims,newMainSha=merged(call);
 if(!claims||claims.commanderRunId!==ids.operationId||claims.mergeMainSha!==newMainSha||claims.expectedDeploymentSha!==newMainSha
  ||claims.workspace!==context.input.workspace||claims.principal!==context.input.principal||!uuid(claims.epochRunId))reject();
 return{mergeMainSha:newMainSha,expectedDeploymentSha:newMainSha,epochRunId:claims.epochRunId,workspace:claims.workspace,
  apiGeneration:claims.apiGeneration,workerGeneration:claims.workerGeneration};
}
function admissionOptions(context,root=RELEASE_ADMISSION_ROOT){
 const state=fs.statSync(`${root}/state.json`);if(!state.isFile()||state.uid!==0)reject();
 const config=readRootOwnedJson(context.release.activationConfigurationFile,{groupId:0,maxBytes:65536}),binding=fs.statSync(config.bindingFile);
 if(!binding.isFile()||binding.uid!==0||binding.gid<1)reject();
 return{root,owner:0,groupId:state.gid,secretGroupId:binding.gid,verifyGenerations:()=>{
  const current=readRootOwnedJson(`${root}/state.json`,{groupId:state.gid,maxBytes:2048});
  return{apiGeneration:current.apiGeneration,workerGeneration:current.workerGeneration};
 }};
}
function protectedConfig(filename){return validateCollectorConfig(readRootOwnedJson(filename,{groupId:0,maxBytes:16384}));}
async function collectFixed(config){
 let host,journal;try{journal=openCollectorJournal(config.journalDirectory,config.runId);host=createProductionCollectorHost(config);
  return await collectSixReads(config,host,journal);
 }finally{try{host?.close();}catch{}try{journal?.close();}catch{}}
}
function safeCollector(report,live,releaseSha){
 if(!report||report.releaseSha!==releaseSha||report.results?.length!==6||live&&(requireProductionCollectorReport(report),report.livePass!==true))reject();
 const crossOwnerDenials=report.results.filter(row=>row.crossOwnerDenial?.startsWith('PASS:')).length;
 if(crossOwnerDenials!==6)reject();
 const evidence={readCount:6,crossOwnerDenials,paidProviderCalls:report.results.filter(row=>row.capability==='nexus.enrichment.status')[0]?.paidProviderCalls??0,
  mutationDelta:Math.max(...report.results.map(row=>Number.isSafeInteger(row.mutationDelta)?row.mutationDelta:0)),collectorDigest:hash(report)};
 if(evidence.paidProviderCalls!==0||evidence.mutationDelta!==0)reject();return evidence;
}
function runCandidateCollector(){
 try{
  const bytes=execFileSync('/bin/bash',['scripts/with-node.sh','scripts/zola-six-read-collect.js','--candidate'],{cwd:REPOSITORY_ROOT,encoding:'utf8',timeout:45000,maxBuffer:1024*1024,
   stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}),report=JSON.parse(bytes);
  if(report.status!=='PASS_ISOLATED_API_COLLECTOR'||report.candidatePass!==true||report.livePass!==false||report.results?.length!==6
   ||report.paidProviderCalls!==0||report.observedFixtureMutationAttempts!==0)reject();return report;
 }catch(error){if(error?.message==='Fixed production HELD operation rejected')throw error;return null;}
}
function startCandidateServices(){
 const result=execFileSync('/usr/bin/systemctl',['start','--','blackspire-command.target'],{encoding:'utf8',timeout:30000,maxBuffer:4096,
  stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});if(result!=='')reject();
}
async function establishCandidateHeld(context){
 const root=RELEASE_ADMISSION_ROOT,groupId=fs.existsSync(root)?fs.statSync(root).gid:fs.statSync('/etc/blackspire').gid,events=context.journal.stream('release').events();
 if(inspectAdmissionHoldHistory(events))reconcileReleaseAdmissionHold({journal:context.journal},{root,groupId});
 else engageReleaseAdmissionHold({releaseSha:context.input.releaseSha,journal:context.journal},{root,groupId});
 const pending=inspectHeldLifecycleHistory(context.journal.stream('release').events());
 return runHeldLifecycle({releaseSha:context.input.releaseSha,journal:context.journal,reconcile:Boolean(pending)},{root,groupId,start:startCandidateServices});
}

function authorityEvidence(operation,authorization,binding,evidence){
 const common={schema:1,operation,permitId:authorization.permitId,attemptId:authorization.attemptId,mergeMainSha:binding.mergeMainSha,
  epochRunId:binding.epochRunId,apiGeneration:binding.apiGeneration,workerGeneration:binding.workerGeneration,
  bindingDigest:hash({permitId:authorization.permitId,attemptId:authorization.attemptId,operation,mergeMainSha:binding.mergeMainSha,
   epochRunId:binding.epochRunId,apiGeneration:binding.apiGeneration,workerGeneration:binding.workerGeneration})};
 if(operation==='six_live_reads')return{...common,status:'PASS_LIVE_ACCEPTANCE',livePass:true,readCount:evidence.readCount,
  crossOwnerDenials:evidence.crossOwnerDenials,paidProviderCalls:evidence.paidProviderCalls,mutationDelta:evidence.mutationDelta,collectorDigest:evidence.collectorDigest};
 if(operation==='zero_paid_nexus')return{...common,paidProviderCalls:evidence.paidProviderCalls,usageDigest:evidence.usageDigest};
 if(operation==='zero_unintended_mutation')return{...common,mutationDelta:evidence.mutationDelta,mutationDigest:evidence.mutationDigest};
 return{...common,status:'PASS',observationDigest:evidence.observationDigest};
}

export function wrapHeldAcceptanceOperations(context,operations,overrides={}){
 const deps={options:()=>admissionOptions(context),readSecret:root=>{const file=`${root}/acceptance-secret.json`,stat=fs.statSync(file);return readRootOwnedJson(file,{groupId:stat.gid,maxBytes:1024});},...overrides};
 let session=null;
 const ensureSession=()=>{
  if(session)return session;const history=inspectHeldAcceptanceHistory(context.journal.stream('release').events());
  if(!['MINTED','CONSUMING'].includes(history.status))reject();const options=deps.options(),secret=deps.readSecret(options.root??RELEASE_ADMISSION_ROOT);
  session=consumeHeldAcceptancePermit({token:secret.token,journal:context.journal},options);return session;
 };
 const wrapped={};
 for(const operation of HELD_ACCEPTANCE_OPERATIONS){
  const primitive=operations[operation];if(!primitive)reject();
  wrapped[operation]=Object.freeze({
   check(call){invocation(context,call,operation);const history=inspectHeldAcceptanceHistory(context.journal.stream('release').events()),index=HELD_ACCEPTANCE_OPERATIONS.indexOf(operation);
    if(!((index===0&&history.status==='MINTED')||history.status==='CONSUMING')||history.pending||history.completed.length!==index)reject();
    return pass({stage:operation,permitId:history.claims.permitId,heldAuthorized:true});},
   async execute(call){invocation(context,call,operation,{attempt:true});const binding=heldBinding(context,call),authorization=authorizeHeldAcceptanceOperation(ensureSession(),operation,binding);
    await primitive.execute(call);return authorization;},
   async reconcile(call){invocation(context,call,operation,{attempt:true});const binding=heldBinding(context,call),pending=inspectHeldAcceptanceHistory(context.journal.stream('release').events()).pending;
    if(!pending||pending.operation!==operation)reject();const authority=Object.freeze(Object.fromEntries(['permitId','operation','attemptId','claimsDigest'].map(key=>[key,pending[key]])));
    const result=await primitive.reconcile(call);if(result?.status==='BLOCKED_EXTERNAL')return result;
    if(result?.status!=='PASS')reject();completeHeldAcceptanceOperation(ensureSession(),authority,binding,authorityEvidence(operation,authority,binding,result.evidence));
    if(operation==='rollback_verification'){const consumed=finishHeldAcceptancePermit(session);session=null;return pass({...result.evidence,permitId:consumed.permitId,acceptanceDigest:consumed.acceptanceDigest});}
    return result;},
   async observe(call){invocation(context,call,operation);const history=inspectHeldAcceptanceHistory(context.journal.stream('release').events()),row=context.journal.stream('release').events()
     .find(value=>value?.type==='held_acceptance_operation_result'&&value.operation===operation);
    if(!row||!history.completed.includes(operation))reject();return pass(row.evidence);},
  });
 }
 return Object.freeze(wrapped);
}

export function createHeldProductionOperations(context,overrides={}){
 const deps={observePostMerge:observeFixedPostMergeHeld,lifecycle:observeHeldLifecycle,mint:mintHeldAcceptancePermit,
  options:()=>admissionOptions(context),premergeConfig:()=>protectedConfig(FIXED_PREMERGE_SIX_READ_CONFIGURATION),
  liveConfig:()=>protectedConfig(FIXED_LIVE_SIX_READ_CONFIGURATION),collect:collectFixed,now:()=>new Date().toISOString(),inspectRecord:inspectFinalReleaseRecord,
  writeAccepted:writeAcceptedHeldReleaseRecord,writeOpen:writeOpenReleaseRecord,prepareOpen:prepareGuardedOpen,publishOpen:publishGuardedOpen,
  recordRoot:FINAL_RELEASE_RECORD_ROOT,candidate:runCandidateCollector,establishHeld:()=>establishCandidateHeld(context),...overrides};
 const journalResult=(kind,attemptId)=>context.journal.stream('release').events().find(row=>row?.schema===1&&row.type===`${kind}_result`&&row.attemptId===attemptId);
 const candidate={check(call){invocation(context,call,'candidate_six_reads');return pass({stage:'candidate_six_reads',fixedIsolatedCollector:true});},
  execute(call){invocation(context,call,'candidate_six_reads',{attempt:true});const stream=context.journal.stream('release');stream.append({schema:1,type:'candidate_six_reads_intent',attemptId:call.attemptId,releaseSha:context.input.releaseSha});
   const report=deps.candidate();if(report&&report.releaseSha!==context.input.releaseSha)reject();stream.append({schema:1,type:'candidate_six_reads_result',attemptId:call.attemptId,releaseSha:context.input.releaseSha,
    status:report?'PASS':'BLOCKED_EXTERNAL',...(report?{reportDigest:hash(report)}:{})});},
  reconcile(call){invocation(context,call,'candidate_six_reads',{attempt:true});const row=journalResult('candidate_six_reads',call.attemptId);if(!row)reject();
   return row.status==='BLOCKED_EXTERNAL'?blocked():pass({stage:'candidate_six_reads',candidatePass:true,livePass:false,reportDigest:row.reportDigest});},observe(){reject();}};
 const admission={check(call){invocation(context,call,'admission_lease');return pass({stage:'admission_lease',fixedAdmissionRoot:RELEASE_ADMISSION_ROOT,intakeOpen:false});},
  async execute(call){invocation(context,call,'admission_lease',{attempt:true});await deps.establishHeld();},async reconcile(call){invocation(context,call,'admission_lease',{attempt:true});
   const result=await deps.establishHeld();if(result.status!=='HELD_LIFECYCLE_OBSERVED'||result.releaseSha!==context.input.releaseSha)reject();return pass({stage:'admission_lease',releaseSha:result.releaseSha,
    epochRunId:result.runId,artifactDigest:result.proof.artifactDigest,apiGeneration:result.proof.api.generation,workerGeneration:result.proof.worker.generation,intakeOpen:false});},observe(){reject();}};
 const revalidation={async check(call){invocation(context,call,'generation_revalidation');const prior=call.state.outputs.admission_lease;if(!prior||!uuid(prior.epochRunId))reject();
   const proof=await deps.lifecycle({releaseSha:context.input.releaseSha,runId:prior.epochRunId});if(proof.api.generation!==prior.apiGeneration||proof.worker.generation!==prior.workerGeneration||proof.artifactDigest!==prior.artifactDigest)reject();
   return pass({stage:'generation_revalidation',releaseSha:context.input.releaseSha,epochRunId:prior.epochRunId,apiGeneration:prior.apiGeneration,workerGeneration:prior.workerGeneration,
    artifactDigest:prior.artifactDigest,generationCurrent:true});},async observe(call){return this.check(call);}};
 const premergeReads={check(call){invocation(context,call,'six_reads');let config;try{config=deps.premergeConfig();}catch{return blocked();}
   if(config.version!==4||config.releaseSha!==context.input.releaseSha||config.workspace!==context.input.workspace||config.principal!==context.input.principal)return blocked();
   return pass({stage:'six_reads',fixedCollector:true});},execute(call){invocation(context,call,'six_reads',{attempt:true});},
  async reconcile(call){invocation(context,call,'six_reads',{attempt:true});let report;try{report=await deps.collect(deps.premergeConfig());}catch{return blocked();}
   const evidence=safeCollector(report,false,context.input.releaseSha);return pass({stage:'six_reads',...evidence});},observe(){reject();}};
 const postmerge={check:call=>deps.observePostMerge(context,call),execute:call=>{deps.observePostMerge(context,call);},
  reconcile:call=>deps.observePostMerge(context,call),observe:call=>deps.observePostMerge(context,call)};
 const mint={
  async check(call){invocation(context,call,'mint_acceptance_permit');const held=deps.observePostMerge(context,call);if(held.status!=='PASS')reject();let config;
   try{config=deps.liveConfig();}catch{return blocked();}if(config.workspace!==context.input.workspace||config.principal!==context.input.principal)reject();
   const proof=await deps.lifecycle({releaseSha:merged(call),runId:held.evidence.epochRunId});return pass({stage:'mint_acceptance_permit',newMainSha:merged(call),epochRunId:held.evidence.epochRunId,
    apiGeneration:proof.api.generation,workerGeneration:proof.worker.generation,collectorConfigured:true});},
  async execute(call){invocation(context,call,'mint_acceptance_permit',{attempt:true});const held=deps.observePostMerge(context,call),proof=await deps.lifecycle({releaseSha:merged(call),runId:held.evidence.epochRunId});
   const config=deps.liveConfig(),cases=readCases(config.dealId),reads=cases.map((row,index)=>{const idempotencyKey=`zola-six:${held.evidence.epochRunId}:${index}`;
    return{index,idempotencyKey,capability:row.capability,permission:row.permissions[0],request:row.text,requestDigest:hash({channel:'jarvis',workspaceId:context.input.workspace,text:row.text,idempotencyKey,executionIntent:'read_only'})};});
   deps.mint({commanderRunId:call.state.context.operationId,mergeMainSha:merged(call),expectedDeploymentSha:merged(call),epochRunId:held.evidence.epochRunId,
    workspace:context.input.workspace,principal:context.input.principal,apiGeneration:proof.api.generation,workerGeneration:proof.worker.generation,reads,journal:context.journal,
    verifyGenerations:()=>({apiGeneration:proof.api.generation,workerGeneration:proof.worker.generation})},deps.options());},
  reconcile(call){invocation(context,call,'mint_acceptance_permit',{attempt:true});const history=inspectHeldAcceptanceHistory(context.journal.stream('release').events());
   if(!['MINTED','CONSUMING'].includes(history.status))reject();return pass({stage:'mint_acceptance_permit',permitId:history.claims.permitId,permitDigest:hash(history.claims),
    newMainSha:history.claims.mergeMainSha,epochRunId:history.claims.epochRunId,apiGeneration:history.claims.apiGeneration,workerGeneration:history.claims.workerGeneration});},
  observe(call){invocation(context,call,'mint_acceptance_permit');const history=inspectHeldAcceptanceHistory(context.journal.stream('release').events());if(!history.claims)reject();return pass({permitId:history.claims.permitId,permitDigest:hash(history.claims)});},
 };
 const readiness=name=>Object.freeze({check(call){invocation(context,call,name);return pass({stage:name,heldLifecycle:true});},execute(call){invocation(context,call,name,{attempt:true});},
  async reconcile(call){invocation(context,call,name,{attempt:true});const binding=heldBinding(context,call),first=await deps.lifecycle({releaseSha:binding.mergeMainSha,runId:binding.epochRunId}),second=await deps.lifecycle({releaseSha:binding.mergeMainSha,runId:binding.epochRunId});
   if(JSON.stringify(first)!==JSON.stringify(second)||first.api.generation!==binding.apiGeneration||first.worker.generation!==binding.workerGeneration)reject();
   const core={stage:name,newMainSha:binding.mergeMainSha,epochRunId:binding.epochRunId,apiGeneration:binding.apiGeneration,workerGeneration:binding.workerGeneration,
    artifactDigest:first.artifactDigest,workerReady:true,generationCurrent:true};return pass({...core,observationDigest:hash(core)});},observe(){reject();}});
 const liveReads=Object.freeze({check(call){invocation(context,call,'six_live_reads');let config;try{config=deps.liveConfig();}catch{return blocked();}
   const binding=heldBinding(context,{...call,attemptId:null});if(config.version!==5||config.releaseSha!==binding.mergeMainSha||config.releaseRunId!==binding.epochRunId)return blocked();return pass({stage:'six_live_reads',fixedCollector:true});},
  execute(call){invocation(context,call,'six_live_reads',{attempt:true});},async reconcile(call){invocation(context,call,'six_live_reads',{attempt:true});let report;
   try{report=await deps.collect(deps.liveConfig());}catch{return blocked();}return pass({stage:'six_live_reads',...safeCollector(report,true,merged(call))});},observe(){reject();}});

 function openEvidence(call){
  const o=call.state.outputs,h=inspectHeldAcceptanceHistory(context.journal.stream('release').events()),main=merged(call),vps=o.journaled_vps_cutover;
  if(h.status!=='CONSUMED'||!vps||vps.newMainSha!==main||!digest(vps.artifactDigest))reject();
  return{commanderRunId:call.state.context.operationId,epochRunId:h.claims.epochRunId,newMainSha:main,mainSha:main,vercelSha:main,vpsSha:main,
   artifactDigest:vps.artifactDigest,apiGeneration:h.claims.apiGeneration,workerGeneration:h.claims.workerGeneration,
   n8nDigest:hash(o.n8n_migration),migrationDigest:hash(o.production_migrations),sixReadsDigest:hash(o.six_reads),rollbackDigest:o.rollback_verification.observationDigest,
   securitySmokeDigest:hash(o.ci_security),productionSmokeDigest:o.production_smoke.observationDigest,permitId:h.claims.permitId,acceptanceDigest:h.acceptanceDigest,
   readCount:o.six_live_reads.readCount,crossOwnerDenials:o.six_live_reads.crossOwnerDenials,paidProviderCalls:o.zero_paid_nexus.paidProviderCalls,mutationDelta:o.zero_unintended_mutation.mutationDelta};
 }
 const finalRecord={check(call){invocation(context,call,'final_release_record');openEvidence(call);return pass({stage:'final_release_record',acceptedHeldReady:true});},
  execute(call){invocation(context,call,'final_release_record',{attempt:true});const e=openEvidence(call),record={schema:1,kind:'zola_release_accepted_held',releaseSha:context.input.releaseSha,
    previousMainSha:context.input.previousMainSha,newMainSha:e.newMainSha,operationId:e.commanderRunId,attemptId:call.attemptId,stageInputDigest:call.inputDigest,
    checkOutputDigest:call.checkOutputDigest,sequenceInputDigest:context.input.inputDigest,registryDigest:RELEASE_REGISTRY_DIGEST,
    acceptedStagesDigest:hash(call.state.outputs),epochRunId:e.epochRunId,permitId:e.permitId,permitDigest:hash(inspectHeldAcceptanceHistory(context.journal.stream('release').events()).claims),
    apiGeneration:e.apiGeneration,workerGeneration:e.workerGeneration,rollbackAcceptanceDigest:e.rollbackDigest,acceptedAt:deps.now()};
   context.journal.stream('release').append({schema:1,type:'final_release_record_intent',record});deps.writeAccepted({record,root:deps.recordRoot,owner:0});},
  reconcile(call){invocation(context,call,'final_release_record',{attempt:true});const intent=context.journal.stream('release').events().find(row=>row?.type==='final_release_record_intent'&&row.record?.attemptId===call.attemptId);
   if(!intent)reject();deps.writeAccepted({record:intent.record,root:deps.recordRoot,owner:0});const found=deps.inspectRecord({releaseSha:context.input.releaseSha,root:deps.recordRoot,owner:0});
   if(found.phase!=='ACCEPTED_HELD'||hash(found.accepted)!==hash(intent.record))reject();return pass({stage:'final_release_record',acceptedRecordDigest:hash(intent.record),acceptedHeld:true});},observe(){reject();}};
 const guardedOpen={check(call){invocation(context,call,'guarded_held_to_open');if(call.state.outputs.final_release_record?.acceptedHeld!==true)reject();openEvidence(call);return pass({stage:'guarded_held_to_open',allPriorStagesConfirmed:true});},
  async execute(call){invocation(context,call,'guarded_held_to_open',{attempt:true});const evidence=openEvidence(call),plan=await deps.prepareOpen({commanderRunId:evidence.commanderRunId,newMainSha:evidence.newMainSha,epochRunId:evidence.epochRunId,verify:async()=>openEvidence(call)});
   const accepted=deps.inspectRecord({releaseSha:context.input.releaseSha,root:deps.recordRoot,owner:0}).accepted;
   const record={schema:1,kind:'zola_release_open',releaseSha:context.input.releaseSha,newMainSha:evidence.newMainSha,operationId:evidence.commanderRunId,attemptId:call.attemptId,
    stageInputDigest:call.inputDigest,checkOutputDigest:call.checkOutputDigest,acceptedRecordDigest:hash(accepted),openAdmissionDigest:hash(plan),openedAt:deps.now()};
   context.journal.stream('release').append({schema:1,type:'final_release_open_record_intent',record});await deps.publishOpen({plan,journal:context.journal},deps.options());deps.writeOpen({record,root:deps.recordRoot,owner:0});},
  async reconcile(call){invocation(context,call,'guarded_held_to_open',{attempt:true});const intent=context.journal.stream('release').events().find(row=>row?.type==='final_release_open_record_intent'&&row.record?.attemptId===call.attemptId);
   if(!intent)reject();const evidence=openEvidence(call),plan=await deps.prepareOpen({commanderRunId:evidence.commanderRunId,newMainSha:evidence.newMainSha,epochRunId:evidence.epochRunId,verify:async()=>openEvidence(call)});
   if(hash(plan)!==intent.record.openAdmissionDigest)reject();await deps.publishOpen({plan,journal:context.journal},deps.options());deps.writeOpen({record:intent.record,root:deps.recordRoot,owner:0});const found=deps.inspectRecord({releaseSha:context.input.releaseSha,root:deps.recordRoot,owner:0});
   if(found.phase!=='OPEN'||hash(found.open)!==hash(intent.record))reject();return pass({stage:'guarded_held_to_open',open:true,newMainSha:intent.record.newMainSha,openRecordDigest:hash(intent.record)});},observe(){reject();}};
 return Object.freeze({candidate_six_reads:Object.freeze(candidate),admission_lease:Object.freeze(admission),generation_revalidation:Object.freeze(revalidation),six_reads:Object.freeze(premergeReads),
  post_merge_held_epoch:Object.freeze(postmerge),mint_acceptance_permit:Object.freeze(mint),worker_readiness:readiness('worker_readiness'),
  generation_fence:readiness('generation_fence'),six_live_reads:liveReads,final_release_record:Object.freeze(finalRecord),guarded_held_to_open:Object.freeze(guardedOpen)});
}
