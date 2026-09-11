// Runtime admission leases. Root owns control bytes; services can only read.
// A shared flock remains on the inherited open-file description after the
// helper exits, including across async callbacks. Publication needs exclusive
// ownership of the SAME stable inode; it cannot cross admitted work.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,timingSafeEqual} from 'node:crypto';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';

export const RELEASE_ADMISSION_ROOT='/etc/blackspire/release-admission';
export const RELEASE_ADMISSION_LOCK='ZOLA_RELEASE_ADMISSION_LOCK_V1\n';
export const HELD_ACCEPTANCE_ACTIVE_FILE='acceptance-active.json';
const heldAcceptanceStorage=new AsyncLocalStorage();
const HELD_OPERATIONS=Object.freeze(['api_health','worker_readiness','generation_fence','six_live_reads','production_smoke','zero_paid_nexus','zero_unintended_mutation','rollback_verification']);
const HELD_CAPABILITIES=Object.freeze(['seller.opportunities.search','buyer.profiles.search','buyer.matches.search','deal.records.search','deal.analysis.get','nexus.enrichment.status']);
const HELD_PERMISSIONS=Object.freeze(['seller.opportunities.read','buyer.profiles.read','buyer.matches.read','deal.records.read','deal.analysis.read','nexus.enrichment.read']);
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

export function acquireReleaseAdmissionLock({root=RELEASE_ADMISSION_ROOT,exclusive=false,allowPending=false,owner=0,groupId=process.getgid(),
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
    if(!exclusive&&!allowPending){
      try{io.lstatSync(path.join(root,'pending.json'));refuse();}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const leaseFd=fd; fd=undefined; let closed=false;
    return Object.freeze({
      assertIdentity(){if(closed||!same(before,io.fstatSync(leaseFd))||!same(before,io.lstatSync(filename)))refuse();},
      close(){if(!closed){closed=true;io.closeSync(leaseFd);}},
    });
  } catch {refuse();} finally {if(fd!==undefined)io.closeSync(fd);}
}

const heldDigest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function validateHeldAcceptanceClaims(value){
  const keys='apiGeneration,commanderRunId,epochRunId,expectedDeploymentSha,expiresAt,issuedAt,kind,mergeMainSha,operations,permitId,principal,reads,schema,tokenDigest,workerGeneration,workspace';
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.split(',').sort().join(',')||value.schema!==1||value.kind!=='held-epoch-acceptance'
    ||value.expectedDeploymentSha!==value.mergeMainSha||!(/^[a-f0-9]{40}$/).test(value.mergeMainSha??'')
    ||![value.commanderRunId,value.epochRunId,value.permitId].every(v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??''))||!(/^[A-Za-z0-9._:-]{1,128}$/).test(value.principal??'')
    ||!(/^[a-z0-9][a-z0-9_-]{1,63}$/).test(value.workspace??'')
    ||![value.apiGeneration,value.workerGeneration].every(v=>/^[a-f0-9]{32}$/.test(v??''))||value.apiGeneration===value.workerGeneration
    ||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=value.issuedAt||value.expiresAt-value.issuedAt>900000
    ||JSON.stringify(value.operations)!==JSON.stringify(HELD_OPERATIONS)||!(/^[a-f0-9]{64}$/).test(value.tokenDigest??'')
    ||!Array.isArray(value.reads)||value.reads.length!==6)return refuse();
  for(const [index,row] of value.reads.entries())if(!row||Object.keys(row).sort().join(',')!=='capability,idempotencyKey,index,permission,request,requestDigest'
    ||row.index!==index||row.capability!==HELD_CAPABILITIES[index]||row.permission!==HELD_PERMISSIONS[index]
    ||row.idempotencyKey!==`zola-six:${value.epochRunId}:${index}`||typeof row.request!=='string'||row.request.length<1||row.request.length>4000
    ||row.requestDigest!==heldDigest({channel:'jarvis',workspaceId:value.workspace,text:row.request,idempotencyKey:row.idempotencyKey,executionIntent:'read_only'}))refuse();
  return structuredClone(value);
}

export function validateHeldAcceptanceActive(value,claims){
  const keys='attemptId,claimsDigest,expiresAt,kind,operation,permitId,schema';
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.split(',').sort().join(',')
    ||value.schema!==1||value.kind!=='held-acceptance-active'||value.operation!=='six_live_reads'
    ||value.permitId!==claims.permitId||value.claimsDigest!==heldDigest(claims)||value.expiresAt!==claims.expiresAt
    ||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(value.attemptId??''))refuse();
  return structuredClone(value);
}

// Narrow post-merge acceptance admission. It never changes the global HELD
// state. The API must prove the opaque permit token; the worker can process
// only the six exact task keys from the protected claims file. A shared lease
// spans the entire async operation and therefore blocks OPEN publication.
export function withHeldAcceptanceAdmission({role,token=null},fn,{root=RELEASE_ADMISSION_ROOT,now=Date.now,
  required=releaseAdmissionRequired,acquire=acquireReleaseAdmissionLock,context=currentReleaseAdmissionContext,read=file=>{
    const stat=fs.lstatSync(file);return readRootOwnedJson(file,{groupId:stat.gid,maxBytes:16384});
  }}={}){
  let lease;
  try{
    if(typeof fn!=='function'||!['api','worker'].includes(role)||!required())refuse();
    const binding=context();if(binding.role!==role)refuse();
    const stateFile=path.join(root,'state.json'),stateStat=fs.lstatSync(stateFile);
    lease=acquire({root,exclusive:false,allowPending:true,owner:0,groupId:stateStat.gid});lease.assertIdentity();
    const state=validateReleaseAdmissionState(read(stateFile)),claims=validateHeldAcceptanceClaims(read(path.join(root,'acceptance.json')));
    const active=validateHeldAcceptanceActive(read(path.join(root,HELD_ACCEPTANCE_ACTIVE_FILE)),claims);
    if(state.mode!=='held'||state.releaseSha!==claims.mergeMainSha||state.runId!==claims.epochRunId
      ||state.apiGeneration!==claims.apiGeneration||state.workerGeneration!==claims.workerGeneration
      ||binding.releaseSha!==claims.mergeMainSha||binding.runId!==claims.epochRunId
      ||binding.apiGeneration!==claims.apiGeneration||binding.workerGeneration!==claims.workerGeneration||now()>=claims.expiresAt||now()>=active.expiresAt)refuse();
    if(role==='api'){
      const supplied=Buffer.from(heldDigest(String(token??'')),'hex'),expected=Buffer.from(claims.tokenDigest,'hex');
      if(typeof token!=='string'||token.length!==43||!timingSafeEqual(supplied,expected))refuse();
    }
    const scoped=Object.freeze({role,permitId:claims.permitId,attemptId:active.attemptId,operation:active.operation,workspace:claims.workspace,principal:claims.principal,
      taskKeys:Object.freeze(claims.reads.map(row=>`unified:jarvis:${row.idempotencyKey}`)),reads:Object.freeze(claims.reads)});
    const result=heldAcceptanceStorage.run(scoped,fn);
    if(result&&typeof result.then==='function')return Promise.resolve(result).finally(()=>lease.close());
    lease.close();return result;
  }catch{lease?.close();refuse();}
}
export const heldAcceptanceContext=()=>heldAcceptanceStorage.getStore()??null;

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
      if(heldAcceptanceStorage.getStore())return fn();
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
