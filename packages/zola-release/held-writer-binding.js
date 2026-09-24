import {partitionRetiredReleaseHistory} from './retired-release-history.js';
import fs from 'node:fs';
import path from 'node:path';
import {hash} from './commander-journal.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {collectInstalledHeldWriterProfile} from './held-writer-profile.js';
import {observeHeldLifecycle,validateHeldLifecycleProof} from './held-lifecycle.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState,RELEASE_ADMISSION_ROOT} from '../shared/release-admission.js';
import {readRootOwnedJson,readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {publishVerifiedBuyerWriterActivation} from '../buyer-writer/activation.js';
import {checkBuyerWriterHeldReadiness} from '../buyer-writer/activation-readiness.js';
import {createBuyerWriterBindingObserver} from '../buyer-writer/binding.js';
import {createBuyerWriterRuntimeInspector} from '../buyer-writer/runtime-inspection.js';
const reject=()=>{throw new Error('HELD writer binding rejected; retain journal and observe without retry');};
const exact=(v,k)=>v&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??'');
const digest=v=>/^[a-f0-9]{64}$/.test(v??'');
const generation=v=>/^[a-f0-9]{32}$/.test(v??'');
const stages=['admission_lease','post_merge_held_epoch'];
const steps=['retire_commit','retire_binding','publish'];
const inputKeys=['releaseSha','stage','operationId','attemptId','inputDigest','checkOutputDigest'];
const planKeys=[...inputKeys,'runId','apiGeneration','workerGeneration','artifactDigest','configurationDigest','lifecycleDigest','priorBindingDigest','priorCommitDigest'];
function validInput(v){if(!exact(v,inputKeys)||!/^[a-f0-9]{40}$/.test(v.releaseSha??'')||!stages.includes(v.stage)||!uuid(v.operationId)||!uuid(v.attemptId)||!digest(v.inputDigest)||!digest(v.checkOutputDigest))reject();return v;}
function validPlan(p){validInput(Object.fromEntries(inputKeys.map(k=>[k,p[k]])));if(!exact(p,planKeys)||!uuid(p.runId)||!generation(p.apiGeneration)||!generation(p.workerGeneration)||p.apiGeneration===p.workerGeneration||!digest(p.artifactDigest)||!digest(p.configurationDigest)||!digest(p.lifecycleDigest)
 ||!((p.priorBindingDigest===null&&p.priorCommitDigest===null)||(digest(p.priorBindingDigest)&&digest(p.priorCommitDigest)))||p.stage==='admission_lease'&&p.priorBindingDigest!==null)reject();return p;}
function validResult(row,p){if(!exact(row,['schema','type','plan','bindingDigest','commitDigest'])||!digest(row.bindingDigest)||!digest(row.commitDigest)||!same(row.plan,p))reject();}
export function inspectHeldWriterBindingHistory(events){
 const partition=partitionRetiredReleaseHistory(events);if(partition.retired){inspectHeldWriterBindingHistory(partition.prefix);return inspectHeldWriterBindingHistory(partition.current);}
 const records=new Map();
 for(let i=0;i<events.length;i++){
  const row=events[i];if(!String(row?.type??'').startsWith('held_writer_binding_'))continue;
  if(row.schema!==1)reject();const p=validPlan(row.plan),state=inspectReleaseSequenceHistory(events.slice(0,i));
  if(state.pending?.stage!==p.stage||state.context.operationId!==p.operationId||state.pending.attemptId!==p.attemptId||state.pending.inputDigest!==p.inputDigest||state.pending.checkOutputDigest!==p.checkOutputDigest
   ||p.releaseSha!==(p.stage==='admission_lease'?state.context.releaseSha:state.outputs.capture_new_main_sha?.newMainSha))reject();
  let record=records.get(p.stage);
  if(row.type==='held_writer_binding_intent'){
   if(record||!exact(row,['schema','type','plan']))reject();
   if(p.stage==='post_merge_held_epoch'){const prior=records.get('admission_lease');if(!prior?.result||prior.plan.operationId!==p.operationId||prior.result.bindingDigest!==p.priorBindingDigest||prior.result.commitDigest!==p.priorCommitDigest)reject();}
   record={plan:p,pending:null,next:0,result:null};records.set(p.stage,record);
  }else{
   if(!record||!same(record.plan,p)||record.result)reject();
   if(row.type==='held_writer_binding_step_intent'){if(!exact(row,['schema','type','plan','step'])||record.pending||row.step!==steps[record.next])reject();record.pending=row.step;}
   else if(row.type==='held_writer_binding_step_result'){if(!exact(row,['schema','type','plan','step'])||!record.pending||row.step!==record.pending)reject();record.pending=null;record.next++;}
   else if(row.type==='held_writer_binding_result'){validResult(row,p);if(record.pending||record.next!==steps.length)reject();record.result=row;}
   else reject();
  }
 }
 return records;
}
const result=p=>({status:'HELD_WRITER_BINDING_VERIFIED',releaseSha:p.plan.releaseSha,runId:p.plan.runId,apiGeneration:p.plan.apiGeneration,workerGeneration:p.plan.workerGeneration,bindingDigest:p.result.bindingDigest,commitDigest:p.result.commitDigest});
const sync=directory=>{const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
export function createHeldWriterBindingHost({root=RELEASE_ADMISSION_ROOT,profile=collectInstalledHeldWriterProfile,observe=observeHeldLifecycle,acquire=acquireReleaseAdmissionLock,publish=publishVerifiedBuyerWriterActivation,
 inspectBinding=context=>createBuyerWriterBindingObserver({...context,inspectRuntime:createBuyerWriterRuntimeInspector(context)})(),checkReadiness=checkBuyerWriterHeldReadiness}={}){
 let lease,initial,held,initialProof;
 const state=()=>{const file=path.join(root,'state.json');return validateReleaseAdmissionState(readRootOwnedJson(file,{groupId:fs.lstatSync(file).gid,maxBytes:2048}));};
 const heldCheck=()=>{lease.assertIdentity();if(!same(state(),held)||held.mode!=='held')reject();};
 const snapshot=file=>readRootOwnedJsonDigestSnapshot(file,{groupId:initial.context.credentialGroupId,maxBytes:4096});
 const absent=file=>{try{fs.lstatSync(file);return false;}catch(e){if(e.code!=='ENOENT')throw e;return true;}};
 const paths=(p,step)=>{const file=initial.context.filename+(step==='retire_commit'?'.commit.json':'');return {file,archive:file+'.retired-'+p.attemptId,prior:step==='retire_commit'?p.priorCommitDigest:p.priorBindingDigest};};
 const check=async p=>{
  heldCheck();if(held.runId!==p.runId||held.releaseSha!==p.releaseSha||!((held.apiGeneration===null&&held.workerGeneration===null)||(held.apiGeneration===p.apiGeneration&&held.workerGeneration===p.workerGeneration)))reject();const current=await profile(p.releaseSha),proof=validateHeldLifecycleProof(await observe({releaseSha:p.releaseSha,runId:p.runId}),p);
  if(!same(current,initial)||current.artifactDigest!==p.artifactDigest||current.configurationDigest!==p.configurationDigest||current.context.apiGeneration!==p.apiGeneration||current.workerGeneration!==p.workerGeneration
   ||hash(proof)!==p.lifecycleDigest||proof.artifactDigest!==p.artifactDigest||proof.api.generation!==p.apiGeneration||proof.worker.generation!==p.workerGeneration||proof.api.pid!==current.context.apiPid)reject();heldCheck();
 };
 const readinessBackend=()=>initial.backendProfile==='owned-postgres-v1'?{backendProfile:initial.backendProfile,profileDigest:initial.profileDigest}:{};
 const inspectCommitted=async p=>{
  await check(p);const ctx=initial.context,proof=await inspectBinding(ctx);
  if(proof?.approved!==true||proof.credentialsSeparated!==true||proof.apiGeneration!==p.apiGeneration||proof.workerGeneration!==p.workerGeneration||proof.releaseSha!==p.releaseSha||proof.workspace!=='blackspire-command')reject();
  await checkReadiness({...ctx,...readinessBackend(),workerGeneration:p.workerGeneration,requirePreparation:true,preparationCredential:initial.preparationCredential,verifyHeld:heldCheck});
  const binding=snapshot(ctx.filename),commit=snapshot(ctx.filename+'.commit.json');await check(p);return {bindingDigest:binding.digest,commitDigest:commit.digest};
 };
 return {
  async lease(releaseSha){if(process.getuid()!==0)reject();const gid=fs.lstatSync(path.join(root,'state.json')).gid;lease=acquire({root,exclusive:false,allowPending:true,owner:0,groupId:gid});held=state();initial=await profile(releaseSha);
   if(held.mode!=='held'||held.releaseSha!==releaseSha)reject();initialProof=validateHeldLifecycleProof(await observe({releaseSha,runId:held.runId}),held);heldCheck();return lease;},
  async prepare(input,prior){const p=validPlan({...input,runId:held.runId,apiGeneration:initial.context.apiGeneration,workerGeneration:initial.workerGeneration,artifactDigest:initial.artifactDigest,configurationDigest:initial.configurationDigest,lifecycleDigest:hash(initialProof),
   priorBindingDigest:prior?.result.bindingDigest??null,priorCommitDigest:prior?.result.commitDigest??null});await check(p);
   for(const step of steps.slice(0,2)){const {file,archive,prior:expected}=paths(p,step);if(!absent(archive)||(expected===null?!absent(file):snapshot(file).digest!==expected))reject();}
   return p;},check,
  async execute(step,p){await check(p);
   if(step==='publish'){await publish({context:initial.context,checkReadiness:options=>checkReadiness({...options,...readinessBackend(),requirePreparation:options.requirePreparation||options.requireWriterReady,preparationCredential:initial.preparationCredential,verifyHeld:heldCheck})});}
   else {const {file,archive,prior}=paths(p,step);if(prior!==null){if(!absent(archive)||snapshot(file).digest!==prior)reject();fs.linkSync(file,archive);fs.unlinkSync(file);sync(path.dirname(file));}}
   await check(p);
  },
  async observe(step,p){await check(p);if(step==='publish'){await inspectCommitted(p);return true;}
   const {file,archive,prior}=paths(p,step);return absent(file)&&(prior===null?absent(archive):snapshot(archive).digest===prior);},inspect:inspectCommitted,
  close(){lease?.close();},
 };
}
export async function ensureHeldWriterBinding({journal,...input},{host=createHeldWriterBindingHost()}={}){
 validInput(input);const stream=journal.stream('release');const append=event=>{inspectHeldWriterBindingHistory([...stream.events(),event]);stream.append(event);};let records=inspectHeldWriterBindingHistory(stream.events()),record=records.get(input.stage);
 try{await host.lease(input.releaseSha);
  if(!record){if(input.stage==='post_merge_held_epoch'&&!records.get('admission_lease')?.result)reject();const plan=validPlan(await host.prepare(input,records.get('admission_lease')));append({schema:1,type:'held_writer_binding_intent',plan});record=inspectHeldWriterBindingHistory(stream.events()).get(input.stage);}
  if(!inputKeys.every(k=>record.plan[k]===input[k]))reject();const p=record.plan;await host.check(p);
  for(let index=record.next;index<steps.length;index++){const step=steps[index];if(!record.pending){append({schema:1,type:'held_writer_binding_step_intent',plan:p,step});await host.execute(step,p);}
   if(await host.observe(step,p)!==true)reject();append({schema:1,type:'held_writer_binding_step_result',plan:p,step});record=inspectHeldWriterBindingHistory(stream.events()).get(input.stage);}
  const proof=await host.inspect(p);if(record.result){if(proof.bindingDigest!==record.result.bindingDigest||proof.commitDigest!==record.result.commitDigest)reject();}
  else{append({schema:1,type:'held_writer_binding_result',plan:p,...proof});record=inspectHeldWriterBindingHistory(stream.events()).get(input.stage);}
  return result(record);
 }finally{host.close();}
}
// Continuity checks never publish or reconcile missing bindings.
export async function verifyHeldCanonicalWriter({releaseSha,journal},{host=createHeldWriterBindingHost()}={}){
 const records=inspectHeldWriterBindingHistory(journal.stream('release').events()),record=[...records.values()].find(r=>r.plan.releaseSha===releaseSha&&r.result);if(!record)reject();
 try{await host.lease(releaseSha);await host.check(record.plan);const proof=await host.inspect(record.plan);if(proof.bindingDigest!==record.result.bindingDigest||proof.commitDigest!==record.result.commitDigest)reject();return result(record);}finally{host.close();}
}
