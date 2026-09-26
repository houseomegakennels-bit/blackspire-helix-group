import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {hash,openReleaseJournal} from './commander-journal.js';
import {inspectFinalReleaseRecord} from './final-release-record.js';
import {collectInstalledHeldWriterProfile} from './held-writer-profile.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {createHeldWriterBindingHost} from './held-writer-binding.js';
import {publishBuyerStoreInstalledManifest} from '../buyer-store/manifest-publication.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {readRootOwnedJson,readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {parseAdminPasswordHash} from '../shared/password-auth.js';
const NODE='/opt/nodejs/node-v22.23.1-linux-x64/bin/node';
const ROOT='/etc/blackspire/release-admission',STATE=ROOT+'/state.json';
const ENV='/etc/blackspire/command-api.env',STAGED='/run/blackspire-password-reset.hash';
const RECORD='/var/lib/blackspire-operator/password-maintenance-20260926';
const API='blackspire-command.service',WORKER='blackspire-command-worker.service';
const STORE='blackspire-buyer-store.service',GATEWAY='blackspire-buyer-writer-gateway.service';
const units=[API,WORKER,STORE,GATEWAY];
const fail=()=>{throw Error('Password maintenance verification rejected');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function run(cmd,args,env){try{return execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:65536,...(env?{env}:{})});}catch{fail();}}
function sync(dir){const f=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(f);}finally{fs.closeSync(f);}}
function read(file,mode,gid){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||s.gid!==gid||s.nlink!==1||(s.mode&0o7777)!==mode||s.size>65536)fail();
 const b=fs.readFileSync(fd);const end=fs.fstatSync(fd);if(s.ino!==end.ino||s.size!==end.size||s.mtimeMs!==end.mtimeMs)fail();return b;
 }finally{fs.closeSync(fd);}
}
function atomic(file,bytes,mode,gid){
 const temp=file+'.maintenance-'+randomUUID();let f;
 try{f=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 fs.fchownSync(f,0,gid);fs.fchmodSync(f,mode);fs.writeFileSync(f,bytes);fs.fsyncSync(f);fs.closeSync(f);f=undefined;fs.renameSync(temp,file);sync(path.dirname(file));
 }finally{if(f!==undefined)fs.closeSync(f);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function retain(file,value){const f=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(f,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)+'\n');fs.fsyncSync(f);}finally{fs.closeSync(f);}sync(path.dirname(file));}
const envOf=pid=>Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
const stableEnv=env=>Object.fromEntries(Object.entries(env).filter(([k])=>!['INVOCATION_ID','JOURNAL_STREAM','SYSTEMD_EXEC_PID','COMMAND_ADMIN_PASSWORD_HASH'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
const active=unit=>run('/usr/bin/systemctl',['show',unit,'-p','ActiveState','--value']).trim();
async function ready(open,sha){
 const r=await fetch('http://127.0.0.1:8789/ready',{signal:AbortSignal.timeout(4000),redirect:'error'}),j=await r.json();
 const keys=['releaseAdmission','lifecycle','database','productionConfig','worker','scheduler','deploymentIdentity','buyerStore','buyerWriter'];
 if(r.status!==(open?200:503)||j.ok!==open||!same(Object.keys(j.checks??{}).sort(),[...keys].sort())
 ||keys.some(k=>j.checks[k]!==((k==='releaseAdmission')?open:true))||j.deploymentIdentity?.build?.value!==sha||j.dependencies?.worker?.activeTask!==false)fail();
}
async function bounded(fn){let last;for(let i=0;i<30;i++){try{return await fn();}catch(e){last=e;await new Promise(r=>setTimeout(r,1000));}}throw last;}
export function createPasswordMaintenanceHost(){
 let globalJournal,journal,plan,privateState,held,newState,touched=false;
 const state=()=>validateReleaseAdmissionState(readRootOwnedJson(STATE,{groupId:fs.lstatSync(STATE).gid,maxBytes:2048}));
 const current=()=>fs.realpathSync('/opt/blackspire-command/current');
 const config=()=>hash([
  read('/etc/blackspire/command.env',0o640,fs.lstatSync('/etc/blackspire/command.env').gid).toString(),
  read(ROOT+'/runtime.env',0o640,fs.lstatSync(ROOT+'/runtime.env').gid).toString(),
  ...units.map(u=>run('/usr/bin/systemctl',['cat',u])),
  read('/etc/blackspire-buyer-store/runtime.json',0o640,fs.lstatSync('/etc/blackspire-buyer-store/runtime.json').gid).toString(),
 ]);
 function exchange(before,after){
  const lease=acquireReleaseAdmissionLock({root:ROOT,exclusive:true,owner:0,groupId:plan.gid});
  try{lease.assertIdentity();if(!same(state(),before))fail();atomic(STATE,JSON.stringify(after)+'\n',0o640,plan.gid);lease.assertIdentity();if(!same(state(),after))fail();}
  finally{lease.close();}
 }
 async function unchanged(){
  if(current()!==plan.artifactRoot||config()!==plan.configurationDigest)fail();
  const proof=await inspectBuyerWriterArtifact({artifactRoot:plan.artifactRoot,releaseSha:plan.releaseSha,environment:'production'});
  if(proof.artifactDigest!==plan.artifactDigest)fail();
 }
 async function running(){
  await unchanged();const p=await observeHeldLifecycle({releaseSha:plan.releaseSha,runId:plan.runId});
  if(p.artifactDigest!==plan.artifactDigest||p.api.generation===plan.oldState.apiGeneration||p.worker.generation===plan.oldState.workerGeneration)fail();
  const a=envOf(p.api.pid),w=envOf(p.worker.pid);
  if(a.COMMAND_ADMIN_PASSWORD_HASH!==privateState.verifier||!same(stableEnv(a),privateState.apiEnvironment)
   ||!same(stableEnv(w),privateState.workerEnvironment)||w.COMMAND_ADMIN_PASSWORD_HASH!==undefined)fail();
  if(newState&&(p.api.generation!==newState.apiGeneration||p.worker.generation!==newState.workerGeneration))fail();
  return p;
 }
 const host={
  async preflight(){
   if(process.getuid()!==0||process.version!=='v22.23.1'||fs.existsSync(RECORD))fail();
   globalJournal=openReleaseJournal();
   const events=globalJournal.stream('release').events(),end=events.at(-1);
   if(end?.type!=='sequence_completed'||fs.existsSync(ROOT+'/pending.json'))fail();
   const oldState=state();if(oldState.mode!=='open')fail();
   const sha=oldState.releaseSha,artifactRoot='/opt/blackspire-command/releases/'+sha;
   if(current()!==artifactRoot||units.some(u=>active(u)!=='active'))fail();
   const final=inspectFinalReleaseRecord({releaseSha:'f1f004ffcfe43ff92271ed3618f9b3d3bb7ac57e'});
   if(final.phase!=='OPEN'||final.open.newMainSha!==sha||!events.some(e=>e.type==='release_open_result'&&e.newMainSha===sha&&e.epochRunId===oldState.runId&&e.openStateDigest===hash(oldState))
    ||final.accepted.epochRunId!==oldState.runId||final.accepted.apiGeneration!==oldState.apiGeneration||final.accepted.workerGeneration!==oldState.workerGeneration)fail();
   await ready(true,sha);
   const life=await observeHeldLifecycle({releaseSha:sha,runId:oldState.runId});
   if(life.api.generation!==oldState.apiGeneration||life.worker.generation!==oldState.workerGeneration)fail();
   const profile=await collectInstalledHeldWriterProfile(sha);
   const gid=fs.lstatSync(ENV).gid,envBytes=read(ENV,0o640,gid),staged=read(STAGED,0o600,0),verifier=staged.toString().trim();
   if(!parseAdminPasswordHash(verifier)||!envBytes.toString().endsWith('\n'))fail();
   const lines=envBytes.toString().split('\n'),matches=lines.filter(l=>/^COMMAND_ADMIN_PASSWORD_HASH=/.test(l));
   if(matches.length!==1)fail();
   const next=Buffer.from(lines.map(l=>/^COMMAND_ADMIN_PASSWORD_HASH=/.test(l)?"COMMAND_ADMIN_PASSWORD_HASH='"+verifier+"'":l).join('\n'));
   const api=envOf(life.api.pid),worker=envOf(life.worker.pid);
   const configured=matches[0].slice('COMMAND_ADMIN_PASSWORD_HASH='.length).replace(/^'|'$/g,'');
   if(api.COMMAND_ADMIN_PASSWORD_HASH!==configured||api.COMMAND_ADMIN_PASSWORD_HASH===verifier||worker.COMMAND_ADMIN_PASSWORD_HASH!==undefined)fail();
   const binding=readRootOwnedJsonDigestSnapshot(profile.context.filename,{groupId:profile.context.credentialGroupId,maxBytes:4096});
   const commit=readRootOwnedJsonDigestSnapshot(profile.context.filename+'.commit.json',{groupId:profile.context.credentialGroupId,maxBytes:4096});
   plan={version:1,operationId:randomUUID(),releaseSha:sha,artifactRoot,runId:oldState.runId,gid:fs.lstatSync(STATE).gid,
    oldState,artifactDigest:life.artifactDigest,configurationDigest:config(),writerConfigurationDigest:profile.configurationDigest,
    priorBindingDigest:binding.digest,priorCommitDigest:commit.digest,releaseRecordDigest:hash(final),oldEnvironmentDigest:hash(envBytes.toString()),newEnvironmentDigest:hash(next.toString())};
   privateState={gid,envBytes,next,verifier,staged,apiEnvironment:stableEnv(api),workerEnvironment:stableEnv(worker)};
   await unchanged();return structuredClone(plan);
  },
  async record(step,phase){
   if(!journal){
    fs.mkdirSync(RECORD,{mode:0o700});sync(path.dirname(RECORD));retain(RECORD+'/plan.json',plan);retain(RECORD+'/previous-api.env',privateState.envBytes);
    journal=openReleaseJournal({root:RECORD});
   }
   journal.stream('release').append({schema:1,type:'password_maintenance',operationId:plan.operationId,step,phase});
   console.log(step+': '+phase);
  },
  async hold(){await unchanged();held={...plan.oldState,mode:'held',apiGeneration:null,workerGeneration:null};touched=true;exchange(plan.oldState,held);},
  async stop(){run('/usr/bin/systemctl',['stop','blackspire-command.target',...units]);if(units.some(u=>active(u)!=='inactive'))fail();},
  async install(){await unchanged();if(units.some(u=>active(u)!=='inactive')||!read(ENV,0o640,privateState.gid).equals(privateState.envBytes)||!read(STAGED,0o600,0).equals(privateState.staged))fail();
   atomic(ENV,privateState.next,0o640,privateState.gid);if(!read(ENV,0o640,privateState.gid).equals(privateState.next))fail();},
  async revoke(){if(units.some(u=>active(u)!=='inactive'))fail();run('/usr/sbin/runuser',['-u','blackspire-api','--',NODE,plan.artifactRoot+'/scripts/revoke-all-sessions.js'],
   {PATH:'/usr/bin:/bin',NODE_ENV:'production',BLACKSPIRE_STATE_OWNER:'vps-production',BLACKSPIRE_DB_PATH:'/opt/blackspire-command/shared/database/command.sqlite'});},
  async start(){await unchanged();run('/usr/bin/systemctl',['start',GATEWAY,'blackspire-command.target']);const p=await bounded(running);
   newState={...held,mode:'open',apiGeneration:p.api.generation,workerGeneration:p.worker.generation};retain(RECORD+'/new-state.json',newState);},
  async store(){await running();await publishBuyerStoreInstalledManifest({releaseSha:plan.releaseSha,runId:plan.runId,apiGeneration:newState.apiGeneration,workerGeneration:newState.workerGeneration},{inspect:inspectBuyerWriterArtifact});
   run('/usr/bin/systemctl',['start',STORE]);if(active(STORE)!=='active')fail();},
  async writer(){
   await running();const profile=await collectInstalledHeldWriterProfile(plan.releaseSha);if(profile.configurationDigest!==plan.writerConfigurationDigest)fail();
   const h=createHeldWriterBindingHost({archiveRunId:plan.runId});
   try{await h.lease(plan.releaseSha);
    const p=await h.prepare({releaseSha:plan.releaseSha,stage:'post_merge_held_epoch',operationId:plan.operationId,attemptId:plan.operationId,inputDigest:hash(plan),checkOutputDigest:hash(newState)},
     {result:{bindingDigest:plan.priorBindingDigest,commitDigest:plan.priorCommitDigest}});
    retain(RECORD+'/writer-plan.json',p);
    for(const step of ['retire_commit','retire_binding','publish']){journal.stream('release').append({schema:1,type:'maintenance_writer',step,phase:'intent'});await h.execute(step,p);if(!await h.observe(step,p))fail();journal.stream('release').append({schema:1,type:'maintenance_writer',step,phase:'complete'});}
    retain(RECORD+'/writer-result.json',await h.inspect(p));
   }finally{h.close();}
  },
  async verifyHeld(){await running();await bounded(()=>ready(false,plan.releaseSha));if(!same(state(),held))fail();},
  async open(){await running();await ready(false,plan.releaseSha);exchange(held,newState);},
  async verifyOpen(){await running();await bounded(()=>ready(true,plan.releaseSha));if(!same(state(),newState))fail();
   const r=await fetch('https://command.blackspirehelix.com/ready',{signal:AbortSignal.timeout(8000),redirect:'error'}),j=await r.json();
   if(r.status!==200||j.ok!==true||j.deploymentIdentity?.build?.value!==plan.releaseSha)fail();
  },
  async finish(){await running();retain(RECORD+'/result.json',{version:1,status:'PASSWORD_ACTIVATED',releaseSha:plan.releaseSha,planDigest:hash(plan),stateDigest:hash(newState),at:new Date().toISOString()});
   if(!read(STAGED,0o600,0).equals(privateState.staged))fail();fs.unlinkSync(STAGED);sync('/run');},
  async contain(){if(!touched)return;const s=state();if(s.releaseSha!==plan.releaseSha||s.runId!==plan.runId)fail();
   if(s.mode==='open'){if(!same(s,newState))fail();exchange(s,held);}
   run('/usr/bin/systemctl',['stop','blackspire-command.target',...units]);if(units.some(u=>active(u)!=='inactive'))fail();
  },
  close(){journal?.close();globalJournal?.close();}
 };
 return host;
}
