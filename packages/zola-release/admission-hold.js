import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {RELEASE_ADMISSION_ROOT,RELEASE_ADMISSION_LOCK,acquireReleaseAdmissionLock,requireReleaseAdmissionDirectory,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {hash} from './commander-journal.js';

const fail=()=>{throw new Error('Release admission hold rejected; retain evidence and reconcile');};
const options={encoding:'utf8',timeout:2000,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}};
function syncDirectory(root) {const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function verifyAdmissionServicesStopped() {
  for(const unit of ['blackspire-command.service','blackspire-command-worker.service']){
    const observed=spawnSync('/usr/bin/systemctl',['show','--no-pager','--property=ActiveState','--property=SubState','--property=MainPID','--',unit],options);
    const fields=Object.fromEntries((observed.stdout??'').trim().split('\n').map(line=>line.split('=')));
    if(observed.status!==0||observed.error||observed.stderr!==''||Object.keys(fields).length!==3||fields.ActiveState!=='inactive'||fields.SubState!=='dead'||fields.MainPID!=='0')fail();
  }
}

export function inspectAdmissionHoldHistory(events) {
  let pending=null;
  for(const event of events){
    if(!['release_hold_intent','release_hold_result'].includes(event?.type))continue;
    if(event.schema!==1||!(/^[a-f0-9]{40}$/).test(event.releaseSha??'')||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(event.runId??'')||
      !(/^[a-f0-9]{64}$/).test(event.stateDigest??'')||Object.keys(event).sort().join(',')!=='releaseSha,runId,schema,stateDigest,type')fail();
    if(event.type==='release_hold_intent'){if(pending)fail();pending=event;}
    else {if(!pending||pending.releaseSha!==event.releaseSha||pending.runId!==event.runId||pending.stateDigest!==event.stateDigest)fail();pending=null;}
  }
  return pending;
}

// Deliberately HELD-only. No CLI/library publication path can enable intake.
// OPEN requires a future enclosing, independently verified release transaction.
// Runtime understands its exact generation bindings but preparation cannot mint it.
export function engageReleaseAdmissionHold({releaseSha,journal},{root=RELEASE_ADMISSION_ROOT,groupId,owner=0,
  stopped=verifyAdmissionServicesStopped,checkDirectory=requireReleaseAdmissionDirectory,
  acquire=acquireReleaseAdmissionLock,readState=file=>readRootOwnedJson(file,{groupId,maxBytes:2048}),fault=()=>{}}={}) {
  let lease;
  try {
    if(process.getuid()!==owner||!(/^[a-f0-9]{40}$/).test(releaseSha??'')||!Number.isInteger(groupId)||groupId<0||groupId>4294967294)fail();
    const stream=journal.stream('release');
    if(inspectAdmissionHoldHistory(stream.events()))fail();
    stopped();
    checkDirectory(path.dirname(root));
    try{fs.mkdirSync(root,{mode:0o750});fs.chownSync(root,owner,groupId);syncDirectory(path.dirname(root));}catch(error){if(error.code!=='EEXIST')throw error;}
    checkDirectory(root);
    const lockFile=path.join(root,'admission.lock');
    try{
      const fd=fs.openSync(lockFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o640);
      try{fs.fchownSync(fd,owner,groupId);fs.fchmodSync(fd,0o640);fs.writeFileSync(fd,RELEASE_ADMISSION_LOCK);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      syncDirectory(root);
    }catch(error){if(error.code!=='EEXIST')throw error;}
    lease=acquire({root,exclusive:true,owner,groupId});
    // Exact confirmed reruns observe the retained hold; torn/unjournaled or
    // foreign-head state cannot be overwritten under a new run identity.
    let markerPresent=true;
    try{fs.lstatSync(path.join(root,'pending.json'));}catch(error){if(error.code!=='ENOENT')throw error;markerPresent=false;}
    if(markerPresent){
      const marker=readState(path.join(root,'pending.json')),held=validateReleaseAdmissionState(readState(path.join(root,'state.json')));
      const result=stream.events().filter(event=>event.type==='release_hold_result').at(-1);
      const expected={schema:1,releaseSha,runId:held.runId,stateDigest:hash(held)};
      if(held.mode!=='held'||held.releaseSha!==releaseSha||held.apiGeneration!==null||held.workerGeneration!==null||
        JSON.stringify(marker)!==JSON.stringify(expected)||JSON.stringify(result)!==JSON.stringify({...expected,type:'release_hold_result'}))fail();
      return {status:'RELEASE_ADMISSION_HELD',...expected,alreadyHeld:true,productionAccepted:false,intakeOpen:false};
    }
    const filename=path.join(root,'state.json');
    let present=true;
    try{fs.lstatSync(filename);}catch(error){if(error.code!=='ENOENT')throw error;present=false;}
    if(present)validateReleaseAdmissionState(readState(filename));
    const runId=randomUUID(),state={version:1,mode:'held',releaseSha,runId,apiGeneration:null,workerGeneration:null};
    const record={schema:1,releaseSha,runId,stateDigest:hash(state)};
    const pendingFile=path.join(root,'pending.json');
    const pendingFd=fs.openSync(pendingFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(pendingFd,JSON.stringify(record)+'\n');fs.fsyncSync(pendingFd);}finally{fs.closeSync(pendingFd);}syncDirectory(root);
    stream.append({...record,type:'release_hold_intent'}); fault('intent');
    stopped();lease.assertIdentity();
    const temporary=path.join(root,`.held-${runId}.tmp`);
    const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o640);
    try{fs.fchownSync(fd,owner,groupId);fs.fchmodSync(fd,0o640);fs.writeFileSync(fd,JSON.stringify(state)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(JSON.stringify(validateReleaseAdmissionState(readState(temporary)))!==JSON.stringify(state))fail();
    fault('prepared');lease.assertIdentity();stopped();
    fs.renameSync(temporary,filename);syncDirectory(root);fault('published');
    if(JSON.stringify(validateReleaseAdmissionState(readState(filename)))!==JSON.stringify(state))fail();
    lease.assertIdentity();stream.append({...record,type:'release_hold_result'});fault('confirmed');
    // Keep the pending marker: HELD is deliberately irreversible in this
    // preparation command. A later release transaction must handle it explicitly.
    return {status:'RELEASE_ADMISSION_HELD',releaseSha,runId,stateDigest:record.stateDigest,productionAccepted:false,intakeOpen:false};
  }catch{fail();}finally{lease?.close();}
}

// Unknown publication never retries a write. Only an exact retained HELD file
// can resolve the durable intent, under the same exclusive lock and stop gate.
export function reconcileReleaseAdmissionHold({journal},{root=RELEASE_ADMISSION_ROOT,groupId,owner=0,
  stopped=verifyAdmissionServicesStopped,acquire=acquireReleaseAdmissionLock,
  readState=file=>readRootOwnedJson(file,{groupId,maxBytes:2048})}={}) {
  let lease;
  try{
    if(process.getuid()!==owner)fail();
    const stream=journal.stream('release'),pending=inspectAdmissionHoldHistory(stream.events());
    if(!pending)return {status:'NO_PENDING_RELEASE_HOLD',intakeOpen:false,productionAccepted:false};
    stopped();lease=acquire({root,exclusive:true,owner,groupId});
    const state=validateReleaseAdmissionState(readState(path.join(root,'state.json')));
    if(state.mode!=='held'||state.apiGeneration!==null||state.workerGeneration!==null||hash(state)!==pending.stateDigest||state.releaseSha!==pending.releaseSha||state.runId!==pending.runId)fail();
    lease.assertIdentity();stopped();stream.append({...pending,type:'release_hold_result'});
    return {status:'RELEASE_ADMISSION_HOLD_RECONCILED',releaseSha:state.releaseSha,runId:state.runId,intakeOpen:false,productionAccepted:false};
  }catch{fail();}finally{lease?.close();}
}
