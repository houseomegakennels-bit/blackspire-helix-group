import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash} from './admitted-read-recovery.js';
import {observeAdmittedReadRecovery} from './admitted-read-recovery-host.js';
import {prepareReadRecoveryPlan,validateReadRecoveryPlan} from './admitted-read-transition.js';
import {collectInstalledHeldWriterProfile} from './held-writer-profile.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {readOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {openReleaseJournal} from './commander-journal.js';
export const READ_RECOVERY_ROOT='/var/lib/blackspire-operator/preparation/credential-recovery-20260924';
export const READ_RECOVERY_ADMISSION='/etc/blackspire/release-admission';
const fail=()=>{throw Error('ADMITTED_READ_TRANSITION_PREPARATION_REFUSED');};
const command=(file,args)=>execFileSync(file,args,{encoding:'utf8',timeout:5000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim();
const group=name=>{const r=command('/usr/bin/getent',['group',name]).split(':');if(r.length!==4||r[0]!==name||!/^[1-9][0-9]*$/.test(r[2]))fail();return Number(r[2]);};
export function readRecoveryFile(file,gid,mode){
 const value=readOwnedConfigurationBytes(file,{gid,mode});if(value===null)fail();
 const s=fs.lstatSync(file);
 return {path:file,gid,mode,bytes:value,digest:hash(value),identity:{dev:s.dev,ino:s.ino,uid:s.uid,gid:s.gid,mode:s.mode,nlink:s.nlink}};
}
export async function snapshotReadRecoveryRuntime(){
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1')fail();
 const a=READ_RECOVERY_ADMISSION,gid=fs.lstatSync(a+'/state.json').gid,api=group('blackspire-api'),store=group('blackspire-buyer-store');
 const writer=await collectInstalledHeldWriterProfile(P.releaseSha),runtime=await observeHeldLifecycle({releaseSha:P.releaseSha,runId:P.runId});
 if(writer.context.apiGeneration!==runtime.api.generation||writer.workerGeneration!==runtime.worker.generation||writer.artifactDigest!==runtime.artifactDigest)fail();
 const specs={
  state:[a+'/state.json',gid,0o640],pending:[a+'/pending.json',0,0o600],runtime:[a+'/runtime.env',gid,0o640],
  receiver:['/etc/blackspire/receiver-origin.env',gid,0o640],receiverMetadata:['/var/lib/blackspire-operator/preparation/receiver-origin.json',0,0o600],
  receiverDropin:['/etc/systemd/system/blackspire-command-worker.service.d/45-zola-receiver-origin.conf',0,0o644],
  claims:[a+'/premerge-reads.json',gid,0o640],secret:[a+'/premerge-reads-secret.json',0,0o600],
  config:['/var/lib/blackspire-operator/preparation/six-read-premerge-config.json',0,0o600],
  writerBinding:[writer.context.filename,writer.context.credentialGroupId,0o640],
  writerCommit:[writer.context.filename+'.commit.json',writer.context.credentialGroupId,0o640],
  storeRuntime:['/etc/blackspire-buyer-store/runtime.json',store,0o640],
  storeClient:['/etc/blackspire/command-buyer-store-client.json',api,0o640],
  deal:['/etc/blackspire/command-buyer-deal-context.json',api,0o640],
  target:['/var/lib/blackspire-operator/owned-writer-acceptance.json',api,0o640],
  namespace:['/etc/systemd/system/blackspire-buyer-store.service.d/namespace.conf',0,0o600],
  storeManifest:['/etc/blackspire-buyer-store/installed.json',store,0o640],
 };
 const files=Object.fromEntries(Object.entries(specs).map(([k,v])=>[k,readRecoveryFile(...v)]));
 const config=JSON.parse(files.config.bytes),state=JSON.parse(files.state.bytes);
 if(hash(config)!==P.configDigest||state.mode!=='held'||state.releaseSha!==P.releaseSha||state.runId!==P.runId
 ||files.runtime.bytes!=='BLACKSPIRE_RELEASE_RUN_ID='+P.runId+'\n'
 ||JSON.parse(files.receiverMetadata.bytes).deploymentId!==P.oldDeploymentId)fail();
 const stateOf=unit=>Object.fromEntries(command('/usr/bin/systemctl',['show','--property=Id,ActiveState,SubState,MainPID,InvocationID','--',unit]).split('\n').map(s=>s.split('=')));
 const services=Object.fromEntries(['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-store.service','blackspire-buyer-writer-gateway.service'].map(u=>[u,stateOf(u)]));
 if(Object.values(services).some(s=>s.ActiveState!=='active'||s.SubState!=='running'||!(/^[1-9][0-9]*$/).test(s.MainPID)))fail();
 const publicWriter={context:writer.context,artifactDigest:writer.artifactDigest,configurationDigest:writer.configurationDigest,
 workerGeneration:writer.workerGeneration,backendProfile:writer.backendProfile,profileDigest:writer.profileDigest};
 const value={version:1,runtime,writer:publicWriter,services,files};
 // Credentials in file snapshots remain exclusively inside root-owned records.
 // Public output must contain only the aggregate digest, never this value.
 for(const [k,v]of Object.entries(specs))if(hash(readRecoveryFile(...v))!==hash(files[k]))fail();
 if(hash(await observeHeldLifecycle({releaseSha:P.releaseSha,runId:P.runId}))!==hash(runtime))fail();
 return value;
}
export async function inspectNativeReadRecoveryPreparation(){
 const inspection=await observeAdmittedReadRecovery(),snapshot=await snapshotReadRecoveryRuntime();
 const after=await observeAdmittedReadRecovery();if(hash(inspection)!==hash(after))fail();
 return {status:'READ_RECOVERY_NATIVE_PREPARATION_INSPECTED',inspectionDigest:hash(inspection),snapshotDigest:hash(snapshot),
  protectedFileCount:Object.keys(snapshot.files).length,serviceCount:Object.keys(snapshot.services).length,
  releaseSha:P.releaseSha,oldRunId:P.runId,newDeploymentId:P.newDeploymentId,productionOpen:false};
}
export async function prepareNativeReadRecovery(){
 const records=createBuyerStoreProtectedFiles();let journal;
 try{
  journal=openReleaseJournal();
  const inspection=await observeAdmittedReadRecovery(),snapshot=await snapshotReadRecoveryRuntime();
  const first=hash(snapshot);
  records.directory(READ_RECOVERY_ROOT,{create:true});
  const existing=records.value(READ_RECOVERY_ROOT+'/plan.json',true);
  const plan=existing?validateReadRecoveryPlan(existing):prepareReadRecoveryPlan({inspection,snapshotDigest:first});
  if(plan.inspectionDigest!==hash(inspection)||plan.snapshotDigest!==first)fail();
  records.record(READ_RECOVERY_ROOT+'/snapshot.json',snapshot);
  records.record(READ_RECOVERY_ROOT+'/inspection.json',inspection);
  records.record(READ_RECOVERY_ROOT+'/plan.json',plan);
  if(hash(await snapshotReadRecoveryRuntime())!==first||hash(await observeAdmittedReadRecovery())!==hash(inspection))fail();
  return {status:'READ_RECOVERY_PLAN_RETAINED',planDigest:hash(plan),newRunId:plan.newRunId,productionOpen:false,acceptancePassed:false};
 }finally{journal?.close();}
}
