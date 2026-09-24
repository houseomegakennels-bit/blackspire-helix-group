import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {register} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const fail=()=>{throw Error('MIXED_SUCCESSOR_PREPARATION_REFUSED');};
let journal;
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==3||!['--prepare-inputs','--inspect-inputs','--prepare-lineage','--inspect-lineage'].includes(process.argv[2])
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
 const {MIXED_RETIREMENT:P}=await import('../packages/zola-release/mixed-retirement-history.js');
 const preparation=await import('../packages/zola-release/mixed-successor-preparation.js');
 const {openReleaseJournal}=await import('../packages/zola-release/commander-journal.js');
 const {prepareOwnedSuccessorFinalInputs}=await import('../packages/zola-release/owned-successor-final-inputs.js');
 const mode=process.argv[2],inspect=mode!=='--prepare-inputs';
 journal=openReleaseJournal();
 const host=preparation.createMixedSuccessorFinalInputHost({releaseSha:P.successorReleaseSha,journal,inspect});
 const input=await prepareOwnedSuccessorFinalInputs({releaseSha:P.successorReleaseSha,inspect},{host});
 fence();journal.close();journal=null;
 let result=input;
 if(mode.endsWith('lineage')){
  const request={releaseSha:P.successorReleaseSha,operationId:input.operationId,profileDigest:P.profileDigest};
  result=await(mode==='--prepare-lineage'?preparation.prepareMixedSuccessorLineage:preparation.observeMixedSuccessorLineage)(request);
 }
 fence();console.log(JSON.stringify({status:result.status,operatorSha,releaseSha:P.successorReleaseSha,operationId:input.operationId,
  productionInputFile:input.productionInputFile,successorLineageFile:input.successorLineageFile,
  lineageDigest:result.lineageDigest??null,retirementExecuted:false,productionOpen:false}));
}catch(e){
 console.log(JSON.stringify({status:'STOPPED',reason:'MIXED_SUCCESSOR_PREPARATION_REFUSED',productionOpen:false}));
 console.error(String(e.stack).split('\n').slice(1,4).join('\n'));process.exitCode=1;
}finally{journal?.close();}
