// HELD-only lifecycle transaction. No production start adapter or OPEN publisher
// is exported. The injected start seam is for disposable rehearsal until all
// enclosing release gates and external systemd lifecycle serialization exist.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {RELEASE_ADMISSION_ROOT,acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {captureBuyerWriterServiceProcesses} from '../buyer-writer/process-collector.js';
import {resolveBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {inspectAdmissionHoldHistory,verifyAdmissionServicesStopped} from './admission-hold.js';
import {inspectReleaseMigrationHistory} from './commander-migration.js';
import {hash} from './commander-journal.js';

const fail=()=>{const e=new Error('Held lifecycle rejected; retain intent and reconcile without retry');e.code='HELD_LIFECYCLE_REJECTED';throw e;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=(v,k)=>v&&Object.keys(v).sort().join(',')===k.split(',').sort().join(',');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const generation=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const options={encoding:'utf8',timeout:2000,maxBuffer:8192,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}};

export function validateHeldLifecycleProof(proof,{releaseSha,runId}){
  if(!keys(proof,'releaseSha,runId,artifactDigest,api,worker')||proof.releaseSha!==releaseSha||proof.runId!==runId||!sha(releaseSha)
    ||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(runId??'')||!(/^[a-f0-9]{64}$/).test(proof.artifactDigest??''))fail();
  for(const role of ['api','worker']){
    const p=proof[role];
    if(!keys(p,'role,generation,pid,startTime')||p.role!==role||!generation(p.generation)||!Number.isSafeInteger(p.pid)||p.pid<1
      ||!(/^[1-9][0-9]{0,19}$/).test(p.startTime??''))fail();
  }
  if(proof.api.generation===proof.worker.generation||proof.api.pid===proof.worker.pid)fail();
  return structuredClone(proof);
}

// Fixed read-only native observer. Environment bytes remain local and only
// selected exact bindings are compared; no environment or command output leaks.
export async function observeHeldLifecycle({releaseSha,runId},{run=spawnSync,capture=captureBuyerWriterServiceProcesses,
  identity=resolveBuyerWriterIdentity,artifact=inspectBuyerWriterArtifact,uid=process.getuid(),readEnvironment=pid=>{
    const fd=fs.openSync(`/proc/${pid}/environ`,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{const b=Buffer.alloc(65537);let n=0;while(n<b.length){const c=fs.readSync(fd,b,n,b.length-n,null);if(!c)break;n+=c;}if(n>65536)fail();return b.subarray(0,n).toString('utf8');}finally{fs.closeSync(fd);}
  }}={}){
  try{
    if(uid!==0||!sha(releaseSha)||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(runId??''))fail();
    const artifactRoot='/opt/blackspire-command/releases/'+releaseSha;
    const scan=()=>{
      const result={};
      for(const role of ['api','worker']){
        const unit=role==='api'?'blackspire-command.service':'blackspire-command-worker.service';
        const r=run('/usr/bin/systemctl',['show','--no-pager','--property=Id,ActiveState,SubState,MainPID,InvocationID,User,ControlGroup','--',unit],options);
        if(r.status!==0||r.error||r.stderr!==''||typeof r.stdout!=='string')fail();
        const pairs=r.stdout.trim().split('\n').map(s=>s.split('='));
        if(pairs.length!==7||pairs.some(p=>p.length!==2)||new Set(pairs.map(p=>p[0])).size!==7)fail();
        const v=Object.fromEntries(pairs);
        if(!keys(v,'Id,ActiveState,SubState,MainPID,InvocationID,User,ControlGroup')||v.Id!==unit||v.ActiveState!=='active'||v.SubState!=='running'
          ||v.User!=='blackspire-'+role||v.ControlGroup!=='/system.slice/'+unit||!generation(v.InvocationID)||!(/^[1-9][0-9]{0,9}$/).test(v.MainPID))fail();
        const processes=capture({mainPid:Number(v.MainPID),role,artifactRoot,controlGroup:v.ControlGroup});
        for(const p of [processes.supervisor,processes.child]){
          const entries=readEnvironment(p.pid).split('\0').filter(Boolean),env={};
          for(const entry of entries){const at=entry.indexOf('=');if(at<1)fail();const key=entry.slice(0,at);if(Object.hasOwn(env,key))fail();env[key]=entry.slice(at+1);}
          if(env.NODE_ENV!=='production'||env.BLACKSPIRE_RUNTIME_MODE!=='production'||env.BLACKSPIRE_STATE_OWNER!=='vps-production'
            ||env.UNIFIED_IPHONE_TEST_MODE!=='false'||env.BLACKSPIRE_DB_PATH!=='/opt/blackspire-command/shared/database/command.sqlite'
            ||env.BLACKSPIRE_RUNTIME_USER!=='blackspire-'+role||env.BLACKSPIRE_RELEASE_RUN_ID!==runId||env.INVOCATION_ID!==v.InvocationID)fail();
          if(p.uid===0||![p.euid,p.suid,p.fsuid].every(id=>id===p.uid)||!p.noNewPrivileges||!['capEffective','capPermitted','capAmbient','capInheritable'].every(k=>/^0+$/.test(p[k]??'')))fail();
        }
        result[role]={unit:v,processes};
      }
      return result;
    };
    const before=scan(),ids=await identity(before.api.processes.child);
    for(const role of ['api','worker'])for(const p of [before[role].processes.supervisor,before[role].processes.child]){
      if(p.uid!==(role==='api'?ids.uid:ids.workerUid)||!Number.isInteger(p.gid)||p.gid<1||p.gid>4294967294
        ||![p.egid,p.sgid,p.fsgid].every(id=>id===p.gid)||!Array.isArray(p.groups)||p.groups.length>64
        ||p.groups.some(id=>!Number.isInteger(id)||id<1||id>4294967294)
        ||(role==='api')!==new Set([...p.groups,p.gid]).has(ids.credentialGroupId))fail();
    }
    const verified=await artifact({artifactRoot,releaseSha,environment:'production'});
    if(verified.releaseSha!==releaseSha||verified.environment!=='production'||!same(before,scan()))fail();
    return validateHeldLifecycleProof({releaseSha,runId,artifactDigest:verified.artifactDigest,...Object.fromEntries(['api','worker'].map(role=>[role,{
      role,generation:before[role].unit.InvocationID,pid:before[role].processes.child.pid,startTime:before[role].processes.child.startTime}]))},{releaseSha,runId});
  }catch{fail();}
}

export function inspectHeldLifecycleHistory(events){
  let pending=null;const completed=new Set();
  for(const row of events){
    if(!['release_lifecycle_intent','release_lifecycle_result'].includes(row?.type))continue;
    if(!keys(row,'schema,type,releaseSha,runId,stateDigest'+(row.type==='release_lifecycle_result'?',proof':''))||row.schema!==1||!sha(row.releaseSha)
      ||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(row.runId??'')||!(/^[a-f0-9]{64}$/).test(row.stateDigest??''))fail();
    if(row.type==='release_lifecycle_intent'){
      if(pending||completed.has(row.runId))fail();pending=row;
    }else{
      const {proof,...record}=row;
      if(!pending||!same({...pending,type:'release_lifecycle_result'},record))fail();
      validateHeldLifecycleProof(proof,row);completed.add(row.runId);pending=null;
    }
  }
  return pending;
}

// Migration authority is not implied by a syntactically valid or merely
// non-pending journal. It requires one exact completed HOLD/lifecycle pair for
// the release being applied. Multiple lifecycle epochs in the same operation
// journal are ambiguous and therefore cannot authorize SQL.
export function inspectCompletedHeldLifecycle(events,releaseSha){
  try{
    if(!sha(releaseSha)||inspectHeldLifecycleHistory(events)||inspectAdmissionHoldHistory(events))fail();
    const lifecycle=events.filter(row=>row?.type==='release_lifecycle_result');
    const holds=events.filter(row=>row?.type==='release_hold_result');
    if(lifecycle.length!==1||holds.length!==1)fail();
    const result=lifecycle[0],held=holds[0];
    if(result.releaseSha!==releaseSha||held.releaseSha!==releaseSha||result.runId!==held.runId||result.stateDigest!==held.stateDigest)fail();
    const order=['release_hold_intent','release_hold_result','release_lifecycle_intent','release_lifecycle_result'].map(type=>events.findIndex(row=>row?.type===type));
    if(order.some(index=>index<0)||order.some((index,position)=>position>0&&index<=order[position-1]))fail();
    return Object.freeze({releaseSha,result:structuredClone(result),hold:structuredClone(held)});
  }catch{fail();}
}

// Hold the same stable admission inode exclusively across the complete
// migration transaction. Retained journal bytes are evidence, but current
// authority is re-established from the HELD marker and two live process/
// artifact observations before SQL, and can be rechecked after COMMIT.
export async function acquireHeldMigrationAuthority({releaseSha,journal},{
  root=RELEASE_ADMISSION_ROOT,owner=0,io=fs,acquire=acquireReleaseAdmissionLock,
  observe=observeHeldLifecycle,
}={}){
  let lease;
  try{
    if(process.getuid()!==owner||!sha(releaseSha)||!journal?.stream)fail();
    const events=journal.stream('release').events(),completed=inspectCompletedHeldLifecycle(events,releaseSha);
    const stateFile=path.join(root,'state.json'),stateStat=io.lstatSync(stateFile);
    if(!stateStat.isFile()||stateStat.isSymbolicLink()||stateStat.uid!==owner||stateStat.nlink!==1)fail();
    const groupId=stateStat.gid;
    const read=file=>readRootOwnedJson(file,{groupId,maxBytes:2048});
    lease=acquire({root,exclusive:true,owner,groupId});
    const assertCurrent=async()=>{
      lease.assertIdentity();
      const state=validateReleaseAdmissionState(read(stateFile));
      const {type:_holdType,...holdMarker}=completed.hold;
      if(state.mode!=='held'||state.releaseSha!==releaseSha||state.runId!==completed.result.runId||state.apiGeneration!==null||state.workerGeneration!==null
        ||hash(state)!==completed.result.stateDigest||!same(read(path.join(root,'pending.json')),holdMarker))fail();
      const proof=validateHeldLifecycleProof(await observe({releaseSha,runId:state.runId}),completed.result);
      if(!same(proof,completed.result.proof))fail();
      lease.assertIdentity();
      if(!same(state,validateReleaseAdmissionState(read(stateFile))))fail();
      return structuredClone(proof);
    };
    await assertCurrent();
    let closed=false;
    return Object.freeze({assertCurrent,close(){if(!closed){closed=true;lease.close();}}});
  }catch{lease?.close();fail();}
}

// Unknown/failed start never clears durable intent. Reconciliation can confirm
// only observed exact running processes; stopped/partial state cannot retry.
export async function runHeldLifecycle({releaseSha,journal,reconcile=false},{root=RELEASE_ADMISSION_ROOT,groupId,owner=0,
  acquire=acquireReleaseAdmissionLock,readState=file=>readRootOwnedJson(file,{groupId,maxBytes:2048}),
  stopped=verifyAdmissionServicesStopped,observe=observeHeldLifecycle,start=fail}={}){
  let lease;
  try{
    if(process.getuid()!==owner||!sha(releaseSha)||typeof reconcile!=='boolean')fail();
    // Deferred import avoids initialization cycles while reusing the complete
    // commander history grammar, including every retained preflight proof.
    const {inspectReleaseCommander}=await import('./commander.js');
    inspectReleaseCommander(journal);
    const stream=journal.stream('release'),events=stream.events();
    if(events.some(e=>e?.schema===3&&(String(e.type).startsWith('sequence_')||String(e.type).startsWith('release_postmerge_')||String(e.type).startsWith('release_open_')||String(e.type).startsWith('vps_'))?false:!['preflight_started','preflight_passed','preflight_stopped','release_hold_intent','release_hold_result',
      'release_migration_intent','release_migration_result','release_migration_recovery_intent','release_migration_recovery_result','release_lifecycle_intent','release_lifecycle_result'].includes(e?.type)))fail();
    if(inspectAdmissionHoldHistory(events)||inspectReleaseMigrationHistory(events))fail();
    const pending=inspectHeldLifecycleHistory(events);
    if(pending&&!reconcile||!pending&&reconcile)fail();
    lease=acquire({root,exclusive:true,owner,groupId});
    const state=validateReleaseAdmissionState(readState(path.join(root,'state.json')));
    const record={schema:1,releaseSha,runId:state.runId,stateDigest:hash(state)};
    const check=()=>{
      lease.assertIdentity();
      if(state.mode!=='held'||state.releaseSha!==releaseSha||state.apiGeneration!==null||state.workerGeneration!==null
        ||!same(state,validateReleaseAdmissionState(readState(path.join(root,'state.json'))))
        ||!same(readState(path.join(root,'pending.json')),record))fail();
      const held=events.filter(e=>e.type==='release_hold_result').at(-1);
      if(!same(held,{...record,type:'release_hold_result'}))fail();
    };
    check();
    const prior=events.filter(e=>e.type==='release_lifecycle_result'&&e.runId===state.runId).at(-1);
    if(pending&&!same(pending,{...record,type:'release_lifecycle_intent'}))fail();
    if(!reconcile&&!prior){
      // Absent native guarded-start adapter refuses BEFORE recording intent.
      if(start===fail)fail();
      stopped();check();stream.append({...record,type:'release_lifecycle_intent'});
      await start({releaseSha,runId:state.runId});
    }
    const proof=validateHeldLifecycleProof(await observe({releaseSha,runId:state.runId}),record);
    check();
    if(prior&&!same(prior.proof,proof))fail();
    if(!same(proof,validateHeldLifecycleProof(await observe({releaseSha,runId:state.runId}),record)))fail();
    check();
    if(!prior)stream.append({...record,type:'release_lifecycle_result',proof});
    return{status:'HELD_LIFECYCLE_OBSERVED',releaseSha,runId:state.runId,proof,intakeOpen:false,productionAccepted:false,lifecycleSerializationComplete:false};
  }catch{fail();}finally{lease?.close();}
}
