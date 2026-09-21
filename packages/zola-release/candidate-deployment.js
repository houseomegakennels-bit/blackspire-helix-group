// Candidate activation changes the current pointer while intake remains HELD.
// The independently verified recovery release is never relabelled as candidate.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {inspectSealedBuyerWriterArtifact,inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {verifyAdmissionServicesStopped} from './admission-hold.js';
const ROOT='/opt/blackspire-command',ADMISSION='/etc/blackspire/release-admission';
const sha=v=>/^[a-f0-9]{40}$/.test(v??''),digest=v=>/^[a-f0-9]{64}$/.test(v??''),uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??'');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),reject=()=>{throw new Error('Candidate deployment rejected; preserve journal and reconcile');};
const steps=['pointer','runtime','reload'];
const keys=['operationId','releaseSha','recoverySha','runId','artifactDigest','recoveryArtifactDigest','previousSha','previousArtifactDigest','stateDigest'];
function exact(v,k){return v&&Object.keys(v).sort().join(',')===[...k].sort().join(',');}
function valid(p){if(!exact(p,keys)||!uuid(p.operationId)||!uuid(p.runId)||!['releaseSha','recoverySha','previousSha'].every(k=>sha(p[k]))||p.releaseSha===p.recoverySha||!['artifactDigest','recoveryArtifactDigest','previousArtifactDigest','stateDigest'].every(k=>digest(p[k])))reject();return p;}
export function inspectCandidateDeploymentHistory(events){
 let plan=null,pending=null,next=0,completed=false;
 for(const row of events.filter(e=>String(e?.type??'').startsWith('candidate_deployment_'))){
  const extras=['candidate_deployment_step_intent','candidate_deployment_step_result'].includes(row.type)?['step']:[];
  if(row.schema!==1||!exact(row,['schema','type',...keys,...extras]))reject();
  const p=valid(Object.fromEntries(keys.map(k=>[k,row[k]])));
  if(!plan){if(row.type!=='candidate_deployment_intent')reject();plan=p;continue;}
  if(!same(plan,p)||completed)reject();
  if(row.type==='candidate_deployment_step_intent'){if(pending||row.step!==steps[next])reject();pending=row.step;}
  else if(row.type==='candidate_deployment_step_result'){if(!pending||row.step!==pending)reject();pending=null;next++;}
  else if(row.type==='candidate_deployment_result'){if(pending||next!==steps.length)reject();completed=true;}
  else reject();
 }
 return {plan,pending,next,completed};
}
function command(file,args,env={}){const r=spawnSync(file,args,{encoding:'utf8',timeout:120000,maxBuffer:8192,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C',...env}});if(r.status!==0||r.error||r.signal)reject();return r.stdout;}
function sync(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function createCandidateDeploymentHost({root=ROOT,admission=ADMISSION,run=command,
 inspectSealed=inspectSealedBuyerWriterArtifact,inspectDeployed=inspectBuyerWriterArtifact,
 stopped=verifyAdmissionServicesStopped,acquire=acquireReleaseAdmissionLock}={}){
 const ROOT=root,ADMISSION=admission;
 const repository=fileURLToPath(new URL('../../',import.meta.url));
 const gid=()=>fs.statSync(path.join(ADMISSION,'state.json')).gid;
 const readState=()=>validateReleaseAdmissionState(readRootOwnedJson(path.join(ADMISSION,'state.json'),{groupId:gid(),maxBytes:2048}));
 const current=()=>{const p=fs.realpathSync(path.join(ROOT,'current')),s=path.basename(p);if(!sha(s)||p!==path.join(ROOT,'releases',s))reject();return s;};
 const artifact=(s,sealed)=> (sealed?inspectSealed:inspectDeployed)({artifactRoot:path.join(ROOT,'releases',s),releaseSha:s,environment:'production'});
 const runtime=p=>Buffer.from(`BLACKSPIRE_RELEASE_RUN_ID=${p.runId}\n`);
 const check=p=>{const s=readState();if(s.mode!=='held'||s.releaseSha!==p.releaseSha||s.runId!==p.runId||s.apiGeneration!==null||s.workerGeneration!==null||hash(s)!==p.stateDigest)reject();};
 return {lease:()=>acquire({root:ADMISSION,exclusive:true,owner:0,groupId:gid()}),check,
  async prepare(input){stopped();const state=readState();if(state.mode!=='held'||state.releaseSha!==input.releaseSha||state.apiGeneration!==null||state.workerGeneration!==null)reject();
   const previousSha=current();if(previousSha===input.releaseSha)reject();
   const [candidate,recovery,previous]=await Promise.all([artifact(input.releaseSha,true),artifact(input.recoverySha,true),artifact(previousSha,false)]);
   return valid({...input,runId:state.runId,artifactDigest:candidate.artifactDigest,recoveryArtifactDigest:recovery.artifactDigest,previousSha,previousArtifactDigest:previous.artifactDigest,stateDigest:hash(state)});},
  async execute(step,p){check(p);stopped();
   if(step==='pointer'){if(current()!==p.previousSha||(await artifact(p.previousSha,false)).artifactDigest!==p.previousArtifactDigest||(await artifact(p.releaseSha,true)).artifactDigest!==p.artifactDigest)reject();
    run('/bin/bash',[path.join(repository,'scripts/release-switch.sh'),p.releaseSha],{BLACKSPIRE_RELEASE_ROOT:ROOT,BLACKSPIRE_DEPLOYMENT_ENVIRONMENT:'production'});}
   else if(step==='runtime'){const file=path.join(ADMISSION,'runtime.env'),temporary=path.join(ADMISSION,`.candidate-runtime-${p.operationId}`);let fd;
    try{try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.nlink!==1||(s.mode&0o7777)!==0o640)reject();}catch(e){if(e.code!=='ENOENT')throw e;}
     fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.fchownSync(fd,0,gid());fs.fchmodSync(fd,0o640);fs.writeFileSync(fd,runtime(p));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,file);sync(ADMISSION);
    }finally{if(fd!==undefined)fs.closeSync(fd);}}
   else if(step==='reload')run('/usr/bin/systemctl',['daemon-reload']);else reject();},
  async observe(step,p){check(p);
   if(current()!==p.releaseSha||(await artifact(p.releaseSha,false)).artifactDigest!==p.artifactDigest)return false;
   if(step==='pointer')return true;
   const file=path.join(ADMISSION,'runtime.env');let s;try{s=fs.lstatSync(file);}catch{return false;}
   if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==gid()||s.nlink!==1||(s.mode&0o7777)!==0o640||!fs.readFileSync(file).equals(runtime(p)))return false;
   if(step==='runtime')return true;
   if(step!=='reload')reject();
   for(const unit of ['blackspire-command.service','blackspire-command-worker.service']){
    const values=Object.fromEntries(run('/usr/bin/systemctl',['show','--no-pager','--property=NeedDaemonReload,WorkingDirectory','--',unit]).trim().split('\n').map(s=>s.split('=')));
    if(values.NeedDaemonReload!=='no'||values.WorkingDirectory!==path.join(ROOT,'current'))return false;
   }return true;
  }};
}
export async function prepareCandidateDeployment(input,{journal,host=createCandidateDeploymentHost()}={}){
 if(!exact(input,['operationId','releaseSha','recoverySha'])||!uuid(input.operationId)||!sha(input.releaseSha)||!sha(input.recoverySha)||input.releaseSha===input.recoverySha)reject();
 const stream=journal.stream('release');let state=inspectCandidateDeploymentHistory(stream.events()),lease;
 try{lease=host.lease();lease.assertIdentity();
  if(!state.plan){const plan=valid(await host.prepare(input));if(!Object.keys(input).every(k=>plan[k]===input[k]))reject();stream.append({schema:1,type:'candidate_deployment_intent',...plan});state=inspectCandidateDeploymentHistory(stream.events());}
  const p=state.plan;if(!Object.keys(input).every(k=>p[k]===input[k]))reject();host.check(p);
  for(let i=state.next;i<steps.length;i++){const step=steps[i];lease.assertIdentity();host.check(p);
   if(!state.pending){stream.append({schema:1,type:'candidate_deployment_step_intent',...p,step});await host.execute(step,p);}
   if(await host.observe(step,p)!==true)reject();stream.append({schema:1,type:'candidate_deployment_step_result',...p,step});state=inspectCandidateDeploymentHistory(stream.events());
  }
  if(await host.observe('reload',p)!==true)reject();lease.assertIdentity();
  if(!state.completed)stream.append({schema:1,type:'candidate_deployment_result',...p});return {...p,completed:true};
 }finally{lease?.close();}
}
export async function verifyCandidateDeploymentForStart({releaseSha,runId,journal},{host=createCandidateDeploymentHost()}={}){
 const s=inspectCandidateDeploymentHistory(journal.stream('release').events());if(!s.completed||s.plan.releaseSha!==releaseSha||s.plan.runId!==runId)reject();
 host.check(s.plan);if(await host.observe('reload',s.plan)!==true)reject();return s.plan;
}
