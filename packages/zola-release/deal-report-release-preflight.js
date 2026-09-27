import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {hash} from './commander-journal.js';
import {readRootOwnedJson,readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {inspectBuyerWriterArtifact,inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {validateReleaseAdmissionState} from '../shared/release-admission.js';
import {validatePasswordMaintenanceReadiness} from './password-maintenance.js';
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
import {validateFeatureAuthoritySnapshot} from './feature-release-preflight.js';
import {FEATURE_STEPS} from './feature-release.js';
export const DEAL_REPORT_PREDECESSOR='/var/lib/blackspire-operator/zola-os-release-retry-20260927';
export const DEAL_REPORT_PREDECESSOR_SHA='128ea3f775c0de725cbbcbe60b4c2603627b94bd';
export const DEAL_REPORT_AUTHORITY='/var/lib/blackspire-operator/feature-authority/949a58fd-8a2e-44f1-90a2-c59bd9641ade.json';

export function validateDealReportPredecessor({plan,result,state,retainedState,configurationDigest,runtimeDigest,environmentDigest,writer,bindingDigest,commitDigest,events}) {
 if(plan?.version!==1||result?.version!==1||result.status!=='FEATURE_RELEASE_ACTIVE'||hash(plan)!==result.planDigest
  ||plan.candidateSha!==DEAL_REPORT_PREDECESSOR_SHA||result.releaseSha!==plan.candidateSha
  ||hash(state)!==result.stateDigest||hash(retainedState)!==hash(state)||state.mode!=='open'
  ||state.releaseSha!==plan.candidateSha||state.runId!==plan.runId
  ||configurationDigest!==plan.configurationDigest||runtimeDigest!==plan.runtimeDigest||environmentDigest!==plan.apiEnvironmentDigest
  ||writer?.bindingDigest!==bindingDigest||writer?.commitDigest!==commitDigest)fail();
 const expected=[];
 for(const step of FEATURE_STEPS) {
  expected.push({schema:1,type:'feature_release',operationId:plan.operationId,step,phase:'intent'});
  if(step==='writer')for(const item of ['retire_commit','retire_binding','publish'])for(const phase of ['intent','complete'])
    expected.push({schema:1,type:'feature_writer',attemptId:plan.operationId,step:item,phase});
  expected.push({schema:1,type:'feature_release',operationId:plan.operationId,step,phase:'complete'});
 }
 if(hash(events)!==hash(expected))fail();
 return true;
}
function completedEvents() {
 const content=bytes(DEAL_REPORT_PREDECESSOR+'/release.jsonl',{mode:0o600}).toString();
 if(!content.endsWith('\n'))fail();
 let previous='0'.repeat(64);
 return content.trimEnd().split('\n').map((line,sequence)=>{
  const row=JSON.parse(line);
  if(Object.keys(row).sort().join(',')!=='digest,event,previous,sequence'||row.sequence!==sequence||row.previous!==previous
    ||row.digest!==hash({sequence,previous,event:row.event}))fail();
  previous=row.digest;return row.event;
 });
}
export async function checkDealReportRelease(candidateSha) {
 if(process.getuid()!==0||process.version!=='v22.23.1'||!/^[a-f0-9]{40}$/.test(candidateSha??''))fail();
 const plan=rootJson(DEAL_REPORT_PREDECESSOR+'/plan.json'),result=rootJson(DEAL_REPORT_PREDECESSOR+'/result.json');
 if(plan.operationId!=='949a58fd-8a2e-44f1-90a2-c59bd9641ade'||fs.existsSync(DEAL_REPORT_PREDECESSOR+'/rollback-result.json'))fail();
 const stateFile=ROOT+'/state.json',state=validateReleaseAdmissionState(readRootOwnedJson(stateFile,{groupId:fs.lstatSync(stateFile).gid,maxBytes:4096}));
 const config=()=>hash(bytes('/etc/blackspire/command.env').toString()),runtime=()=>hash(bytes(ROOT+'/runtime.env').toString());
 const envDigest=()=>hash(bytes('/etc/blackspire/command-api.env').toString());
 const bindingFile='/etc/blackspire/buyer-writer-binding.json',gid=fs.lstatSync(bindingFile).gid;
 const binding=readRootOwnedJsonDigestSnapshot(bindingFile,{groupId:gid,maxBytes:4096}),commit=readRootOwnedJsonDigestSnapshot(bindingFile+'.commit.json',{groupId:gid,maxBytes:4096});
 validateDealReportPredecessor({plan,result,state,retainedState:rootJson(DEAL_REPORT_PREDECESSOR+'/new-state.json'),
  configurationDigest:config(),runtimeDigest:runtime(),environmentDigest:envDigest(),
  writer:rootJson(DEAL_REPORT_PREDECESSOR+'/writer-result-'+plan.operationId+'.json'),bindingDigest:binding.digest,commitDigest:commit.digest,events:completedEvents()});
 if(candidateSha===state.releaseSha||fs.realpathSync('/opt/blackspire-command/current')!=='/opt/blackspire-command/releases/'+state.releaseSha
  ||fs.existsSync(ROOT+'/pending.json')||UNITS.some(u=>run(['show',u,'-p','ActiveState','--value']).trim()!=='active'))fail();
 const current=await inspectBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+state.releaseSha,releaseSha:state.releaseSha,environment:'production'});
 if(current.artifactDigest!==plan.artifactDigest)fail();
 const authority=rootJson(DEAL_REPORT_AUTHORITY,65536);
 validateFeatureAuthoritySnapshot(authority,{releaseSha:state.releaseSha,artifactDigest:current.artifactDigest,runId:state.runId,readDigest:row=>bytesHash(bytes(row.filename,row))});
 const next=await inspectSealedBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+candidateSha,releaseSha:candidateSha,environment:'production'});
 if(next.status!=='SEALED_ARTIFACT_VERIFIED'||next.deployed!==false||next.productionAccepted!==false)fail();
 const pair=rootJson('/var/lib/blackspire-operator/zola-telegram/paired.json');
 if(pair.version!==1||pair.status!=='ACTIVE'||pair.releaseSha!==state.releaseSha||pair.username!=='BlackspireZolaBot'
  ||!Number.isSafeInteger(pair.privateChatId)||pair.privateChatId<=0||pair.privateChatId!==pair.allowedUserId
  ||typeof pair.token!=='string'||!pair.token||typeof pair.webhookSecret!=='string'||pair.webhookSecret.length<32)fail();
 const r=await fetch('http://127.0.0.1:8789/ready',{redirect:'error',signal:AbortSignal.timeout(5000)}),j=await r.json();
 validatePasswordMaintenanceReadiness(r.status,j,{open:true,releaseSha:state.releaseSha});
 if(config()!==plan.configurationDigest||runtime()!==plan.runtimeDigest||envDigest()!==plan.apiEnvironmentDigest
  ||hash(readRootOwnedJson(stateFile,{groupId:fs.lstatSync(stateFile).gid,maxBytes:4096}))!==hash(state))fail();
 return {version:1,status:'DEAL_REPORT_PREDECESSOR_VERIFIED',previousSha:state.releaseSha,candidateSha,artifactDigest:next.artifactDigest,
 previousArtifactDigest:current.artifactDigest,recoveryResultDigest:hash(result),rollbackResultDigest:null,stateDigest:hash(state),
 authorityReceiptDigest:hash(authority),paired:true,productionChanged:false,telegramActivated:true};
}

