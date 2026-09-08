import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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

export function verifyReleaseCi(releaseSha,{run=execFileSync,now=Date.now()}={}){
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??''))refuse();
  const repository='houseomegakennels-bit/blackspire-helix-group';
  const options={encoding:'utf8',timeout:15000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
   env:{PATH:'/usr/bin:/bin',HOME:'/root',GH_CONFIG_DIR:'/root/.config/gh',GH_PROMPT_DISABLED:'1',LC_ALL:'C'}};
  const api=route=>JSON.parse(run('/usr/bin/gh',['api',`repos/${repository}/${route}`],options));
  const pr=api('pulls/125');
  if(pr.number!==125||pr.state!=='open'||pr.merged!==false||pr.draft!==false||pr.head?.sha!==releaseSha
   ||pr.head?.ref!=='release/zola-production-live'||pr.head?.repo?.full_name!==repository
   ||pr.base?.ref!=='main'||pr.base?.repo?.full_name!==repository)refuse();
  const result=api(`actions/workflows/blackspire-ci.yml/runs?head_sha=${releaseSha}&per_page=10`);
  if(!Array.isArray(result.workflow_runs)||result.workflow_runs.length===0)refuse();
  const ciRun=result.workflow_runs[0],age=now-Date.parse(ciRun.updated_at);
  if(ciRun.head_sha!==releaseSha||ciRun.path!=='.github/workflows/blackspire-ci.yml'||ciRun.event!=='pull_request'
   ||ciRun.status!=='completed'||ciRun.conclusion!=='success'||!Number.isSafeInteger(ciRun.id)||ciRun.id<1
   ||!Array.isArray(ciRun.pull_requests)||!ciRun.pull_requests.some(link=>link.number===125&&link.head?.sha===pr.head.sha&&link.base?.sha===pr.base.sha)
   ||!(/^[a-f0-9]{40}$/).test(pr.base?.sha??'')
   ||!Number.isFinite(age)||age<0||age>24*60*60*1000)refuse();
  return{releaseSha,runId:ciRun.id,status:'success'};
 }catch{refuse();}
}
