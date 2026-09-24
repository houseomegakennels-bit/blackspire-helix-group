#!/usr/bin/env node
import {register} from 'node:module';
import {fileURLToPath} from 'node:url';
const root='/mnt/blackspire-builds/development-cache/0/workspaces/zola-buyer-admitted-successor-20260924';
let journal,lease;
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==3||process.argv[2]!=='--release'
  ||fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'')!==root||process.cwd()!==root)throw Error('MIXED_OPERATOR_INVOCATION');
 register('file:///mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-collector-successor2-20260923/packages/zola-six-reads/owned-collector-successor-loader.js',import.meta.url);
 register(new URL('../packages/zola-release/owned-sequence-loader.js',import.meta.url),import.meta.url);
 const load=p=>import(root+'/packages/zola-release/'+p);
 const {createMixedOperatorFence,createMixedNativeOperations,MIXED_INPUT_FILE}=await load('mixed-native-operations.js');
 const fence=createMixedOperatorFence(),operatorSha=fence();
 const {MIXED_RETIREMENT:P,validateMixedRetirementEvent}=await load('mixed-retirement-history.js');
 const {openReleaseJournal,hash}=await load('commander-journal.js');
 const {loadProductionReleaseInput}=await load('production-release-input.js');
 const {runProductionRelease}=await load('production-release.js');
 const {createMixedRetirementHost,createMixedRetirementStore,MIXED_RETIREMENT_ROOT}=await load('mixed-retirement-host.js');
 const {retireMixedReadRelease}=await load('mixed-release-retirement.js');
 const {createMixedAuthorityArchiveStore,createNativeMixedAuthorityArchiveHost}=await load('mixed-authority-archive-host.js');
 const {archiveMixedAuthority,createMixedAuthorityArchiveFiles,verifyMixedAuthorityArchive}=await load('mixed-authority-archive.js');
 const {adoptMixedPreview,createNativeMixedPreviewAdoption,MIXED_PREVIEW}=await load('mixed-preview-adoption.js');
 const {createBuyerStoreProtectedFiles}=await import('../packages/buyer-store/protected-files.js');
 const loadedInput=loadProductionReleaseInput(MIXED_INPUT_FILE);
 if(hash(loadedInput.value)!==P.successorInputDigest)throw Error('MIXED_INPUT_CHANGED');
 journal=openReleaseJournal();const host=createMixedRetirementHost(),store=createMixedRetirementStore();
 fence();await retireMixedReadRelease({successorOperationId:P.successorOperationId,journal},{host,store});fence();
 const retired=journal.stream('release').events()[P.eventCount];validateMixedRetirementEvent(retired);
 const archiveStore=createMixedAuthorityArchiveStore(),archiveFiles=createMixedAuthorityArchiveFiles();
 if(journal.stream('release').events().length===P.eventCount+1){
  lease=await host.lease();lease.assertIdentity();
  const archiveHost=createNativeMixedAuthorityArchiveHost({journal,lease,store:archiveStore});
  if(archiveStore.read('result'))verifyMixedAuthorityArchive(archiveStore.read('plan'),{store:archiveStore,files:archiveFiles,retired});
  else await archiveMixedAuthority(archiveStore.read('plan'),{host:archiveHost,store:archiveStore,files:archiveFiles});fence();
  await adoptMixedPreview(createNativeMixedPreviewAdoption({journal,lease}));fence();
  lease.close();lease=null;
 }else{
  verifyMixedAuthorityArchive(archiveStore.read('plan'),{store:archiveStore,files:archiveFiles,retired});
  const files=createBuyerStoreProtectedFiles(),p=MIXED_RETIREMENT_ROOT+'/preview-adoption';
  const plan=files.value(p+'/plan.json'),result=files.value(p+'/result.json');
  if(plan.retirementDigest!==hash(retired)||plan.after!==JSON.stringify(MIXED_PREVIEW)+'\n'
   ||result.status!=='MIXED_PREVIEW_ADOPTED'||result.planDigest!==hash(plan)
   ||result.releaseSha!==P.successorReleaseSha||result.deploymentId!==MIXED_PREVIEW.deploymentId)throw Error('MIXED_PREVIEW_RECEIPT_CHANGED');
 }
 const {prepareMixedBackupRenewal}=await load('mixed-backup-renewal.js');
 await prepareMixedBackupRenewal({release:loadedInput.value,journal,fence});
 const result=await runProductionRelease({loadedInput,journal},{operations:context=>createMixedNativeOperations(context,{fence})});
 fence();console.log(JSON.stringify({operatorSha,...result}));
 if(!['COMPLETE','OBSERVED'].includes(result.status))process.exitCode=1;
}catch(e){
 console.log(JSON.stringify({status:'STOPPED',reason:'MIXED_SUCCESSOR_OPERATOR_REFUSED',releaseReady:false,reconciliationRequired:true}));
 console.error(String(e.stack).split('\n').slice(1,4).join('\n'));process.exitCode=1;
}finally{lease?.close();journal?.close();}
