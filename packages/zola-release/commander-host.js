import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyReleaseCiArtifact} from './commander-ci-artifact.js';
import {collectZolaActivationProfile} from './activation-profile.js';
import {checkBuyerWriterActivationReadiness} from '../buyer-writer/activation-readiness.js';

const refuse=()=>{throw new Error('Zola release host verification rejected');};
// Credential bytes never enter child arguments, environment or diagnostics.
export function readReleaseProtectedBytes(filename,maxBytes){
 let fd;
 try{
  if(!path.isAbsolute(filename)||path.resolve(filename)!==filename||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>2*1024*1024)refuse();
  for(let p=path.dirname(filename);;p=path.dirname(p)){
   const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))refuse();if(p==='/')break;
  }
  fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const before=fs.fstatSync(fd);if(!before.isFile()||before.uid!==0||before.nlink!==1||(before.mode&0o7777)!==0o600||before.size<1||before.size>maxBytes)refuse();
  const acl=spawnSync('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{
   encoding:'utf8',stdio:['ignore','pipe','pipe',fd],timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'},killSignal:'SIGKILL'});
  if(acl.status!==0||acl.error||acl.stdout!==''||acl.stderr!=='')refuse();
  const buffer=Buffer.alloc(maxBytes+1);let used=0;
  while(used<buffer.length){const count=fs.readSync(fd,buffer,used,buffer.length-used,null);if(count===0)break;used+=count;}
  const after=fs.fstatSync(fd);
  if(used!==before.size||used>maxBytes||['dev','ino','uid','gid','mode','nlink','size','ctimeMs','mtimeMs'].some(key=>before[key]!==after[key]))refuse();
  return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used));
 }catch{refuse();}finally{if(fd!==undefined)fs.closeSync(fd);}
}

export function verifyReleaseSource(releaseSha,{root=fileURLToPath(new URL('../../',import.meta.url)),requireRemote=true}={}){
 if(!/^[a-f0-9]{40}$/.test(releaseSha??''))refuse();
 const options={encoding:'utf8',timeout:10000,maxBuffer:256*1024,stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'}};
 const git=args=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],options).trim();
 if(git(['rev-parse','HEAD'])!==releaseSha||git(['branch','--show-current'])!=='release/zola-production-live'
  ||git(['status','--porcelain','--untracked-files=all'])!=='')refuse();
 // Fixed remote URL prevents a modified local origin from supplying false truth.
 if(!requireRemote)return{releaseSha,clean:true};
 const remote=git(['ls-remote','https://github.com/houseomegakennels-bit/blackspire-helix-group.git','refs/heads/release/zola-production-live']);
 if(remote!==`${releaseSha}\trefs/heads/release/zola-production-live`)refuse();
 return{releaseSha,clean:true};
}

export async function verifyCanonicalWriter(releaseSha,configurationFile){
 const before=await collectZolaActivationProfile({releaseSha,configurationFile});
 const proof=await checkBuyerWriterActivationReadiness({...before.profile.context,workerGeneration:before.workerGeneration,requireWriterReady:true});
 const after=await collectZolaActivationProfile({releaseSha,configurationFile});
 if(!proof.verified||JSON.stringify(before)!==JSON.stringify(after))refuse();
 return{releaseSha,apiGeneration:before.profile.context.apiGeneration,workerGeneration:before.workerGeneration,artifactDigest:before.artifactDigest};
}

// Deliberately explicit: a green aggregate does not prove required work ran.
export const REQUIRED_RELEASE_CI_STEPS=Object.freeze([
 'Checkout','Set up Node.js (project-required version)','npm ci','Run database migrations','Run test suite',
 'Verify scoped Buyer writer on disposable PostgreSQL 17.6','Verify native Buyer driver TLS and lock timeout',
 'Verify guarded provider and application migration transactions','Verify dedicated application migration executor and reconciliation',
 'Verify six-read database observer on disposable PostgreSQL 17.6',
 'Run build check','Package immutable release evidence','Run lint check','Run typecheck','Run secret scan',
 'Run npm audit (high severity and above)','Validate tracked shell syntax','Validate whitespace','Run read-only production preflight',
 'Record immutable build metadata','Cross-check packaged release and CI metadata','Upload build metadata',
]);
export function verifyReleaseCi(releaseSha,{run=execFileSync,now=Date.now()}={}){
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||!Number.isFinite(now))refuse();
  const repository='houseomegakennels-bit/blackspire-helix-group',branch='release/zola-production-live';
  const options={encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
   env:{PATH:'/usr/bin:/bin',HOME:'/root',GH_CONFIG_DIR:'/root/.config/gh',GH_PROMPT_DISABLED:'1',LC_ALL:'C'}};
  const api=route=>JSON.parse(run('/usr/bin/gh',['api',`repos/${repository}/${route}`],options));
  const identity=()=>{
   const pr=api('pulls/125'),main=api('git/ref/heads/main');
   if(pr.number!==125||pr.state!=='open'||pr.merged!==false||pr.draft!==false||pr.head?.sha!==releaseSha
    ||pr.head?.ref!==branch||pr.head?.repo?.full_name!==repository||pr.base?.ref!=='main'||pr.base?.repo?.full_name!==repository
    ||main.ref!=='refs/heads/main'||main.object?.type!=='commit'||!(/^[a-f0-9]{40}$/).test(main.object?.sha??''))refuse();
   return main.object.sha;
  };
  const mainSha=identity();
  const latest=()=>{
   const result=api(`actions/workflows/blackspire-ci.yml/runs?head_sha=${releaseSha}&per_page=100`);
   // Refuse truncated/ambiguous histories rather than trusting API array order.
   if(!Array.isArray(result.workflow_runs)||result.workflow_runs.length===0||result.total_count!==result.workflow_runs.length
    ||new Set(result.workflow_runs.map(row=>row.id)).size!==result.workflow_runs.length)refuse();
   for(const row of result.workflow_runs)if(!Number.isSafeInteger(row.id)||row.id<1||row.head_sha!==releaseSha||!Number.isFinite(Date.parse(row.created_at)))refuse();
   const ordered=[...result.workflow_runs].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id);
   return ordered[0];
  };
  const validate=ci=>{
   const age=now-Date.parse(ci.updated_at);
   if(ci.head_sha!==releaseSha||ci.path!=='.github/workflows/blackspire-ci.yml'||ci.event!=='pull_request'
    ||ci.head_branch!==branch||ci.repository?.full_name!==repository||ci.head_repository?.full_name!==repository
    ||ci.status!=='completed'||ci.conclusion!=='success'||!Number.isSafeInteger(ci.id)||ci.id<1
    ||!Number.isSafeInteger(ci.run_attempt)||ci.run_attempt<1
    ||!Array.isArray(ci.pull_requests)||ci.pull_requests.length!==1||ci.pull_requests[0].number!==125
    ||ci.pull_requests[0].head?.sha!==releaseSha
    ||!Number.isFinite(age)||age<0||age>24*60*60*1000)refuse();
   return JSON.stringify([ci.id,ci.run_attempt,ci.updated_at,ci.created_at]);
  };
  const listed=latest(),ci=api(`actions/runs/${listed.id}`),stamp=validate(ci);
  if(validate(listed)!==stamp)refuse();
  const result=api(`actions/runs/${ci.id}/attempts/${ci.run_attempt}/jobs?per_page=100`);
  if(result.total_count!==1||!Array.isArray(result.jobs)||result.jobs.length!==1)refuse();
  const job=result.jobs[0];
  if(job.name!=='Install, migrate, test, build, lint, typecheck, scan, audit'||job.head_sha!==releaseSha
   ||job.run_id!==ci.id||job.run_attempt!==ci.run_attempt||job.status!=='completed'||job.conclusion!=='success'||!Array.isArray(job.steps))refuse();
  for(const name of REQUIRED_RELEASE_CI_STEPS){
   const steps=job.steps.filter(step=>step.name===name);
   if(steps.length!==1||steps[0].status!=='completed'||steps[0].conclusion!=='success')refuse();
  }
  const artifact=verifyReleaseCiArtifact({ci,releaseSha,mainSha,api,run,options});
  // Catch branch movement, reruns and newer pending/failed runs during inspection.
  // This remains a point-in-time gate; callers must recheck immediately before mutation.
  if(identity()!==mainSha||validate(latest())!==stamp||validate(api(`actions/runs/${ci.id}`))!==stamp)refuse();
  return{releaseSha,mainSha,runId:ci.id,runAttempt:ci.run_attempt,...artifact,status:'success'};
 }catch{refuse();}
}
