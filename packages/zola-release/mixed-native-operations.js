import {readFixedCollectorEvidence} from './production-zero-proofs.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {repairMixedRejectedWriter} from './mixed-writer-rejection-host.js';
import {wrapMixedLivePreparation} from './mixed-live-preparation.js';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {MIXED_RETIREMENT as P,validateMixedRetirementEvent} from './mixed-retirement-history.js';
import {hash} from './commander-journal.js';
import {createFixedProductionOperations} from './production-adapters.js';
import {bindOwnedProviderInput} from './owned-provider-input.js';
import {queryFixedProviderAcl,createProviderAclCheckOperation} from './production-acl-writer.js';
import {createOwnedAclObserverPool,verifyOwnedOperatorAclResult} from './owned-acl-operator-observer.js';
import {createPgNetIsolationProof} from './pg-net-isolation.js';
import {observeBuyerWriterRuntimeIsolation} from './pg-net-host-observer.js';
import {readOwnedDatabaseProfile,databaseProfileDigest} from '../buyer-writer/database-profile.js';
import {createOwnedRuntimeVpsHost,prepareVpsCutoverPlan,runVpsCutover} from './commander-vps.js';
import {createOwnedRuntimeStoreTransition} from './owned-runtime-store.js';
import {establishCandidateHeld} from './production-held-operations.js';
import {createNativeMixedN8nCarryover} from './mixed-n8n-carryover-host.js';
import {wrapMixedReadAcceptanceOperations} from './mixed-fresh-acceptance.js';
import {verifyReleaseSource} from './commander-host.js';
import {loadProductionReleaseInput} from './production-release-input.js';

export const MIXED_OPERATOR_ROOT='/mnt/blackspire-builds/development-cache/0/workspaces/zola-buyer-admitted-successor-20260924';
export const MIXED_SOURCE_ROOT='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-successor-20260924';
export const MIXED_INPUT_FILE='/var/lib/blackspire-operator/preparation/owned-successor-final-'+P.successorReleaseSha+'/production-release.json';
const fail=()=>{throw Error('MIXED_NATIVE_OPERATIONS_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const git=args=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',MIXED_OPERATOR_ROOT,...args],{
 encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],
 env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();
export function createMixedOperatorFence(){
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1')fail();
 const operatorSha=git(['rev-parse','HEAD']);
 const fence=()=>{
  if(git(['rev-parse','HEAD'])!==operatorSha||git(['status','--porcelain','--untracked-files=all']))fail();
  git(['merge-base','--is-ancestor','8d916822017a522f849b19cdb77e1634972a899f','HEAD']);
  return operatorSha;
 };fence();return fence;
}
export function collectMixedIsolatedCandidate(fence){
 fence();verifyReleaseSource(P.successorReleaseSha);
 const raw=execFileSync('/opt/nodejs/node-v22.23.1-linux-x64/bin/node',['scripts/zola-six-read-collect.js','--candidate'],{
  cwd:MIXED_SOURCE_ROOT,encoding:'utf8',timeout:45000,maxBuffer:1048576,stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 const report=JSON.parse(raw);
 if(report.releaseSha!==P.successorReleaseSha||report.status!=='PASS_ISOLATED_API_COLLECTOR'||report.candidatePass!==true
  ||report.livePass!==false||report.results?.length!==6||report.paidProviderCalls!==0||report.observedFixtureMutationAttempts!==0)fail();
 verifyReleaseSource(P.successorReleaseSha);fence();return report;
}
// Fixed root-only composition. No protected input can select transports,
// arbitrary commands or a replacement adapter.
export function createMixedNativeOperations(context,{fence}){
 if(typeof fence!=='function'||context.release?.schema!==3||hash(context.release)!==P.successorInputDigest
  ||context.release.operationId!==P.successorOperationId||context.input.releaseSha!==P.successorReleaseSha)fail();
 fence();validateMixedRetirementEvent(context.journal.stream('release').events()[P.eventCount]);
 const loaded=loadProductionReleaseInput(MIXED_INPUT_FILE);
 if(!same(loaded.value,context.release))fail();
 const profile=readOwnedDatabaseProfile();
 if(databaseProfileDigest(profile)!==P.profileDigest)fail();
 const stable=()=>{fence();if(!same(loadProductionReleaseInput(MIXED_INPUT_FILE),loaded)
  ||!same(readOwnedDatabaseProfile(),profile))fail();return {input:loaded,operatorSha:fence(),profileDigest:P.profileDigest};};
 const providerQuery=async(sql,values)=>{
  stable();verifyReleaseSource(P.successorReleaseSha);
  const result=await queryFixedProviderAcl('/etc/blackspire-buyer-writer-gateway/gateway.json',sql,values,
   {Pool:createOwnedAclObserverPool(Pool,profile),verifyAcl:verifyOwnedOperatorAclResult});
  stable();verifyReleaseSource(P.successorReleaseSha);return result;
 };
 const isolationProof=createPgNetIsolationProof({query:providerQuery,verifyRuntimeIsolation:()=>observeBuyerWriterRuntimeIsolation({
  releaseSha:P.successorReleaseSha,gatewayConfigurationFile:'/etc/blackspire-buyer-writer-gateway/gateway.json'})});
 const provider=createProviderAclCheckOperation({query:providerQuery,isolationProof,backendProfile:context.release.backendProfile,
  profileDigest:P.profileDigest,verifyAcl:verifyOwnedOperatorAclResult});
 const deployment={
  prepareVps:input=>prepareVpsCutoverPlan(input,{host:createOwnedRuntimeVpsHost()}),
  runVps:(input,options)=>runVpsCutover(input,{...options,host:createOwnedRuntimeVpsHost()})
 };
 const fixed=createFixedProductionOperations(context,{providerQuery,isolationProof,deployment,
  zeroProof:{readCollector:binding=>{stable();return readFixedCollectorEvidence(binding,{
   root:'/var/lib/blackspire-operator/preparation/mixed-successor-acceptance-'+P.successorOperationId+'/live/collector',
   config:readRootOwnedJson('/var/lib/blackspire-operator/preparation/six-read-live-config.json',{groupId:0,maxBytes:16384})});}},
  held:{
  candidate:()=>collectMixedIsolatedCandidate(fence),
  establishHeld:()=>establishCandidateHeld(context,{ownedStore:()=>createOwnedRuntimeStoreTransition()})
 }});
 const writer=fixed.bounded_writer_e2e;
 const operations=wrapMixedLivePreparation(context,wrapMixedReadAcceptanceOperations(context,{...fixed,
  bounded_writer_e2e:{...writer,reconcile:async call=>{await repairMixedRejectedWriter(context,call,{fence});return writer.reconcile(call);}},
  ...createNativeMixedN8nCarryover(context).operations(),
  provider_acl_check:bindOwnedProviderInput({operation:provider,input:context.input,release:context.release,
   protectedInputDigest:loaded.inputDigest,fence:stable})
 }));
 return Object.freeze(Object.fromEntries(Object.entries(operations).map(([stage,operation])=>[stage,Object.freeze(
  Object.fromEntries(Object.entries(operation).map(([method,run])=>[method,async call=>{
   stable();const result=await run(call);stable();return result;
  }]))
 )])));
}
