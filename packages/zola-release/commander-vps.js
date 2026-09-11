import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from './commander-journal.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';

const ROOT='/opt/blackspire-command',ADMISSION='/etc/blackspire/release-admission';
const API='blackspire-command.service',WORKER='blackspire-command-worker.service',TARGET='blackspire-command.target';
const steps=Object.freeze(['artifact','runtime_binding','pointer','api_start','worker_start','readiness','enable']);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v),uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const reject=()=>{throw new Error('Journaled VPS cutover rejected; retain evidence and reconcile');};
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const baseKeys=['schema','type','operationId','commanderRunId','epochRunId','newMainSha','rollbackSha','artifactDigest','backupDigest','admissionDigest','snapshotDigest'];

export function inspectVpsCutoverHistory(events){
 const rows=events.filter(row=>String(row?.type??'').startsWith('vps_'));
 if(!rows.length)return Object.freeze({started:false,completed:false,pending:null,next:0,rollingBack:false,rollbackComplete:false,intent:null});
 let intent,pending=null,next=0,completed=false,rollingBack=false,rollbackComplete=false;
 for(const row of rows){
  if(row.schema!==3||!exact(row,[...baseKeys,...(row.type==='vps_step_intent'||row.type==='vps_step_result'?['step']:[])])
   ||!uuid(row.operationId)||!uuid(row.commanderRunId)||!uuid(row.epochRunId)||![row.newMainSha,row.rollbackSha].every(sha)
   ||!['artifactDigest','backupDigest','admissionDigest'].every(key=>digest(row[key])))reject();
  if(!intent){if(row.type!=='vps_cutover_intent'||!digest(row.snapshotDigest))reject();intent=row;continue;}
  if(!baseKeys.slice(2).every(key=>row[key]===intent[key]))reject();
  if(row.type==='vps_step_intent'){
   if(rollingBack||completed||pending||row.step!==steps[next])reject();pending=row;
  }else if(row.type==='vps_step_result'){
   if(rollingBack||completed||!pending||row.step!==pending.step)reject();pending=null;next++;
  }else if(row.type==='vps_cutover_result'){
   if(rollingBack||completed||pending||next!==steps.length)reject();completed=true;
  }else if(row.type==='vps_rollback_intent'){
   if(completed||rollingBack)reject();rollingBack=true;pending=null;
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
 const assertAdmission=plan=>{const value=state();if(value.mode!=='held'||value.releaseSha!==plan.newMainSha||value.runId!==plan.epochRunId
   ||value.apiGeneration!==null||value.workerGeneration!==null||hash(value)!==plan.admissionDigest)reject();};
 return Object.freeze({
  snapshot(){const current=fs.readlinkSync(path.join(ROOT,'current'));return{current,state:state(),api:active(API),worker:active(WORKER)};},
  async observe(step,plan){
   assertAdmission(plan);
   if(step==='artifact'){command('/bin/bash',[path.join(repository,'scripts/release-preflight.sh'),plan.newMainSha],{BLACKSPIRE_RELEASE_ROOT:ROOT});
    const proof=await inspectBuyerWriterArtifact({artifactRoot:path.join(ROOT,'releases',plan.newMainSha),releaseSha:plan.newMainSha,environment:'production'});return proof.artifactDigest===plan.artifactDigest;}
   if(step==='runtime_binding'){const file=path.join(ADMISSION,'runtime.env'),stat=fs.lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===0
    &&stat.gid===fs.statSync(ADMISSION).gid&&stat.nlink===1&&(stat.mode&0o7777)===0o640&&fs.readFileSync(file).equals(bindingBytes(plan.epochRunId));}
   if(step==='pointer')return fs.realpathSync(path.join(ROOT,'current'))===path.join(ROOT,'releases',plan.newMainSha);
   if(step==='api_start')return active(API).ActiveState==='active';
   if(step==='worker_start')return active(WORKER).ActiveState==='active';
   if(step==='readiness'){await observeHeldLifecycle({releaseSha:plan.newMainSha,runId:plan.epochRunId});return true;}
   if(step==='enable')return command('/usr/bin/systemctl',['is-enabled',TARGET])==='enabled';
   reject();
  },
  async execute(step,plan){
   assertAdmission(plan);
   if(step==='artifact')command('/bin/bash',[path.join(repository,'scripts/release-create.sh'),plan.newMainSha],{BLACKSPIRE_RELEASE_ROOT:ROOT,BLACKSPIRE_SOURCE_ROOT:repository});
   else if(step==='runtime_binding'){const gid=fs.statSync(ADMISSION).gid;atomicFile(path.join(ADMISSION,'runtime.env'),bindingBytes(plan.epochRunId),{gid});command('/usr/bin/systemctl',['daemon-reload']);}
   else if(step==='pointer')command('/bin/bash',[path.join(repository,'scripts/release-switch.sh'),plan.newMainSha],{BLACKSPIRE_RELEASE_ROOT:ROOT});
   else if(step==='api_start')command('/usr/bin/systemctl',['start',API]);
   else if(step==='worker_start')command('/usr/bin/systemctl',['start',WORKER]);
   else if(step==='readiness')command('/bin/bash',[path.join(repository,'scripts/wait-production-ready.sh'),'http://127.0.0.1:8787',API,WORKER,'60','1']);
   else if(step==='enable')command('/usr/bin/systemctl',['enable',TARGET]);
   else reject();
  },
  async rollback(plan){command('/usr/bin/systemctl',['stop',TARGET]);command('/usr/bin/systemctl',['disable',TARGET]);
   if([active(API),active(WORKER)].some(value=>value.ActiveState!=='inactive'||value.MainPID!=='0'))reject();
   command('/bin/bash',[path.join(repository,'scripts/release-rollback.sh'),plan.rollbackSha],{BLACKSPIRE_RELEASE_ROOT:ROOT});},
  observeRollback(plan){return [active(API),active(WORKER)].every(value=>value.ActiveState==='inactive'&&value.MainPID==='0')
   &&fs.realpathSync(path.join(ROOT,'current'))===path.join(ROOT,'releases',plan.rollbackSha);},
 });
}

function validatePlan(plan){
 if(!exact(plan,['operationId','commanderRunId','epochRunId','newMainSha','rollbackSha','artifactDigest','backupDigest','admissionDigest','snapshotDigest'])
  ||![plan.operationId,plan.commanderRunId,plan.epochRunId].every(uuid)||![plan.newMainSha,plan.rollbackSha].every(sha)||plan.newMainSha===plan.rollbackSha
  ||!['artifactDigest','backupDigest','admissionDigest','snapshotDigest'].every(key=>digest(plan[key])))reject();return structuredClone(plan);
}
const event=(plan,type,extra={})=>({schema:3,type,...plan,...extra});
export async function runVpsCutover({plan,journal,reconcile=false},{host=productionHost()}={}){
 const p=validatePlan(plan),stream=journal.stream('release');let state=inspectVpsCutoverHistory(stream.events());
 try{
  if(!state.started){if(reconcile)reject();const snapshot=host.snapshot();if(hash(snapshot)!==p.snapshotDigest)reject();stream.append(event(p,'vps_cutover_intent'));state=inspectVpsCutoverHistory(stream.events());}
  else if(!baseKeys.slice(2).every(key=>state.intent[key]===p[key])||state.intent.snapshotDigest!==p.snapshotDigest)reject();
  if(state.completed)return{status:'VPS_CUTOVER_COMPLETE',newMainSha:p.newMainSha,replayed:true};
  if(state.rollingBack)return{status:'STOPPED',reason:'VPS_ROLLBACK_REQUIRED',reconciliationRequired:!state.rollbackComplete};
  for(let index=state.next;index<steps.length;index++){
   const step=steps[index];
   if(state.pending){if(await host.observe(step,p)!==true)return rollbackVpsCutover({plan:p,journal},{host});}
   else{stream.append(event(p,'vps_step_intent',{step}));try{await host.execute(step,p);}catch{return{status:'STOPPED',reason:'VPS_STEP_OUTCOME_UNKNOWN',step,reconciliationRequired:true};}}
   if(await host.observe(step,p)!==true)return rollbackVpsCutover({plan:p,journal},{host});
   stream.append(event(p,'vps_step_result',{step}));state=inspectVpsCutoverHistory(stream.events());
  }
  stream.append(event(p,'vps_cutover_result'));return{status:'VPS_CUTOVER_COMPLETE',newMainSha:p.newMainSha,replayed:false};
 }catch{return{status:'STOPPED',reason:'VPS_CUTOVER_REJECTED',reconciliationRequired:true};}
}
export async function rollbackVpsCutover({plan,journal},{host=productionHost()}={}){
 const p=validatePlan(plan),stream=journal.stream('release');try{
  let state=inspectVpsCutoverHistory(stream.events());if(state.completed)reject();
  if(state.rollbackComplete)return{status:'STOPPED',reason:'VPS_CUTOVER_ROLLED_BACK',rollbackReady:true,reconciliationRequired:false,replayed:true};
  if(state.rollingBack){if(await host.observeRollback(p)!==true)return{status:'STOPPED',reason:'VPS_ROLLBACK_OUTCOME_UNKNOWN',rollbackReady:false,reconciliationRequired:true};}
  else{stream.append(event(p,'vps_rollback_intent'));await host.rollback(p);if(await host.observeRollback(p)!==true)reject();}
  stream.append(event(p,'vps_rollback_result'));
  return{status:'STOPPED',reason:'VPS_CUTOVER_ROLLED_BACK',rollbackReady:true,reconciliationRequired:false};
 }catch{return{status:'STOPPED',reason:'VPS_ROLLBACK_OUTCOME_UNKNOWN',rollbackReady:false,reconciliationRequired:true};}
}
