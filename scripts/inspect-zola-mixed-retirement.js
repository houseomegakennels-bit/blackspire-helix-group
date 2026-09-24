import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {register} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const fail=()=>{throw Error('MIXED_RETIREMENT_INSPECTION_REFUSED');};
let lease,journal;
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==3||!['--inspect','--prepare-archive'].includes(process.argv[2])
  ||root!=='/mnt/blackspire-builds/development-cache/0/workspaces/zola-buyer-admitted-successor-20260924')fail();
 const git=args=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],{
  encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();
 const operatorSha=git(['rev-parse','HEAD']);
 const fence=()=>{if(git(['rev-parse','HEAD'])!==operatorSha||git(['status','--porcelain','--untracked-files=all']))fail();
  git(['merge-base','--is-ancestor','4f9e9c11f4fa6ddd5b81a4ed50d1c4362ed83d32','HEAD']);};
 fence();
 register('file:///mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-collector-successor2-20260923/packages/zola-six-reads/owned-collector-successor-loader.js',import.meta.url);
 register('file:///mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260923/packages/zola-release/owned-sequence-loader.js',import.meta.url);
 const {createMixedRetirementHost}=await import('../packages/zola-release/mixed-retirement-host.js');
 const {MIXED_RETIREMENT:P}=await import('../packages/zola-release/mixed-retirement-history.js');
 const host=createMixedRetirementHost();await host.verifySuccessor({successorReleaseSha:P.successorReleaseSha,successorOperationId:P.successorOperationId});
 fence();
 if(process.argv[2]==='--prepare-archive'){
  const {prepareMixedAuthorityArchive,createMixedAuthorityArchiveStore}=await import('../packages/zola-release/mixed-authority-archive-host.js');
  const {openReleaseJournal}=await import('../packages/zola-release/commander-journal.js');
  const {validateMixedRetirementPrefix}=await import('../packages/zola-release/mixed-retirement-history.js');
  journal=openReleaseJournal();validateMixedRetirementPrefix(journal.stream('release').events());
  const result=await prepareMixedAuthorityArchive({host,store:createMixedAuthorityArchiveStore()});
  validateMixedRetirementPrefix(journal.stream('release').events());fence();
  console.log(JSON.stringify({...result,operatorSha,retirementExecuted:false,productionOpen:false}));
 }else{
 lease=await host.lease();const result=await host.observeRunning();fence();lease.assertIdentity();
 console.log(JSON.stringify({status:'MIXED_RETIREMENT_PREFLIGHT_VERIFIED',operatorSha,successorReleaseSha:P.successorReleaseSha,
  ...result,mutationSent:false,retirementExecuted:false,productionOpen:false}));
 }
}catch(e){
 console.log(JSON.stringify({status:'STOPPED',reason:'MIXED_RETIREMENT_INSPECTION_REFUSED',productionOpen:false}));
 console.error(String(e.stack).split('\n').slice(1,4).join('\n'));process.exitCode=1;
}finally{lease?.close();journal?.close();}
