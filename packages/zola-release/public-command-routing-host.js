import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from './commander-journal.js';
import {inspectReleaseCommander} from './commander.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {inspectFinalReleaseRecord,inspectFinalReleaseRecordHistory} from './final-release-record.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {acquireReleaseAdmissionLock,RELEASE_ADMISSION_ROOT,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {verifyReleaseSource} from './commander-host.js';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
import {ensurePublicCommandRouting,restorePublicCommandRouting} from './public-command-routing.js';
const BASE='/var/lib/blackspire-operator/preparation/public-command-routing';
const FILE='/etc/nginx/sites-available/command.conf',ENABLED='/etc/nginx/sites-enabled/command.conf';
const fail=()=>{throw new Error('Public command routing host refused');};
const run=(program,args)=>execFileSync(program,args,{encoding:'utf8',timeout:15000,maxBuffer:1048576,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'}}).trim();
const bytes=(p,options)=>readOwnedConfigurationBytes(p,options);
const sync=p=>{const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
function makeDirectory(p){try{fs.mkdirSync(p,{mode:0o700});sync(p.slice(0,p.lastIndexOf('/')));}catch(e){if(e.code!=='EEXIST')throw e;}const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||(s.mode&0o7777)!==0o700)fail();}
function remoteMain(expected){const observed=run('/usr/bin/git',['--no-replace-objects','-C',fileURLToPath(new URL('../../',import.meta.url)),'ls-remote','--exit-code','https://github.com/houseomegakennels-bit/blackspire-helix-group.git','refs/heads/main']);if(observed!==expected+'\trefs/heads/main')fail();}
export function createPublicCommandRoutingHost({releaseSha,newMainSha,journal,lease,groupId}){
 if(process.getuid()!==0||![releaseSha,newMainSha].every(v=>/^[a-f0-9]{40}$/.test(v??''))||!lease)fail();
 const root=BASE+'/'+releaseSha;makeDirectory(BASE);makeDirectory(root);
 const current=()=>{const s=fs.lstatSync(ENABLED);if(!s.isSymbolicLink()||s.uid!==0||fs.realpathSync(ENABLED)!==FILE)fail();return bytes(FILE,{mode:0o644});};
 const state=()=>{lease.assertIdentity();return validateReleaseAdmissionState(readRootOwnedJson(RELEASE_ADMISSION_ROOT+'/state.json',{groupId,maxBytes:2048}));};
 const filename=name=>{if(!['plan','intent','result','rejected','restore-intent','restored'].includes(name))fail();return root+'/'+name+'.json';};
 const read=name=>{const p=filename(name),a=bytes(p),b=bytes(p+'.owned-buyer-stage');if(a!==null&&b!==null)fail();return a===null&&b===null?null:JSON.parse(a??b);};
 const publish=(name,value)=>publishOwnedConfigurationBytes(filename(name),null,JSON.stringify(value)+'\n');
 const accepted=()=>{inspectReleaseCommander(journal);const events=journal.stream('release').events(),sequence=inspectReleaseSequenceHistory(events),records=inspectFinalReleaseRecordHistory(events),record=inspectFinalReleaseRecord({releaseSha});
  if(!record.accepted||record.accepted.newMainSha!==newMainSha||hash(record.accepted)!==hash(records.accepted)
   ||sequence.context.releaseSha!==releaseSha||sequence.outputs.capture_new_main_sha?.newMainSha!==newMainSha
   ||sequence.outputs.final_release_record?.acceptedHeld!==true||sequence.outputs.final_release_record.acceptedRecordDigest!==hash(record.accepted)
   ||sequence.pending?.stage!=='guarded_held_to_open'&&sequence.completed!==true)fail();
  return {record:record.accepted,sequence};};
 const authorize=async()=>{verifyReleaseSource(releaseSha);remoteMain(newMainSha);const {record,sequence}=accepted(),s=state();
  if(s.releaseSha!==newMainSha||s.runId!==record.epochRunId||s.mode==='held'&&(s.apiGeneration!==null||s.workerGeneration!==null)
   ||s.mode==='open'&&(s.apiGeneration!==record.apiGeneration||s.workerGeneration!==record.workerGeneration||!read('result')))fail();
  for(const unit of ['blackspire-buyer-writer-gateway.service','blackspire-buyer-store.service']){const values=run('/usr/bin/systemctl',['show','--property=ActiveState,SubState,MainPID','--value',unit]).split('\n');if(!values.includes('active')||!values.includes('running')||!values.some(v=>/^[1-9][0-9]*$/.test(v)))fail();}
  const lifecycle=await observeHeldLifecycle({releaseSha:newMainSha,runId:record.epochRunId});
  if(lifecycle.api.generation!==record.apiGeneration||lifecycle.worker.generation!==record.workerGeneration||lifecycle.artifactDigest!==sequence.outputs.journaled_vps_cutover?.artifactDigest)fail();
  return {releaseSha,newMainSha,operationId:record.operationId,epochRunId:record.epochRunId,apiGeneration:record.apiGeneration,workerGeneration:record.workerGeneration,artifactDigest:lifecycle.artifactDigest,acceptedRecordDigest:hash(record)};};
 const requireHeld=async()=>{await authorize();if(state().mode!=='held')fail();};
 const request=(uri,method='GET',body)=>{const args=['--silent','--show-error','--path-as-is','--resolve','command.blackspirehelix.com:443:127.0.0.1','--connect-timeout','2','--max-time','5','--request',method,'--write-out','\n%{http_code}',...(body===undefined?[]:['--header','content-type: application/json','--data-binary',body]),'https://command.blackspirehelix.com'+uri];const result=run('/usr/bin/curl',args),at=result.lastIndexOf('\n');return {status:Number(result.slice(at+1)),body:result.slice(0,at)};};
 return {read,publish,current,authorize,requireHeld,
  replace:(before,after)=>publishOwnedConfigurationBytes(FILE,before,after,{mode:0o644}),validate:()=>run('/usr/sbin/nginx',['-t']),reload:()=>run('/usr/bin/systemctl',['reload','nginx.service']),
  async verify(){await authorize();const home=request('/');const expected=fs.readFileSync('/opt/blackspire-command/releases/'+newMainSha+'/apps/jarvis-pwa/public/index.html','utf8');if(home.status!==200||home.body!==expected)fail();const session=request('/api/auth/session');if(session.status!==200||JSON.parse(session.body).authenticated!==false)fail();if(request('/api/unified-input','POST','{}').status!==503)fail();},
  async requireStoppedHeld(){verifyReleaseSource(releaseSha);if(state().mode!=='held'||![releaseSha,newMainSha].includes(state().releaseSha))fail();for(const unit of ['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service','blackspire-buyer-store.service']){const values=run('/usr/bin/systemctl',['show','--property=ActiveState,SubState,MainPID','--value',unit]).split('\n');if(!values.includes('inactive')||!values.includes('dead')||!values.includes('0'))fail();}return {releaseSha,newMainSha};},
  verifyRestored(){if(request('/').status!==503)fail();},
 };
}
export async function publishPublicCommandRouting(input,{restore=false}={}){
 const groupId=fs.lstatSync(RELEASE_ADMISSION_ROOT+'/state.json').gid;
 const lease=acquireReleaseAdmissionLock({root:RELEASE_ADMISSION_ROOT,groupId,exclusive:true});
 try{const host=createPublicCommandRoutingHost({...input,lease,groupId});return await(restore?restorePublicCommandRouting:ensurePublicCommandRouting)({host});}finally{lease.close();}
}
