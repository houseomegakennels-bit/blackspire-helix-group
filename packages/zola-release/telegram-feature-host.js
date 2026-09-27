import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {hash,openReleaseJournal} from './commander-journal.js';
import {checkFeatureRelease} from './feature-release-preflight.js';
import {createFeatureAuthorityRebind} from './feature-authority-rebind.js';
import {createOwnedStoreTransition} from './owned-store-transition.js';
import {createReceiverOriginTransition,observeReceiverDeployment} from './receiver-origin-transition.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {createHeldWriterBindingHost} from './held-writer-binding.js';
import {publishBuyerStoreInstalledManifest} from '../buyer-store/manifest-publication.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {readRootOwnedJson,readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {validatePasswordMaintenanceReadiness} from './password-maintenance.js';
const SHA='c9d6b01099b69ff1c6a1a5693650f363540c8090';
const RECEIVER={releaseSha:SHA,mode:'preview',origin:'https://frontend-jqjl2vj2d-houseomegakennels-4825s-projects.vercel.app',deploymentId:'dpl_6PBTnPPuGpfoKHatWWvkWo377QNR'};
const ROOT='/etc/blackspire/release-admission',STATE=ROOT+'/state.json';
const RECORD='/var/lib/blackspire-operator/telegram-feature-release-20260927';
const ENV='/etc/blackspire/command.env',RUNTIME=ROOT+'/runtime.env';
const API='blackspire-command.service',WORKER='blackspire-command-worker.service',STORE='blackspire-buyer-store.service',GATEWAY='blackspire-buyer-writer-gateway.service',UNITS=[API,WORKER,STORE,GATEWAY];
const fail=()=>{throw Error('Feature transaction rejected; retain protected evidence');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const run=(file,args,env)=>{try{return execFileSync(file,args,{encoding:'utf8',timeout:60000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],...(env?{env}:{})});}catch{fail();}};
const sys=(...args)=>run('/usr/bin/systemctl',args);
const active=u=>sys('show',u,'-p','ActiveState','--value').trim();
function sync(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function read(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o022)||s.size>65536)fail();
 const bytes=fs.readFileSync(fd),z=fs.fstatSync(fd);if(['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].some(k=>s[k]!==z[k]))fail();
 return {bytes,gid:s.gid,mode:s.mode&0o7777};
 }finally{fs.closeSync(fd);}
}
function atomic(file,bytes,{gid,mode}){
 const temp=file+'.feature-'+randomUUID(),fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.fchownSync(fd,0,gid);fs.fchmodSync(fd,mode);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);sync(path.dirname(file));
}
function retain(file,value){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function envOf(pid){return Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));}
async function bounded(fn){let error;for(let i=0;i<20;i++){try{return await fn();}catch(e){error=e;await new Promise(r=>setTimeout(r,1000));}}throw error;}
export function createTelegramFeatureHost(){
 let globalJournal,journal,plan,oldState,held,newState,oldEnv,oldRuntime,pair,envNew,runtimeNew,authority,authorityProof,store,storeProof,receiver,receiverProof,touched=false;
 const state=()=>validateReleaseAdmissionState(readRootOwnedJson(STATE,{groupId:fs.lstatSync(STATE).gid,maxBytes:4096}));
 const exchange=(before,after)=>{
  const lock=acquireReleaseAdmissionLock({root:ROOT,exclusive:true,owner:0,groupId:fs.lstatSync(STATE).gid});
  try{lock.assertIdentity();if(!same(state(),before))fail();atomic(STATE,JSON.stringify(after)+'\n',{mode:0o640,gid:fs.lstatSync(STATE).gid});lock.assertIdentity();if(!same(state(),after))fail();}
  finally{lock.close();}
 };
 const stopped=()=>{if(UNITS.some(u=>active(u)!=='inactive'||sys('show',u,'-p','MainPID','--value').trim()!=='0'))fail();};
 const stop=()=>{sys('stop','blackspire-command.target',...UNITS);for(const u of UNITS)if(active(u)==='failed')sys('reset-failed',u);stopped();};
 const binding=()=>{
  const file='/etc/blackspire/buyer-writer-binding.json',out={};
  for(const [key,p]of [['bindingDigest',file],['commitDigest',file+'.commit.json']]){
   try{out[key]=readRootOwnedJsonDigestSnapshot(p,{groupId:fs.lstatSync(p).gid,maxBytes:4096}).digest;}catch(e){if(e.code==='ENOENT')out[key]=null;else throw e;}
  }return out;
 };
 async function renewWriter(sha,runId,attemptId){
  const prior=binding(),h=createHeldWriterBindingHost({archiveRunId:runId});
  try{await h.lease(sha);const p=await h.prepare({releaseSha:sha,stage:'post_merge_held_epoch',operationId:plan.operationId,attemptId,inputDigest:hash(plan),checkOutputDigest:hash(newState)},{result:prior});
   retain(RECORD+'/writer-plan-'+attemptId+'.json',p);
   for(const step of ['retire_commit','retire_binding','publish']){
    journal.stream('release').append({schema:1,type:'feature_writer',attemptId,step,phase:'intent'});await h.execute(step,p);
    if(!await h.observe(step,p))fail();journal.stream('release').append({schema:1,type:'feature_writer',attemptId,step,phase:'complete'});
   }
   const result=await h.inspect(p);retain(RECORD+'/writer-result-'+attemptId+'.json',result);return result;
  }finally{h.close();}
 }
 async function lifecycle(sha,runId){
  if(fs.realpathSync('/opt/blackspire-command/current')!=='/opt/blackspire-command/releases/'+sha)fail();
  const p=await observeHeldLifecycle({releaseSha:sha,runId});
  if(p.api.generation===oldState.apiGeneration||p.worker.generation===oldState.workerGeneration)fail();
  return p;
 }
 async function ready(open,sha,publicCheck=false){
  const r=await fetch((publicCheck?'https://command.blackspirehelix.com':'http://127.0.0.1:8789')+'/ready',{redirect:'error',signal:AbortSignal.timeout(8000)});
  validatePasswordMaintenanceReadiness(r.status,await r.json(),{open,releaseSha:sha});
 }
 async function installed(){
  if(!authority.observe(authorityProof)||!store.observe(storeProof)||!receiver.observe(receiverProof)
   ||!read(ENV).bytes.equals(envNew)||!read(RUNTIME).bytes.equals(runtimeNew)||hash(read('/etc/blackspire/command-api.env').bytes.toString())!==plan.apiEnvironmentDigest)fail();
 }
 const host={
  async preflight(){
   if(process.getuid()!==0||process.version!=='v22.23.1'||fs.existsSync(RECORD))fail();
   globalJournal=openReleaseJournal();
   if(globalJournal.stream('release').events().at(-1)?.type!=='sequence_completed')fail();
   const check=await checkFeatureRelease(SHA);await observeReceiverDeployment(RECEIVER);
   const space=fs.statfsSync('/');if(space.bavail*space.bsize<1073741824)fail();
   oldState=state();oldEnv=read(ENV);oldRuntime=read(RUNTIME);
   if(hash(oldState)!==check.stateDigest||oldEnv.mode!==0o640||oldRuntime.mode!==0o640
    ||oldRuntime.bytes.toString()!=='BLACKSPIRE_RELEASE_RUN_ID='+oldState.runId+'\n')fail();
   pair=readRootOwnedJson('/var/lib/blackspire-operator/zola-telegram/paired.json',{groupId:0,maxBytes:4096});
   if(!/^[0-9]+:[A-Za-z0-9_-]+$/.test(pair.token)||!Number.isSafeInteger(pair.botId)||!Number.isSafeInteger(pair.allowedUserId)
    ||pair.allowedUserId<=0||pair.privateChatId!==pair.allowedUserId||pair.status!=='STAGED_NOT_ACTIVE'||!/^[A-Za-z0-9_-]{32,128}$/.test(pair.webhookSecret))fail();
   const keys=['TELEGRAM_BOT_TOKEN','TELEGRAM_ALLOWED_USERS','TELEGRAM_PRIVATE_CHAT_ID','TELEGRAM_WEBHOOK_SECRET','TELEGRAM_MODE','ZOLA_CANONICAL_CONTEXT'];
   const existing=oldEnv.bytes.toString().split('\n').filter(l=>keys.some(k=>l.startsWith(k+'=')));
   if(existing.length!==1||existing[0]!=='TELEGRAM_MODE=dry-run')fail();
   const bot=await fetch('https://api.telegram.org/bot'+pair.token+'/getWebhookInfo',{signal:AbortSignal.timeout(8000),redirect:'error'}).then(r=>r.json()).catch(fail);
   if(bot.ok!==true||bot.result?.url!=='')fail();
   plan={version:1,operationId:randomUUID(),commanderRunId:randomUUID(),runId:randomUUID(),rollbackAttemptId:randomUUID(),candidateSha:SHA,
    previousSha:oldState.releaseSha,previousRunId:oldState.runId,artifactDigest:check.artifactDigest,previousArtifactDigest:check.previousArtifactDigest,
    previousAuthorityReceiptDigest:check.authorityReceiptDigest,previousRecoveryResultDigest:check.recoveryResultDigest,
    oldState,receiver:RECEIVER,apiEnvironmentDigest:hash(read('/etc/blackspire/command-api.env').bytes.toString())};
   envNew=Buffer.from(oldEnv.bytes.toString().split('\n').filter(l=>l!=='TELEGRAM_MODE=dry-run').join('\n').replace(/\n?$/,'\n')+keys.map((k,i)=>k+'='+[pair.token,pair.allowedUserId,pair.privateChatId,pair.webhookSecret,'webhook','true'][i]).join('\n')+'\n');
   runtimeNew=Buffer.from('BLACKSPIRE_RELEASE_RUN_ID='+plan.runId+'\n');
   plan.configurationDigest=hash(envNew.toString());plan.runtimeDigest=hash(runtimeNew.toString());
   return structuredClone(plan);
  },
  async record(step,phase){
   if(!journal){fs.mkdirSync(RECORD,{mode:0o700});sync(path.dirname(RECORD));retain(RECORD+'/plan.json',plan);
    retain(RECORD+'/private-backup.json',{env:{...oldEnv,bytes:oldEnv.bytes.toString('base64')},runtime:{...oldRuntime,bytes:oldRuntime.bytes.toString('base64')}});
    journal=openReleaseJournal({root:RECORD});}
   journal.stream('release').append({schema:1,type:'feature_release',operationId:plan.operationId,step,phase});console.log(step+': '+phase);
  },
  async hold(){const c=await checkFeatureRelease(SHA);if(hash(oldState)!==c.stateDigest)fail();held={...oldState,mode:'held',apiGeneration:null,workerGeneration:null};touched=true;exchange(oldState,held);},
  async stop(){stop();},
  async prepare(){
   stopped();
   authority=createFeatureAuthorityRebind({operationId:plan.operationId,commanderRunId:plan.commanderRunId,candidateSha:plan.previousSha,candidateArtifactDigest:plan.previousArtifactDigest,newMainSha:SHA,artifactDigest:plan.artifactDigest,epochRunId:plan.runId,previousRunId:plan.previousRunId,previousAuthorityReceiptDigest:plan.previousAuthorityReceiptDigest,previousRecoveryResultDigest:plan.previousRecoveryResultDigest},{assertStopped:stopped});
   authorityProof=await authority.prepare();retain(RECORD+'/authority-plan.json',authorityProof);
   const runtime=JSON.parse(read('/etc/blackspire-buyer-store/runtime.json').bytes);
   store=createOwnedStoreTransition({inspect:inspectBuyerWriterArtifact});storeProof=await store.prepare({releaseSha:SHA,previousSha:plan.previousSha,origin:RECEIVER.origin,backendProfile:'owned-postgres-v1',profileDigest:runtime.client.profileDigest});retain(RECORD+'/store-plan.json',storeProof);
   receiver=createReceiverOriginTransition({assertStopped:stopped,readMetadata:()=>({schema:1,releaseSha:SHA,frontendOrigin:RECEIVER.origin,deploymentId:RECEIVER.deploymentId})});
   receiverProof=await receiver.prepare({releaseSha:SHA,mode:'preview'});retain(RECORD+'/receiver-plan.json',receiverProof);
  },
  async install(){
   stopped();await authority.publish(authorityProof);await store.publish(storeProof);await receiver.publish(receiverProof);
   if(!read(ENV).bytes.equals(oldEnv.bytes)||!read(RUNTIME).bytes.equals(oldRuntime.bytes))fail();
   atomic(ENV,envNew,oldEnv);atomic(RUNTIME,runtimeNew,oldRuntime);sys('daemon-reload');await installed();
  },
  async switchRelease(){
   stopped();await installed();const next={version:1,mode:'held',releaseSha:SHA,runId:plan.runId,apiGeneration:null,workerGeneration:null};exchange(held,next);held=next;
   run('/bin/bash',['scripts/release-switch.sh',SHA],{...process.env,PATH:'/opt/nodejs/node-v22.23.1-linux-x64/bin:/usr/bin:/bin',BLACKSPIRE_DEPLOYMENT_ENVIRONMENT:'production'});
  },
  async start(){
   await installed();sys('start',GATEWAY,'blackspire-command.target');const p=await bounded(()=>lifecycle(SHA,plan.runId));
   for(const role of ['api','worker']){const e=envOf(p[role].pid);if(e.TELEGRAM_BOT_TOKEN!==pair.token||e.TELEGRAM_PRIVATE_CHAT_ID!==String(pair.privateChatId)||e.ZOLA_CANONICAL_CONTEXT!=='true'||e.TELEGRAM_MODE!=='webhook')fail();}
   newState={...held,mode:'open',apiGeneration:p.api.generation,workerGeneration:p.worker.generation};retain(RECORD+'/new-state.json',newState);
  },
  async store(){await store.publishManifest({releaseSha:SHA,runId:plan.runId,apiGeneration:newState.apiGeneration,workerGeneration:newState.workerGeneration});await store.start();},
  async writer(){await renewWriter(SHA,plan.runId,plan.operationId);},
  async verifyHeld(){await installed();await lifecycle(SHA,plan.runId);await bounded(()=>ready(false,SHA));},
  async open(){await installed();await ready(false,SHA);exchange(held,newState);},
  async verifyOpen(){await installed();await lifecycle(SHA,plan.runId);await bounded(()=>ready(true,SHA));await ready(true,SHA,true);},
  async finish(){retain(RECORD+'/result.json',{version:1,status:'FEATURE_RELEASE_ACTIVE',planDigest:hash(plan),stateDigest:hash(newState),releaseSha:SHA,telegramActivated:false});},
  async contain(){
   if(!touched)return;const s=state();if(![plan.previousSha,SHA].includes(s.releaseSha)||![plan.previousRunId,plan.runId].includes(s.runId))fail();
   if(s.mode==='open')exchange(s,{...s,mode:'held',apiGeneration:null,workerGeneration:null});stop();
  },
  async rollback(){
   stopped();
   if(receiverProof){await receiver.restore(receiverProof);if(!receiver.restored(receiverProof))fail();}
   if(storeProof){await store.restore(storeProof);if(!store.restored(storeProof))fail();}
   if(authorityProof){await authority.restore(authorityProof);if(!await authority.restored(authorityProof))fail();}
   for(const [file,before,after]of [[ENV,oldEnv,envNew],[RUNTIME,oldRuntime,runtimeNew]]){const b=read(file).bytes;if(!b.equals(before.bytes)&&!b.equals(after))fail();atomic(file,before.bytes,before);}
   sys('daemon-reload');const s=state(),oldHeld={...oldState,mode:'held',apiGeneration:null,workerGeneration:null};if(!same(s,oldHeld))exchange(s,oldHeld);held=oldHeld;
   const temp='/opt/blackspire-command/.rollback-'+plan.operationId;fs.symlinkSync('/opt/blackspire-command/releases/'+plan.previousSha,temp);fs.renameSync(temp,'/opt/blackspire-command/current');sync('/opt/blackspire-command');
   const a=await inspectBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+plan.previousSha,releaseSha:plan.previousSha,environment:'production'});if(a.artifactDigest!==plan.previousArtifactDigest)fail();
   sys('start',GATEWAY,'blackspire-command.target');const p=await bounded(()=>lifecycle(plan.previousSha,plan.previousRunId));newState={...oldHeld,mode:'open',apiGeneration:p.api.generation,workerGeneration:p.worker.generation};
   await publishBuyerStoreInstalledManifest({releaseSha:plan.previousSha,runId:plan.previousRunId,apiGeneration:p.api.generation,workerGeneration:p.worker.generation},{inspect:inspectBuyerWriterArtifact});sys('start',STORE);
   await renewWriter(plan.previousSha,plan.previousRunId,plan.rollbackAttemptId);await bounded(()=>ready(false,plan.previousSha));exchange(oldHeld,newState);await ready(true,plan.previousSha,true);
   retain(RECORD+'/rollback-result.json',{version:1,status:'FEATURE_RELEASE_ROLLED_BACK',planDigest:hash(plan),stateDigest:hash(newState),releaseSha:plan.previousSha});
  },
  close(){journal?.close();globalJournal?.close();}
 };
 return host;
}
