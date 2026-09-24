import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {register} from 'node:module';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash} from '../packages/zola-release/admitted-read-recovery.js';
import {inspectNativeReadRecoveryPreparation,prepareNativeReadRecovery,snapshotReadRecoveryRuntime,READ_RECOVERY_ROOT as R} from '../packages/zola-release/admitted-read-transition-preparation.js';
import {createBuyerStoreProtectedFiles} from '../packages/buyer-store/protected-files.js';
import {createNativeReadRecoveryHost} from '../packages/zola-release/admitted-read-transition-host.js';
import {runReadRecoveryTransition} from '../packages/zola-release/admitted-read-transition.js';
import {observeSuccessorMain} from '../packages/zola-release/owned-successor-main.js';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const canonical='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921';
const frozen='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260923';
const successor='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-collector-successor2-20260923';
const fail=()=>{throw Error('READ_RECOVERY_OPERATOR_REFUSED');};
const git=(dir,args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',dir,...args],{
 encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'}}).trim();
let phase='preflight';
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==3
 ||!['--check','--prepare','--apply','--continue','--repair-preparation','--repair-writer-archive'].includes(process.argv[2])
 ||root!=='/mnt/blackspire-builds/development-cache/0/workspaces/zola-credential-recovery-20260924')fail();
 const mode=process.argv[2],operatorSha=git(root,['rev-parse','HEAD']);
 const verify=()=>{
  if(fs.realpathSync(root)!==root||git(root,['rev-parse','HEAD'])!==operatorSha||git(root,['status','--porcelain','--untracked-files=all']))fail();
  git(root,['merge-base','--is-ancestor','175bc2c','HEAD']);
  for(const [dir,sha] of [[canonical,P.releaseSha],[frozen,'4ea5783d25392c1975fb10fc80880f0ae62ff1b8'],[successor,'734d9ada0924a981d423111e2088a36f034500db']])
   if(git(dir,['rev-parse','HEAD'])!==sha||git(dir,['status','--porcelain','--untracked-files=all']))fail();
 };
 verify();if(mode!=='--continue')observeSuccessorMain(P.releaseSha);
 register('file://'+successor+'/packages/zola-six-reads/owned-collector-successor-loader.js',import.meta.url);
 register('file://'+frozen+'/packages/zola-release/owned-sequence-loader.js',import.meta.url);
 register(new URL('../packages/zola-release/admitted-read-continuation-loader.js',import.meta.url));
 if(mode==='--continue'){
  phase='native_release';const {readCompletedReadRecovery}=await import('../packages/zola-release/admitted-read-fresh-acceptance.js');
  readCompletedReadRecovery();verify();
  process.argv[2]='--release-cloud-proof-attempt9';
  process.argv[3]='/var/lib/blackspire-operator/preparation/owned-successor-final-'+P.releaseSha+'/production-release.json';
  await import(frozen+'/scripts/zola-release-owned-n8n-operator.js');verify();
 }else if(mode==='--check'){
  const result=await inspectNativeReadRecoveryPreparation();verify();
  console.log(JSON.stringify({...result,operatorSha}));
 }else if(mode==='--prepare'){
  const result=await prepareNativeReadRecovery();verify();console.log(JSON.stringify({...result,operatorSha}));
 }else if(mode==='--repair-preparation'||mode==='--repair-writer-archive'){
  const files=createBuyerStoreProtectedFiles(),plan=files.value(R+'/plan.json'),host=createNativeReadRecoveryHost(plan);
  const lease=await host.acquire();phase='preparation_reconciliation';
  try{verify();await host.fence();const result=await (mode==='--repair-writer-archive'?host.reconcileWriterArchive():host.reconcilePreparation());verify();console.log(JSON.stringify(result));}
  finally{await lease.close();}
 }else{
  const files=createBuyerStoreProtectedFiles(),plan=files.value(R+'/plan.json');
  if(!fs.existsSync(R+'/events/release.jsonl')){
   if(hash(await snapshotReadRecoveryRuntime())!==plan.snapshotDigest)fail();
   await inspectNativeReadRecoveryPreparation();
  }
  const host=createNativeReadRecoveryHost(plan),fence=host.fence,execute=host.execute;
  host.fence=async()=>{verify();await fence();verify();};
  host.execute=async(step,p)=>{phase=step;await execute(step,p);};
  const result=await runReadRecoveryTransition(plan,{host,store:{events:host.events,append:host.append}});
  verify();console.log(JSON.stringify({...result,operatorSha}));
 }
}catch(e){
 console.log(JSON.stringify({status:'STOPPED',phase,reason:'READ_RECOVERY_OPERATOR_REFUSED',productionOpen:false}));
 console.error(e.stack.split('\n').slice(1,4).join('\n'));
 process.exitCode=1;
}
