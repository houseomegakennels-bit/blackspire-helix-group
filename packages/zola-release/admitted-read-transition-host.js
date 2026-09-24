import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash} from './admitted-read-recovery.js';
import {validateReadRecoveryPlan} from './admitted-read-transition.js';
import {READ_RECOVERY_ROOT as R,READ_RECOVERY_ADMISSION as A} from './admitted-read-transition-preparation.js';
import {readOwnedConfigurationBytes as read,publishOwnedConfigurationBytes as publish} from './owned-buyer-configuration-host.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {createReceiverOriginTransition,observeReceiverDeployment} from './receiver-origin-transition.js';
import {createOwnedStoreTransition} from './owned-store-transition.js';
import {publishBuyerStoreInstalledManifest} from '../buyer-store/manifest-publication.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {createHeldWriterBindingHost} from './held-writer-binding.js';
import {collectInstalledHeldWriterProfile} from './held-writer-profile.js';
import {validateCollectorConfig} from '../zola-six-reads/collector.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {openReleaseJournal} from './commander-journal.js';

const fail=()=>{throw Error('ADMITTED_READ_TRANSITION_HOST_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytes=v=>JSON.stringify(v)+'\n';
const units=['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-store.service'];
const run=(args,timeout=30000)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout,maxBuffer:8192,
 stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim();
const status=u=>Object.fromEntries(run(['show','--property=ActiveState,SubState,MainPID,InvocationID','--',u],5000).split('\n').map(s=>s.split('=')));
const stopped=()=>{for(const u of units){const s=status(u);if(s.ActiveState!=='inactive'||s.SubState!=='dead'||s.MainPID!=='0')fail();}};
const sync=dir=>{const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
export function createNativeReadRecoveryHost(plan){
 validateReadRecoveryPlan(plan);if(process.getuid?.()!==0||process.versions.node!=='22.23.1')fail();
 const records=createBuyerStoreProtectedFiles(),snapshot=records.value(R+'/snapshot.json'),inspection=records.value(R+'/inspection.json');
 if(hash(snapshot)!==plan.snapshotDigest||hash(inspection)!==plan.inspectionDigest||!same(records.value(R+'/plan.json'),plan))fail();
 const original=snapshot.files,gid=original.state.gid;let journal,eventsJournal;
 const get=name=>records.value(R+'/'+name+'.json');
 const retain=(name,value)=>records.record(R+'/'+name+'.json',value);
 const current=name=>read(original[name].path,{gid:original[name].gid,mode:original[name].mode});
 const replace=(name,value)=>publish(original[name].path,original[name].bytes,value,{gid:original[name].gid,mode:original[name].mode});
 const nextState={version:1,mode:'held',releaseSha:P.releaseSha,runId:plan.newRunId,apiGeneration:null,workerGeneration:null};
 const marker={schema:1,releaseSha:P.releaseSha,runId:plan.newRunId,stateDigest:hash(nextState)};
 const newMetadata={schema:1,releaseSha:P.releaseSha,frontendOrigin:P.newOrigin,deploymentId:P.newDeploymentId};
 const receiver=createReceiverOriginTransition({assertStopped:stopped,groupId:gid,readMetadata:()=>newMetadata});
 const paths={target:original.target.path,root:R+'/owned-store',runtime:original.storeRuntime.path,client:original.storeClient.path,
 deal:original.deal.path,manifest:original.storeManifest.path,namespace:original.namespace.path,current:'/var/lib/blackspire-buyer-store/rootfs/opt/blackspire-command/current'};
 const store=createOwnedStoreTransition({paths,inspect:inspectBuyerWriterArtifact,publishManifest:b=>publishBuyerStoreInstalledManifest(b,{inspect:inspectBuyerWriterArtifact})});
 const lifecycle=()=>observeHeldLifecycle({releaseSha:P.releaseSha,runId:plan.newRunId});
 const writerAction=async(action,step)=>{
  const p=get('writer-plan'),host=createHeldWriterBindingHost();
  try{await host.lease(P.releaseSha);await host.check(p);
   if(action==='execute')await host.execute(step,p);
   if(action==='inspect')return await host.inspect(p);
   if(await host.observe(step,p)!==true)fail();
   return {step,verified:true};
  }finally{host.close();}
 };
 const archive=name=>{
  const f=original[name],dest=R+'/archive/'+name;
  if(fs.existsSync(dest)||current(name)!==f.bytes)fail();
  fs.renameSync(f.path,dest);sync(path.dirname(f.path));sync(path.dirname(dest));
 };
 const archived=name=>{
  const f=original[name],dest=R+'/archive/'+name;
  if(fs.existsSync(f.path)||read(dest,{gid:f.gid,mode:f.mode})!==f.bytes)fail();
  const s=fs.lstatSync(dest);if(s.dev!==f.identity.dev||s.ino!==f.identity.ino)fail();
 };
 const unchangedRows=()=>{
  const c=JSON.parse(original.config.bytes),db=new DatabaseSync(c.databasePath,{readOnly:true});
  try{db.exec('PRAGMA query_only=ON;BEGIN');
   if(hash(db.prepare('SELECT * FROM tasks WHERE id=?').get(P.taskId))!==P.taskDigest
    ||hash(db.prepare('SELECT * FROM provider_attempts WHERE id=?').get(P.providerAttemptId))!==P.providerAttemptDigest)fail();
  }finally{try{db.exec('ROLLBACK');}finally{db.close();}}
 };
 const evidence=value=>({status:'VERIFIED',evidenceDigest:hash(value)});
 async function observe(step){
  if(step==='stop_services'){stopped();return evidence(units);}
  if(step==='archive_permit'){archived('claims');archived('secret');return evidence({claims:original.claims.digest,secret:original.secret.digest});}
  if(step==='prepare_bindings'){
   const p=get('receiver-plan'),s=get('store-plan');
   if(p.origin!==P.newOrigin||p.previousOrigin!==P.oldOrigin||p.deploymentId!==P.newDeploymentId
    ||s.releaseSha!==P.releaseSha||s.previousSha!==P.releaseSha||s.origin!==P.newOrigin)fail();
   return evidence({receiver:p,store:s});
  }
  if(step==='publish_held_epoch'){
   if(current('state')!==bytes(nextState)||current('pending')!==bytes(marker)||current('runtime')!=='BLACKSPIRE_RELEASE_RUN_ID='+plan.newRunId+'\n')fail();
   return evidence(nextState);
  }
  if(step==='publish_receivers'){
   if(!receiver.observe(get('receiver-plan'))||current('receiverMetadata')!==bytes(newMetadata))fail();
   return evidence(newMetadata);
  }
  if(step==='publish_owned_store'){if(!store.observe(get('store-plan')))fail();return evidence(get('store-plan'));}
  if(step==='reload_services'){
   for(const u of units)if(run(['show','--property=NeedDaemonReload','--value','--',u])!=='no')fail();
   return evidence({reloaded:true});
  }
  if(step==='start_services'){
   const p=await lifecycle();if(p.api.generation===snapshot.runtime.api.generation||p.worker.generation===snapshot.runtime.worker.generation)fail();
   retain('lifecycle',p);return evidence(p);
  }
  if(step==='publish_store_manifest'){
   const l=get('lifecycle'),b={releaseSha:P.releaseSha,runId:plan.newRunId,apiGeneration:l.api.generation,workerGeneration:l.worker.generation};
   if(!store.observeManifest(b))fail();return evidence(b);
  }
  if(step==='start_owned_store'){
   const s=status('blackspire-buyer-store.service');if(s.ActiveState!=='active'||s.SubState!=='running'||s.MainPID==='0')fail();return evidence(s);
  }
  if(step==='prepare_writer_binding'){
   const p=get('writer-plan'),h=createHeldWriterBindingHost();
   try{await h.lease(P.releaseSha);await h.check(p);}finally{h.close();}
   return evidence(p);
  }
  if(step==='archive_writer_commit'||step==='archive_writer_binding'){
   return evidence(await writerAction('observe',step==='archive_writer_commit'?'retire_commit':'retire_binding'));
  }
  if(step==='publish_writer_binding'){const p=await writerAction('inspect');retain('writer-result',p);return evidence(p);}
  if(step==='prepare_collector'){
   const c=get('collector-config');if(current('config')!==bytes(c))fail();
   const l=await lifecycle();if(c.apiPid!==l.api.pid||c.workerPid!==l.worker.pid||c.runId!==plan.newRunId||c.frontendOrigin!==P.newOrigin)fail();
   return evidence({configDigest:hash(c),denialReceiptPath:c.denialReceiptPath});
  }
  fail();
 }
 return {
  async acquire(){
   journal=openReleaseJournal();try{records.directory(R+'/events',{create:true});eventsJournal=openReleaseJournal({root:R+'/events'});}catch(e){journal.close();journal=null;throw e;}
   return {close:async()=>{eventsJournal?.close();journal?.close();}};
  },
  async reconcilePreparation(){
   const e=eventsJournal.stream('release').events();
   if(e.length!==5||e.at(-1).type!=='step_intent'||e.at(-1).step!=='prepare_bindings')fail();
   stopped();archived('claims');archived('secret');
   for(const name of Object.keys(original))if(!['claims','secret'].includes(name)&&current(name)!==original[name].bytes)fail();
   for(const name of ['receiver-plan.json','store-plan.json','owned-store','preparation-reconciliation-intent.json'])
    if(fs.existsSync(R+'/'+name))fail();
   retain('preparation-reconciliation-intent',{version:1,kind:'plan-only-reconciliation',reason:'EXACT_STOPPED_NAMESPACE_SCAFFOLDING',
    planDigest:hash(plan),retainedEventsDigest:hash(e),runtimeConfigurationUnchanged:true});
   const r=await receiver.prepare({releaseSha:P.releaseSha,mode:'preview'});
   const s=await store.prepare({releaseSha:P.releaseSha,previousSha:P.releaseSha,origin:P.newOrigin,backendProfile:'owned-postgres-v1',profileDigest:snapshot.writer.profileDigest});
   retain('receiver-plan',r);retain('store-plan',s);
   retain('preparation-reconciliation-result',{version:1,planDigest:hash(plan),receiverPlanDigest:hash(r),storePlanDigest:hash(s)});
   return {status:'BINDING_PREPARATION_RECONCILED',planDigest:hash(plan),productionOpen:false};
  },
  async fence(){
   if(hash(fs.readFileSync('/var/lib/blackspire-operator/release-operations/release.jsonl'))!==P.releaseDigest
    ||fs.realpathSync('/opt/blackspire-command/current')!=='/opt/blackspire-command/releases/'+P.releaseSha)fail();
   const state=validateReleaseAdmissionState(JSON.parse(current('state')));
   if(state.mode!=='held'||state.releaseSha!==P.releaseSha||![P.runId,plan.newRunId].includes(state.runId)
    ||state.apiGeneration!==null||state.workerGeneration!==null)fail();
   for(const f of ['premerge-reads-active.json','acceptance-active.json'])if(fs.existsSync(A+'/'+f))fail();
   unchangedRows();
  },
  async execute(step){
   if(step==='stop_services'){run(['stop','--','blackspire-command.target',...units]);return;}
   if(step==='archive_permit'){stopped();records.directory(R+'/archive',{create:true});archive('claims');archive('secret');return;}
   if(step==='prepare_bindings'){
    stopped();const r=await receiver.prepare({releaseSha:P.releaseSha,mode:'preview'});
    const s=await store.prepare({releaseSha:P.releaseSha,previousSha:P.releaseSha,origin:P.newOrigin,backendProfile:'owned-postgres-v1',profileDigest:snapshot.writer.profileDigest});
    retain('receiver-plan',r);retain('store-plan',s);return;
   }
   if(step==='publish_held_epoch'){
    stopped();const lock=acquireReleaseAdmissionLock({root:A,exclusive:true,owner:0,groupId:gid});
    try{lock.assertIdentity();replace('pending',bytes(marker));replace('runtime','BLACKSPIRE_RELEASE_RUN_ID='+plan.newRunId+'\n');replace('state',bytes(nextState));lock.assertIdentity();}finally{lock.close();}return;
   }
   if(step==='publish_receivers'){stopped();await receiver.publish(get('receiver-plan'));replace('receiverMetadata',bytes(newMetadata));return;}
   if(step==='publish_owned_store'){stopped();await store.publish(get('store-plan'));return;}
   if(step==='reload_services'){stopped();run(['daemon-reload']);return;}
   if(step==='start_services'){stopped();run(['start','--','blackspire-command.target']);return;}
   if(step==='publish_store_manifest'){
    const l=await lifecycle();retain('lifecycle',l);await store.publishManifest({releaseSha:P.releaseSha,runId:plan.newRunId,apiGeneration:l.api.generation,workerGeneration:l.worker.generation});return;
   }
   if(step==='start_owned_store'){await store.start();return;}
   if(step==='prepare_writer_binding'){
    const l=await lifecycle(),profile=await collectInstalledHeldWriterProfile(P.releaseSha);
    if(profile.configurationDigest!==snapshot.writer.configurationDigest||profile.artifactDigest!==snapshot.writer.artifactDigest)fail();
    const p={releaseSha:P.releaseSha,stage:'admitted_read_recovery',operationId:P.operationId,attemptId:P.attemptId,inputDigest:hash(plan),
     checkOutputDigest:plan.inspectionDigest,runId:plan.newRunId,apiGeneration:l.api.generation,workerGeneration:l.worker.generation,
     artifactDigest:l.artifactDigest,configurationDigest:profile.configurationDigest,lifecycleDigest:hash(l),
     priorBindingDigest:original.writerBinding.digest,priorCommitDigest:original.writerCommit.digest};
    retain('writer-plan',p);return;
   }
   if(step==='archive_writer_commit'||step==='archive_writer_binding'){await writerAction('execute',step==='archive_writer_commit'?'retire_commit':'retire_binding');return;}
   if(step==='publish_writer_binding'){await writerAction('execute','publish');return;}
   if(step==='prepare_collector'){
    const l=await lifecycle(),old=JSON.parse(original.config.bytes);
    records.directory(R+'/collector',{create:true});
    const c=validateCollectorConfig({...old,frontendOrigin:P.newOrigin,apiPid:l.api.pid,workerPid:l.worker.pid,runId:plan.newRunId,
      journalDirectory:R+'/collector',denialReceiptPath:R+'/denial-receipt.json'});
    retain('collector-config',c);retain('denial-input',{deniedPrincipal:c.deniedPrincipal,outputPath:c.denialReceiptPath,releaseSha:P.releaseSha,runId:c.runId,workspace:c.workspace});
    replace('config',bytes(c));return;
   }
   fail();
  },
  async observe(step){return {step,planDigest:hash(plan),...await observe(step)};},
  async verifyComplete(){
   await observe('publish_held_epoch');await observe('publish_receivers');await observe('publish_owned_store');
   const l=await lifecycle();if(!same(l,get('lifecycle')))fail();
   await observe('publish_store_manifest');await observe('start_owned_store');await observe('publish_writer_binding');await observe('prepare_collector');
   await observeReceiverDeployment({releaseSha:P.releaseSha,mode:'preview',origin:P.newOrigin,deploymentId:P.newDeploymentId});
   unchangedRows();
  },
  events:()=>eventsJournal.stream('release').events(),
  append:e=>eventsJournal.stream('release').append(e),
 };
}
