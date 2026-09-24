
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {MIXED_RETIREMENT as P,validateMixedRetirementPrefix,validateMixedRetirementEvent} from './mixed-retirement-history.js';
import {MIXED_RETIREMENT_ROOT,verifyMixedRetirementQuiescence} from './mixed-retirement-host.js';
import {MIXED_ARCHIVE_ROOT,MIXED_ARCHIVE_FILES,createMixedAuthorityArchivePlan,validateMixedAuthorityArchivePlan,createMixedAuthorityArchiveFiles} from './mixed-authority-archive.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {recoveryDigest} from './admitted-read-recovery.js';
const fail=()=>{throw Error('MIXED_AUTHORITY_ARCHIVE_HOST_REFUSED');};
const files=createBuyerStoreProtectedFiles(),root=MIXED_RETIREMENT_ROOT+'/authority-records';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createMixedAuthorityArchiveStore(){
 if(process.getuid?.()!==0)fail();files.directory(root,{create:true});
 const file=n=>{if(!['plan','snapshot','result',...Object.keys(MIXED_ARCHIVE_FILES).flatMap(k=>[k+'-intent',k+'-result'])].includes(n))fail();return root+'/'+n+'.json';};
 return {read:n=>files.value(file(n),true),retain:(n,v)=>files.record(file(n),v)};
}
export async function prepareMixedAuthorityArchive({host,store}){
 let lease;try{
 lease=await host.lease();const before=await host.observeRunning(),snapshot=await host.captureProtectedState();
 if(hash(snapshot)!==before.protectedStateDigest)fail();
 const plan=createMixedAuthorityArchivePlan(snapshot,before),old=store.read('plan'),retained=store.read('snapshot');
 if(old&&!same(old,plan)||retained&&!same(retained,snapshot))fail();
 const archiver=createMixedAuthorityArchiveFiles();archiver.prepare(plan);
 lease.assertIdentity();if(hash(await host.captureProtectedState())!==plan.protectedStateDigest)fail();
 if(!retained)store.retain('snapshot',snapshot);if(!old)store.retain('plan',plan);
 return {status:'MIXED_AUTHORITY_ARCHIVE_PREPARED',planDigest:hash(plan),protectedStateDigest:plan.protectedStateDigest};
 }finally{lease?.close();}
}
export function createNativeMixedAuthorityArchiveHost({journal,lease,store}){
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1')fail();
 const plan=validateMixedAuthorityArchivePlan(store.read('plan')),snapshot=store.read('snapshot');
 if(hash(snapshot)!==plan.protectedStateDigest)fail();
 return {async fence(){
  lease.assertIdentity();verifyMixedRetirementQuiescence();
  const events=journal.stream('release').events();if(events.length!==P.eventCount+1)fail();
  validateMixedRetirementPrefix(events.slice(0,P.eventCount));
  const retired=events[P.eventCount];validateMixedRetirementEvent(retired);
  if(retired.proof.protectedStateDigest!==plan.protectedStateDigest||!same(files.value(MIXED_RETIREMENT_ROOT+'/retirement.json'),retired))fail();
  for(const [filename,f]of Object.entries(snapshot.files)){
   const name=Object.keys(MIXED_ARCHIVE_FILES).find(k=>MIXED_ARCHIVE_FILES[k]===filename);
   const archived=name&&fs.existsSync(MIXED_ARCHIVE_ROOT+'/'+name),target=archived?MIXED_ARCHIVE_ROOT+'/'+name:filename;
   if(archived&&fs.existsSync(filename))fail();
   const st=fs.lstatSync(target),b=files.read(target,{gid:f.identity.gid,mode:f.identity.mode&0o7777});
   const keys=Object.keys(f.identity).filter(k=>!(archived&&k==='ctimeMs'));
   if(keys.some(k=>st[k]!==f.identity[k])||recoveryDigest(b)!==f.digest)fail();
  }
  for(const [unit,expected]of Object.entries(snapshot.unitConfig)){
   const text=execFileSync('/usr/bin/systemctl',['show','--property=FragmentPath,DropInPaths,NeedDaemonReload','--',unit],{encoding:'utf8',timeout:5000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
   if(!same(Object.fromEntries(text.trim().split('\n').map(x=>x.split('='))),expected))fail();
  }
  if(fs.realpathSync('/opt/blackspire-command/current')!=='/opt/blackspire-command/releases/'+P.releaseSha)fail();
  for(const n of ['premerge-reads-active.json','acceptance-active.json'])if(fs.existsSync('/etc/blackspire/release-admission/'+n))fail();
  const R='/var/lib/blackspire-operator/preparation/credential-recovery-20260924';
  for(const [filename,digest]of [[R+'/acceptance/release.jsonl',P.acceptanceDigest],[R+'/collector/'+P.runId+'.jsonl',P.collectorDigest]]){
   if(recoveryDigest(files.read(filename))!==digest)fail();
  }
  lease.assertIdentity();verifyMixedRetirementQuiescence();return retired;
 }};
}
