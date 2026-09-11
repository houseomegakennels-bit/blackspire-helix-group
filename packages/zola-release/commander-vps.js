import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from './commander-journal.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {validateReleaseAdmissionState} from '../shared/release-admission.js';
import {acquireReleaseAdmissionLock} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {verifyProtectedReleaseBackup} from './commander-backup.js';

const ROOT='/opt/blackspire-command',ADMISSION='/etc/blackspire/release-admission';
const API='blackspire-command.service',WORKER='blackspire-command-worker.service',TARGET='blackspire-command.target';
const steps=Object.freeze(['backup','artifact','state_pointer','api_start','health','stopped_worker_rejection','worker_start','readiness','generation_fence','enable']);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v),uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const reject=()=>{throw new Error('Journaled VPS cutover rejected; retain evidence and reconcile');};
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const baseKeys=['schema','type','operationId','commanderRunId','epochRunId','rollbackEpochRunId','newMainSha','rollbackSha','artifactDigest','rollbackArtifactDigest','backupDigest','backupManifestFile','admissionDigest','snapshotDigest'];

export function inspectVpsCutoverHistory(events){
 const rows=events.filter(row=>String(row?.type??'').startsWith('vps_'));
 if(!rows.length)return Object.freeze({started:false,completed:false,pending:null,next:0,rollingBack:false,rollbackComplete:false,intent:null});
 let intent,pending=null,next=0,completed=false,rollingBack=false,rollbackComplete=false;
 for(const row of rows){
  const extras=row.type==='vps_cutover_intent'?['snapshot']:row.type==='vps_step_intent'||row.type==='vps_step_result'?['step']:[];
  if(row.schema!==4||!exact(row,[...baseKeys,...extras])
   ||![row.operationId,row.commanderRunId,row.epochRunId,row.rollbackEpochRunId].every(uuid)||![row.newMainSha,row.rollbackSha].every(sha)
   ||!['artifactDigest','rollbackArtifactDigest','backupDigest','admissionDigest','snapshotDigest'].every(key=>digest(row[key]))
   ||typeof row.backupManifestFile!=='string'||!row.backupManifestFile.startsWith('/'))reject();
  if(!intent){if(row.type!=='vps_cutover_intent'||hash(row.snapshot)!==row.snapshotDigest||JSON.stringify(row.snapshot).length>8192)reject();intent=row;continue;}
  if(!baseKeys.slice(2).every(key=>row[key]===intent[key]))reject();
  if(row.type==='vps_step_intent'){
   if(rollingBack||completed||pending||row.step!==steps[next])reject();pending=row;
  }else if(row.type==='vps_step_result'){
   if(rollingBack||completed||!pending||row.step!==pending.step)reject();pending=null;next++;
  }else if(row.type==='vps_cutover_result'){
   if(rollingBack||completed||pending||next!==steps.length)reject();completed=true;
  }else if(row.type==='vps_rollback_intent'){
   if(rollingBack)reject();rollingBack=true;pending=null;
  }else if(row.type==='vps_rollback_result'){
   if(!rollingBack||rollbackComplete)reject();rollbackComplete=true;
  }else reject();
 }
 return Object.freeze({started:true,completed,pending:pending?structuredClone(pending):null,next,rollingBack,rollbackComplete,intent:structuredClone(intent)});
}

function bindingBytes(epochRunId){return Buffer.from(`BLACKSPIRE_RELEASE_RUN_ID=${epochRunId}\n`);}
function syncDirectory(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function atomicFile(filename,bytes,{mode=0o640,gid=0}={}){
 const directory=path.dirname(filename),temporary=path.join(directory,`.zola-cutover-${process.pid}-${Date.now()}.tmp`);let fd;
 try{fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  fs.fchownSync(fd,0,gid);fs.fchmodSync(fd,mode);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(temporary,filename);syncDirectory(directory);
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function command(file,args,env={}){const result=spawnSync(file,args,{encoding:'utf8',timeout:120000,maxBuffer:65536,killSignal:'SIGKILL',stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C',...env}});if(result.status!==0||result.error)reject();return result.stdout.trim();}
function productionHost(){
 const repository=fileURLToPath(new URL('../../',import.meta.url));
 const state=()=>validateReleaseAdmissionState(readRootOwnedJson(path.join(ADMISSION,'state.json'),{groupId:fs.statSync(path.join(ADMISSION,'state.json')).gid,maxBytes:2048}));
 const active=unit=>{const output=command('/usr/bin/systemctl',['show','--no-pager','--property=ActiveState,SubState,MainPID,InvocationID','--',unit]);return Object.fromEntries(output.split('\n').map(line=>line.split('=')));};
 const enabled=()=>{const result=spawnSync('/usr/bin/systemctl',['is-enabled','--',TARGET],{encoding:'utf8',timeout:2000,maxBuffer:4096,killSignal:'SIGKILL',stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  const value=result.stdout?.trim();if(result.error||result.stderr!==''||![[0,'enabled'],[1,'disabled']].some(([status,text])=>result.status===status&&value===text))reject();return value==='enabled';};
 const assertAdmission=plan=>{const value=state();if(value.mode!=='held'||value.releaseSha!==plan.newMainSha||value.runId!==plan.epochRunId
   ||value.apiGeneration!==null||value.workerGeneration!==null||hash(value)!==plan.admissionDigest)reject();};
 return Object.freeze({
  lease(){return acquireReleaseAdmissionLock({root:ADMISSION,exclusive:true,owner:0,groupId:fs.statSync(path.join(ADMISSION,'state.json')).gid});},
  async snapshot(plan){
   assertAdmission(plan);
   const current=fs.realpathSync(path.join(ROOT,'current'));
   if(current!==path.join(ROOT,'releases',plan.rollbackSha))reject();
   command('/bin/bash',[path.join(repository,'scripts/release-preflight.sh'),plan.rollbackSha],{BLACKSPIRE_RELEASE_ROOT:ROOT});
   const rollbackProof=await inspectBuyerWriterArtifact({artifactRoot:path.join(ROOT,'releases',plan.rollbackSha),releaseSha:plan.rollbackSha,environment:'production'});
   if(rollbackProof.artifactDigest!==plan.rollbackArtifactDigest)reject();
   const runtimeFile=path.join(ADMISSION,'runtime.env');let runtime=null;
   try{const stat=fs.lstatSync(runtimeFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o7777)!==0o640)reject();runtime={bytes:fs.readFileSync(runtimeFile,'utf8'),gid:stat.gid};}
   catch(error){if(error.code!=='ENOENT')throw error;}
   return{current,state:state(),runtime,targetEnabled:enabled(),api:active(API),worker:active(WORKER)};
  },
  async observe(step,plan){
   assertAdmission(plan);
   if(step==='backup'){const proof=await verifyProtectedReleaseBackup({releaseSha:plan.newMainSha,manifestFile:plan.backupManifestFile});return hash(proof)===plan.backupDigest;}
   if(step==='artifact'){command('/bin/bash',[path.join(repository,'scripts/release-preflight.sh'),plan.newMainSha],{BLACKSPIRE_RELEASE_ROOT:ROOT});
    const proof=await inspectBuyerWriterArtifact({artifactRoot:path.join(ROOT,'releases',plan.newMainSha),releaseSha:plan.newMainSha,environment:'production'});return proof.artifactDigest===plan.artifactDigest;}
   if(step==='state_pointer'){const file=path.join(ADMISSION,'runtime.env'),stat=fs.lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===0
    &&stat.gid===fs.statSync(ADMISSION).gid&&stat.nlink===1&&(stat.mode&0o7777)===0o640&&fs.readFileSync(file).equals(bindingBytes(plan.epochRunId))
    &&fs.realpathSync(path.join(ROOT,'current'))===path.join(ROOT,'releases',plan.newMainSha);}
   if(step==='api_start')return active(API).ActiveState==='active';
   if(step==='health')return JSON.parse(command('/usr/bin/curl',['--fail','--silent','--show-error','--max-time','5','http://127.0.0.1:8787/health'])).ok===true;
   if(step==='stopped_worker_rejection')return active(WORKER).ActiveState==='inactive'&&active(WORKER).MainPID==='0';
   if(step==='worker_start')return active(WORKER).ActiveState==='active';
   if(step==='readiness'){await observeHeldLifecycle({releaseSha:plan.newMainSha,runId:plan.epochRunId});return true;}
   if(step==='generation_fence'){const first=await observeHeldLifecycle({releaseSha:plan.newMainSha,runId:plan.epochRunId}),second=await observeHeldLifecycle({releaseSha:plan.newMainSha,runId:plan.epochRunId});return same(first,second);}
   if(step==='enable')return enabled();
   reject();
  },
  async execute(step,plan){
   assertAdmission(plan);
   if(step==='backup'||step==='health'||step==='stopped_worker_rejection'||step==='generation_fence')return;
   if(step==='artifact')command('/bin/bash',[path.join(repository,'scripts/release-create.sh'),plan.newMainSha],{BLACKSPIRE_RELEASE_ROOT:ROOT,BLACKSPIRE_SOURCE_ROOT:repository});
   else if(step==='state_pointer'){const gid=fs.statSync(ADMISSION).gid;atomicFile(path.join(ADMISSION,'runtime.env'),bindingBytes(plan.epochRunId),{gid});command('/bin/bash',[path.join(repository,'scripts/release-switch.sh'),plan.newMainSha],{BLACKSPIRE_RELEASE_ROOT:ROOT});command('/usr/bin/systemctl',['daemon-reload']);}
   else if(step==='api_start')command('/usr/bin/systemctl',['start',API]);
   else if(step==='worker_start')command('/usr/bin/systemctl',['start',WORKER]);
   else if(step==='readiness')command('/bin/bash',[path.join(repository,'scripts/wait-production-ready.sh'),'http://127.0.0.1:8787',API,WORKER,'60','1']);
   else if(step==='enable')command('/usr/bin/systemctl',['enable',TARGET]);
   else reject();
  },
  async rollback(plan,snapshot){command('/usr/bin/systemctl',['stop',TARGET]);command('/usr/bin/systemctl',['disable',TARGET]);
   if([active(API),active(WORKER)].some(value=>value.ActiveState!=='inactive'||value.MainPID!=='0'))reject();
   const proof=await inspectBuyerWriterArtifact({artifactRoot:path.join(ROOT,'releases',plan.rollbackSha),releaseSha:plan.rollbackSha,environment:'production'});if(proof.artifactDigest!==plan.rollbackArtifactDigest)reject();
   const gid=fs.statSync(ADMISSION).gid,rollbackState={version:1,mode:'held',releaseSha:plan.rollbackSha,runId:plan.rollbackEpochRunId,apiGeneration:null,workerGeneration:null};
   atomicFile(path.join(ADMISSION,'state.json'),Buffer.from(JSON.stringify(rollbackState)+'\n'),{gid});
   atomicFile(path.join(ADMISSION,'runtime.env'),bindingBytes(plan.rollbackEpochRunId),{gid});
   atomicFile(path.join(ADMISSION,'pending.json'),Buffer.from(JSON.stringify({schema:4,kind:'vps_rollback_hold',commanderRunId:plan.commanderRunId,releaseSha:plan.rollbackSha,epochRunId:plan.rollbackEpochRunId})+'\n'),{mode:0o600,gid:0});
   command('/bin/bash',[path.join(repository,'scripts/release-rollback.sh'),plan.rollbackSha],{BLACKSPIRE_RELEASE_ROOT:ROOT});command('/usr/bin/systemctl',['daemon-reload']);
   if(snapshot.targetEnabled)command('/usr/bin/systemctl',['enable',TARGET]);
   if(snapshot.api.ActiveState==='active')command('/usr/bin/systemctl',['start',API]);
   if(snapshot.worker.ActiveState==='active')command('/usr/bin/systemctl',['start',WORKER]);
  },
  observeRollback(plan,snapshot){const rollbackState=state();return rollbackState.mode==='held'&&rollbackState.releaseSha===plan.rollbackSha&&rollbackState.runId===plan.rollbackEpochRunId
   &&fs.readFileSync(path.join(ADMISSION,'runtime.env')).equals(bindingBytes(plan.rollbackEpochRunId))
   &&fs.realpathSync(path.join(ROOT,'current'))===path.join(ROOT,'releases',plan.rollbackSha)
   &&enabled()===snapshot.targetEnabled
   &&active(API).ActiveState===snapshot.api.ActiveState&&active(WORKER).ActiveState===snapshot.worker.ActiveState;},
 });
}

function validatePlan(plan){
 if(!exact(plan,['operationId','commanderRunId','epochRunId','rollbackEpochRunId','newMainSha','rollbackSha','artifactDigest','rollbackArtifactDigest','backupDigest','backupManifestFile','admissionDigest','snapshotDigest'])
  ||![plan.operationId,plan.commanderRunId,plan.epochRunId,plan.rollbackEpochRunId].every(uuid)||![plan.newMainSha,plan.rollbackSha].every(sha)||plan.newMainSha===plan.rollbackSha
  ||!['artifactDigest','rollbackArtifactDigest','backupDigest','admissionDigest','snapshotDigest'].every(key=>digest(plan[key]))
  ||typeof plan.backupManifestFile!=='string'||!path.isAbsolute(plan.backupManifestFile))reject();return structuredClone(plan);
}
const event=(plan,type,extra={})=>({schema:4,type,...plan,...extra});
export async function runVpsCutover({plan,journal,reconcile=false},{host=productionHost()}={}){
 const p=validatePlan(plan),stream=journal.stream('release');let state=inspectVpsCutoverHistory(stream.events()),lease;
 try{
  lease=host.lease?.(p);lease?.assertIdentity?.();
  if(!state.started){if(reconcile)reject();const snapshot=await host.snapshot(p);if(hash(snapshot)!==p.snapshotDigest)reject();
   if(await host.observe('backup',p)!==true)reject();stream.append(event(p,'vps_cutover_intent',{snapshot}));state=inspectVpsCutoverHistory(stream.events());}
  else if(!baseKeys.slice(2).every(key=>state.intent[key]===p[key])||state.intent.snapshotDigest!==p.snapshotDigest)reject();
  if(state.rollingBack)return{status:'STOPPED',reason:'VPS_ROLLBACK_REQUIRED',reconciliationRequired:!state.rollbackComplete};
  if(state.completed)return{status:'VPS_CUTOVER_COMPLETE',newMainSha:p.newMainSha,replayed:true};
  for(let index=state.next;index<steps.length;index++){
   const step=steps[index];
   if(state.pending){if(await host.observe(step,p)!==true)return rollbackVpsCutoverWithLease(p,stream,host);}
   else{stream.append(event(p,'vps_step_intent',{step}));try{await host.execute(step,p);}catch{return{status:'STOPPED',reason:'VPS_STEP_OUTCOME_UNKNOWN',step,reconciliationRequired:true};}}
   if(await host.observe(step,p)!==true)return rollbackVpsCutoverWithLease(p,stream,host);
   stream.append(event(p,'vps_step_result',{step}));state=inspectVpsCutoverHistory(stream.events());
  }
  stream.append(event(p,'vps_cutover_result'));return{status:'VPS_CUTOVER_COMPLETE',newMainSha:p.newMainSha,replayed:false};
 }catch{return{status:'STOPPED',reason:'VPS_CUTOVER_REJECTED',reconciliationRequired:true};}finally{lease?.close?.();}
}
async function rollbackVpsCutoverWithLease(p,stream,host){
 try{
  const state=inspectVpsCutoverHistory(stream.events());
  if(state.rollbackComplete)return{status:'STOPPED',reason:'VPS_CUTOVER_ROLLED_BACK',rollbackReady:true,reconciliationRequired:false,replayed:true};
  if(state.rollingBack){if(await host.observeRollback(p,state.intent.snapshot)!==true)return{status:'STOPPED',reason:'VPS_ROLLBACK_OUTCOME_UNKNOWN',rollbackReady:false,reconciliationRequired:true};}
  else{stream.append(event(p,'vps_rollback_intent'));await host.rollback(p,state.intent.snapshot);if(await host.observeRollback(p,state.intent.snapshot)!==true)reject();}
  stream.append(event(p,'vps_rollback_result'));
  return{status:'STOPPED',reason:'VPS_CUTOVER_ROLLED_BACK',rollbackReady:true,reconciliationRequired:false};
 }catch{return{status:'STOPPED',reason:'VPS_ROLLBACK_OUTCOME_UNKNOWN',rollbackReady:false,reconciliationRequired:true};}
}
export async function rollbackVpsCutover({plan,journal},{host=productionHost()}={}){
 const p=validatePlan(plan),stream=journal.stream('release');let lease;try{
  lease=host.lease?.(p);lease?.assertIdentity?.();return await rollbackVpsCutoverWithLease(p,stream,host);
 }catch{return{status:'STOPPED',reason:'VPS_ROLLBACK_OUTCOME_UNKNOWN',rollbackReady:false,reconciliationRequired:true};}finally{lease?.close?.();}
}
