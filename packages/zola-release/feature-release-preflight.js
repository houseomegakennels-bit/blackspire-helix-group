import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {hash} from './commander-journal.js';
import {readRootOwnedJson,readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {inspectBuyerWriterArtifact,inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {validateReleaseAdmissionState} from '../shared/release-admission.js';
import {validatePasswordMaintenanceReadiness} from './password-maintenance.js';
const RECOVERY='/var/lib/blackspire-operator/storage-outage-recovery-20260927';
const AUTHORITY='/var/lib/blackspire-operator/postmerge-authority/b71c58ad-0ba1-4fb0-9707-bfde8859a7e8.json';
const ROOT='/etc/blackspire/release-admission';
const UNITS=['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-store.service','blackspire-buyer-writer-gateway.service'];
const fail=()=>{throw Error('Feature release predecessor verification rejected');};
const bytesHash=b=>createHash('sha256').update(b).digest('hex');
const run=(args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:65536});
function bytes(file,{uid=0,gid,mode}={}) {
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try {
  const a=fs.fstatSync(fd);
  if(!a.isFile()||a.uid!==uid||a.nlink!==1||(a.mode&0o022)!==0||a.size>1048576||gid!==undefined&&a.gid!==gid||mode!==undefined&&(a.mode&0o7777)!==mode)fail();
  const b=fs.readFileSync(fd),z=fs.fstatSync(fd);
  if(['dev','ino','mode','uid','gid','nlink','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]))fail();
  return b;
 } finally {fs.closeSync(fd);}
}
const rootJson=(file,maxBytes=65536)=>readRootOwnedJson(file,{groupId:0,maxBytes});
export function validateFeaturePredecessor({plan,result,state,retainedState,configurationDigest,environmentDigest,writer,bindingDigest,commitDigest}) {
 if(result?.version!==1||result.status!=='OUTAGE_RECOVERED'||hash(plan)!==result.planDigest
  ||hash(state)!==result.stateDigest||hash(retainedState)!==hash(state)||state.mode!=='open'
  ||state.releaseSha!==plan.releaseSha||state.releaseSha!==result.releaseSha||state.runId!==plan.runId
  ||configurationDigest!==plan.configurationDigest||environmentDigest!==plan.environmentDigest
  ||writer?.bindingDigest!==bindingDigest||writer?.commitDigest!==commitDigest)fail();
 return true;
}
export function validateFeatureAuthoritySnapshot(bundle,{releaseSha,artifactDigest,runId,readDigest}) {
 if(bundle?.schema!==1||bundle.binding?.newMainSha!==releaseSha||bundle.binding?.artifactDigest!==artifactDigest||bundle.binding?.epochRunId!==runId
  ||!Array.isArray(bundle.files)||bundle.files.length!==6||!Array.isArray(bundle.dependencies)||bundle.dependencies.length<4
  ||bundle.files.map(f=>f.name).sort().join(',')!=='client,dropin,gateway,manifest,signer,unit')fail();
 for(const row of bundle.dependencies)if(readDigest(row)!==row.digest)fail();
 for(const row of bundle.files)if(readDigest(row)!==bytesHash(Buffer.from(row.newBytes,'base64')))fail();
 return true;
}

export function validateFeatureRollbackPredecessor(v, rollback) {
 const {plan,result,state,retainedState,configurationDigest,environmentDigest,bindingDigest,commitDigest}=v;
 const {plan:p,result:r,writer,events}=rollback;
 if(result?.version!==1||result.status!=='OUTAGE_RECOVERED'||hash(plan)!==result.planDigest
  ||hash(retainedState)!==result.stateDigest||p?.version!==1||p.previousRecoveryResultDigest!==hash(result)
  ||hash(p.oldState)!==hash(retainedState)||p.previousSha!==plan.releaseSha||p.previousRunId!==plan.runId
  ||p.candidateSha!=='c9d6b01099b69ff1c6a1a5693650f363540c8090'
  ||r?.version!==1||r.status!=='FEATURE_RELEASE_ROLLED_BACK'||r.planDigest!==hash(p)
  ||r.stateDigest!==hash(state)||r.releaseSha!==plan.releaseSha||state.mode!=='open'
  ||state.releaseSha!==plan.releaseSha||state.runId!==plan.runId
  ||state.apiGeneration===retainedState.apiGeneration||state.workerGeneration===retainedState.workerGeneration
  ||configurationDigest!==plan.configurationDigest||environmentDigest!==plan.environmentDigest
  ||writer?.bindingDigest!==bindingDigest||writer?.commitDigest!==commitDigest)fail();
 const release=(step,phase)=>({schema:1,type:'feature_release',operationId:p.operationId,step,phase});
 const expected=['hold','stop','prepare','install','switchRelease'].flatMap(step=>[release(step,'intent'),release(step,'complete')]);
 expected.push(release('start','intent'));
 for(const step of ['retire_commit','retire_binding','publish'])for(const phase of ['intent','complete'])
  expected.push({schema:1,type:'feature_writer',attemptId:p.rollbackAttemptId,step,phase});
 expected.push(release('rollback','complete'));
 if(hash(events)!==hash(expected))fail();
 return true;
}
function rollbackReceipt() {
 const dir='/var/lib/blackspire-operator/telegram-feature-release-20260927';
 const p=rootJson(dir+'/plan.json'),result=rootJson(dir+'/rollback-result.json');
 if(fs.existsSync(dir+'/result.json')||fs.existsSync(dir+'/commander.lock')||!/^[-a-f0-9]{36}$/.test(p.rollbackAttemptId))fail();
 const content=bytes(dir+'/release.jsonl',{mode:0o600}).toString();
 if(!content.endsWith('\n'))fail();
 let previous='0'.repeat(64);
 const events=content.trimEnd().split('\n').map((line,sequence)=>{
  const row=JSON.parse(line);
  if(Object.keys(row).sort().join(',')!=='digest,event,previous,sequence'||row.sequence!==sequence
   ||row.previous!==previous||row.digest!==hash({sequence,previous,event:row.event}))fail();
  previous=row.digest;return row.event;
 });
 return {plan:p,result,events,writer:rootJson(dir+'/writer-result-'+p.rollbackAttemptId+'.json')};
}

export async function checkFeatureRelease(candidateSha, {afterRollback=false}={}) {
 if(process.getuid()!==0||process.version!=='v22.23.1'||!/^[a-f0-9]{40}$/.test(candidateSha??''))fail();
 const plan=rootJson(RECOVERY+'/plan.json'),result=rootJson(RECOVERY+'/result.json'),writer=rootJson(RECOVERY+'/writer-result.json');
 const stateFile=ROOT+'/state.json',state=validateReleaseAdmissionState(readRootOwnedJson(stateFile,{groupId:fs.lstatSync(stateFile).gid,maxBytes:4096}));
 const config=()=>hash([bytes('/etc/blackspire/command.env').toString(),bytes(ROOT+'/runtime.env').toString(),...UNITS.map(u=>run(['cat',u])),bytes('/etc/blackspire-buyer-store/runtime.json').toString()]);
 const envDigest=()=>hash(bytes('/etc/blackspire/command-api.env').toString());
 const bindingFile='/etc/blackspire/buyer-writer-binding.json',gid=fs.lstatSync(bindingFile).gid;
 const binding=readRootOwnedJsonDigestSnapshot(bindingFile,{groupId:gid,maxBytes:4096}),commit=readRootOwnedJsonDigestSnapshot(bindingFile+'.commit.json',{groupId:gid,maxBytes:4096});
 const predecessor={plan,result,state,retainedState:rootJson(RECOVERY+'/new-state.json'),configurationDigest:config(),environmentDigest:envDigest(),writer,bindingDigest:binding.digest,commitDigest:commit.digest};
 const rollback=afterRollback?rollbackReceipt():null;
 if(rollback)validateFeatureRollbackPredecessor(predecessor,rollback);else validateFeaturePredecessor(predecessor);
 if(candidateSha===state.releaseSha||fs.realpathSync('/opt/blackspire-command/current')!=='/opt/blackspire-command/releases/'+state.releaseSha
  ||fs.existsSync(ROOT+'/pending.json')||UNITS.some(u=>run(['show',u,'-p','ActiveState','--value']).trim()!=='active'))fail();
 const current=await inspectBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+state.releaseSha,releaseSha:state.releaseSha,environment:'production'});
 if(current.artifactDigest!==plan.artifactDigest)fail();
 const authority=rootJson(AUTHORITY,65536);
 validateFeatureAuthoritySnapshot(authority,{releaseSha:state.releaseSha,artifactDigest:current.artifactDigest,runId:state.runId,readDigest:row=>bytesHash(bytes(row.filename,row))});
 const next=await inspectSealedBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+candidateSha,releaseSha:candidateSha,environment:'production'});
 if(next.status!=='SEALED_ARTIFACT_VERIFIED'||next.deployed!==false||next.productionAccepted!==false)fail();
 const pair=rootJson('/var/lib/blackspire-operator/zola-telegram/paired.json');
 if(pair.version!==1||pair.status!=='STAGED_NOT_ACTIVE'||pair.username!=='BlackspireZolaBot'||!Number.isSafeInteger(pair.privateChatId)||pair.privateChatId<=0||pair.privateChatId!==pair.allowedUserId||typeof pair.token!=='string'||!pair.token||typeof pair.webhookSecret!=='string'||pair.webhookSecret.length<32)fail();
 const r=await fetch('http://127.0.0.1:8789/ready',{redirect:'error',signal:AbortSignal.timeout(5000)}),j=await r.json();
 validatePasswordMaintenanceReadiness(r.status,j,{open:true,releaseSha:state.releaseSha});
 if(config()!==plan.configurationDigest||envDigest()!==plan.environmentDigest||hash(readRootOwnedJson(stateFile,{groupId:fs.lstatSync(stateFile).gid,maxBytes:4096}))!==hash(state))fail();
 return {version:1,status:'FEATURE_PREDECESSOR_VERIFIED',previousSha:state.releaseSha,candidateSha,artifactDigest:next.artifactDigest,previousArtifactDigest:current.artifactDigest,recoveryResultDigest:hash(result),rollbackResultDigest:rollback?hash(rollback.result):null,stateDigest:hash(state),authorityReceiptDigest:hash(authority),paired:true,productionChanged:false,telegramActivated:false};
}
