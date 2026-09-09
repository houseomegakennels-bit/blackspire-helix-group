// Runtime admission leases. Root owns control bytes; services can only read.
// A shared flock remains on the inherited open-file description after the
// helper exits, including across async callbacks. Publication needs exclusive
// ownership of the SAME stable inode; it cannot cross admitted work.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';

export const RELEASE_ADMISSION_ROOT='/etc/blackspire/release-admission';
export const RELEASE_ADMISSION_LOCK='ZOLA_RELEASE_ADMISSION_LOCK_V1\n';
export function releaseAdmissionHeld() {const error=new Error('Release admission held');error.code='RELEASE_ADMISSION_HELD';return error;}
const refuse=()=>{throw releaseAdmissionHeld();};
const same=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
const options={encoding:'utf8',timeout:1000,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}};

export function requireReleaseAdmissionDirectory(root,{io=fs,owner=0,run=spawnSync}={}) {
  if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root||root==='/')refuse();
  for(let current=root;;current=path.dirname(current)){
    const stat=io.lstatSync(current);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==owner||(stat.mode&0o022))refuse();
    const acl=run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',current],options);
    if(acl.status!==0||acl.error||acl.stdout!==''||acl.stderr!=='')refuse();
    if(current==='/')break;
  }
}

export function acquireReleaseAdmissionLock({root=RELEASE_ADMISSION_ROOT,exclusive=false,owner=0,groupId=process.getgid(),
  io=fs,run=spawnSync,checkDirectory=requireReleaseAdmissionDirectory}={}) {
  let fd;
  try {
    checkDirectory(root,{io,owner,run});
    const filename=path.join(root,'admission.lock');
    fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const before=io.fstatSync(fd);
    if(!before.isFile()||before.uid!==owner||before.gid!==groupId||before.nlink!==1||(before.mode&0o7777)!==0o640||before.size!==Buffer.byteLength(RELEASE_ADMISSION_LOCK))refuse();
    const acl=run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{...options,stdio:['ignore','pipe','pipe',fd]});
    if(acl.status!==0||acl.error||acl.stdout!==''||acl.stderr!=='')refuse();
    const locked=run('/usr/bin/flock',[exclusive?'--exclusive':'--shared','--nonblock','3'],{...options,stdio:['ignore','pipe','pipe',fd]});
    if(locked.status!==0||locked.error||locked.stdout!==''||locked.stderr!=='')refuse();
    if(io.readFileSync(fd,'utf8')!==RELEASE_ADMISSION_LOCK||!same(before,io.fstatSync(fd))||!same(before,io.lstatSync(filename)))refuse();
    if(!exclusive){
      try{io.lstatSync(path.join(root,'pending.json'));refuse();}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const leaseFd=fd; fd=undefined; let closed=false;
    return Object.freeze({
      assertIdentity(){if(closed||!same(before,io.fstatSync(leaseFd))||!same(before,io.lstatSync(filename)))refuse();},
      close(){if(!closed){closed=true;io.closeSync(leaseFd);}},
    });
  } catch {refuse();} finally {if(fd!==undefined)io.closeSync(fd);}
}

export function releaseAdmissionRequired(env=process.env) {
  return env.NODE_ENV==='production'||env.BLACKSPIRE_RUNTIME_MODE==='production'||env.BLACKSPIRE_STATE_OWNER==='vps-production'||env.BLACKSPIRE_RELEASE_RUN_ID!==undefined;
}

export function validateReleaseAdmissionState(state) {
  if(!state||Object.keys(state).sort().join(',')!=='apiGeneration,mode,releaseSha,runId,version,workerGeneration'||state.version!==1||
    !['held','open'].includes(state.mode)||!(/^[a-f0-9]{40}$/).test(state.releaseSha??'')||
    !(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(state.runId??'')||
    !['apiGeneration','workerGeneration'].every(key=>state[key]===null&&state.mode==='held'||typeof state[key]==='string'&&/^[a-f0-9]{32}$/.test(state[key]))||
    state.apiGeneration!==null&&state.apiGeneration===state.workerGeneration)refuse();
  return structuredClone(state);
}

// Configured context is server-owned, never request or database data. Missing
// role/run/generation/artifact identity cannot downgrade a production process.
export function currentReleaseAdmissionContext(env=process.env) {
  const role={'blackspire-api':'api','blackspire-worker':'worker'}[env.BLACKSPIRE_RUNTIME_USER];
  const releaseSha=fs.readFileSync(path.join(process.cwd(),'COMMIT_SHA'),'utf8').trim();
  if(!role||!(/^[a-f0-9]{40}$/).test(releaseSha)||!(/^[a-f0-9]{32}$/).test(env.INVOCATION_ID??'')||
    !(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(env.BLACKSPIRE_RELEASE_RUN_ID??''))refuse();
  const observed=spawnSync('/usr/bin/systemctl',['show','--no-pager','--property=InvocationID','--value','--','blackspire-command.service','blackspire-command-worker.service'],options);
  const generations=observed.stdout?.trim().split(/\s+/);
  if(observed.status!==0||observed.error||observed.stderr!==''||generations?.length!==2||!generations.every(value=>/^[a-f0-9]{32}$/.test(value)))refuse();
  const [apiGeneration,workerGeneration]=generations;
  if((role==='api'?apiGeneration:workerGeneration)!==env.INVOCATION_ID)refuse();
  return {role,releaseSha,generation:env.INVOCATION_ID,runId:env.BLACKSPIRE_RELEASE_RUN_ID,apiGeneration,workerGeneration};
}

export function createReleaseAdmissionGuard({required=releaseAdmissionRequired,context=currentReleaseAdmissionContext,
  acquire=acquireReleaseAdmissionLock,readState=()=>readRootOwnedJson(path.join(RELEASE_ADMISSION_ROOT,'state.json'),{groupId:process.getgid(),maxBytes:2048})}={}) {
  const take=()=>{
    let lease;
    try {
      lease=acquire(); const binding=structuredClone(context());
      const state=validateReleaseAdmissionState(readState());
      if(state.mode!=='open'||!['api','worker'].includes(binding.role)||state.releaseSha!==binding.releaseSha||state.runId!==binding.runId||
        state[`${binding.role}Generation`]!==binding.generation||state.apiGeneration!==binding.apiGeneration||state.workerGeneration!==binding.workerGeneration)refuse();
      lease.assertIdentity();
      const refreshed=context();
      if(!['role','releaseSha','generation','runId','apiGeneration','workerGeneration'].every(key=>refreshed[key]===binding[key]))refuse();
      return lease;
    }catch{lease?.close();refuse();}
  };
  return Object.freeze({
    run(fn){
      if(!required())return fn();
      const lease=take();
      try {
        const result=fn();
        if(result&&typeof result.then==='function')return Promise.resolve(result).finally(()=>lease.close());
        lease.close(); return result;
      }catch(error){lease.close();throw error;}
    },
    status(){
      if(!required())return {required:false,open:true};
      let lease;try{lease=take();return {required:true,open:true};}catch{return {required:true,open:false};}finally{lease?.close();}
    },
  });
}
const guard=createReleaseAdmissionGuard();
export const withReleaseAdmission=fn=>guard.run(fn);
export const releaseAdmissionStatus=()=>guard.status();
