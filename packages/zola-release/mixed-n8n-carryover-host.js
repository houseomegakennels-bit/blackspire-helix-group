
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {MIXED_RETIREMENT as P} from './mixed-retirement-history.js';
import {prepareN8nTransition,executeN8nTransition,createN8nTransport,WORKFLOW_ID} from './commander-n8n.js';
import {readReleaseProtectedBytes} from './commander-host.js';
import {readRootOwnedJsonSnapshot,readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {createMixedN8nObservationJournal,createMixedN8nCarryoverOperations} from './mixed-n8n-carryover.js';
import {verifyHeldCanonicalWriter} from './held-writer-binding.js';
import {assertOwnedN8nInstalledIngress} from './owned-n8n-installed-fence.js';
import {lookupBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
const frozen='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260923';
const fail=()=>{throw Error('MIXED_N8N_CARRYOVER_HOST_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const read=file=>readRootOwnedJsonSnapshot(file,{groupId:0,maxBytes:65536});
const checkFrozen=()=>{
 const git=args=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',frozen,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();
 if(fs.realpathSync(frozen)!==frozen||git(['rev-parse','HEAD'])!=='4ea5783d25392c1975fb10fc80880f0ae62ff1b8'||git(['status','--porcelain','--untracked-files=all']))fail();
};
export function createNativeMixedN8nCarryover(context,{inspection=false}={}){
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||context.release?.releaseSha!==P.successorReleaseSha
  ||context.release.operationId!==P.successorOperationId||hash(context.release)!==P.successorInputDigest)fail();
 const release=context.release,config=read(release.packageConfigurationFile),
 backup=readReleaseProtectedBytes(release.n8nBackupFile,2097152),
 plan=prepareN8nTransition({configuration:config.value,backupBytes:backup});
 const key=readReleaseProtectedBytes('/var/lib/blackspire-operator/n8n-api-key',16384).trim();
 const transport=createN8nTransport(key),stream=createMixedN8nObservationJournal({journal:context.journal,plan});
 const stable=()=>{
  checkFrozen();if(!same(config,read(release.packageConfigurationFile))
   ||backup!==readReleaseProtectedBytes(release.n8nBackupFile,2097152)
   ||key!==readReleaseProtectedBytes('/var/lib/blackspire-operator/n8n-api-key',16384).trim())fail();
  stream.events();
 };
 const observe=async()=>{
  stable();
  const {readCompletedOwnedN8nCloudProofAttempt9}=await import(frozen+'/packages/zola-release/owned-n8n-cloud-attempt9-host.js');
  const proof=await readCompletedOwnedN8nCloudProofAttempt9({releaseSha:P.releaseSha,operationId:P.operationId,stageAttemptId:'f163d812-3711-471b-863a-038e85d59137'});
  stable();let count=0;
  const observed=await executeN8nTransition({plan,mode:'inspect',request:async(method,route,body)=>{
   if(method!=='GET'||route!=='/api/v1/workflows/'+WORKFLOW_ID||body!==undefined||count++>=2)fail();
   return transport(method,route);
  },journal:inspection?{events:()=>[],append:()=>{}}:stream});
  if(count!==2||observed.mutationSent!==false||observed.state.kind!=='CANDIDATE'||observed.state.active!==true)fail();
  stable();return {status:'MIXED_N8N_CARRYOVER_VERIFIED',mutationSent:false,workflowActive:true,workflowState:'CANDIDATE',
   workflowDigest:hash(observed.state),priorProofDigest:proof.receiptDigest};
 };
 const verifyInstalled=async()=>{
  stable();
  const old=read('/var/lib/blackspire-operator/preparation/owned-buyer-writer-v4-'+P.releaseSha+'.json');
  const current=read('/var/lib/blackspire-operator/preparation/owned-gateway-provisioning.json'),v=current.value;
  if(v.version!==3||v.authority?.releaseSha!==P.successorReleaseSha||v.authority.operationId!==P.successorOperationId)fail();
  for(const k of ['writerCredential','issuerCredential','gatewayCapability','runtime','issuer','creatorOid','workspace','bindingFile'])
   if(!same(v[k],old.value[k]))fail();
  const ids=await lookupBuyerWriterIdentity();
  const manifest=readRootOwnedJsonDigestSnapshot('/etc/blackspire/zola-installed-'+P.successorReleaseSha+'.json',{groupId:0,maxBytes:16384});
  if(!/^\/etc\/blackspire\/buyer-writer-ingress-[a-f0-9]{64}\.json$/.test(manifest.value.ingressConfig?.path??''))fail();
  const ingress=readRootOwnedJsonDigestSnapshot(manifest.value.ingressConfig.path,{groupId:ids.credentialGroupId,maxBytes:65536});
  assertOwnedN8nInstalledIngress({manifest,ingress,source:v,releaseSha:P.successorReleaseSha,artifactDigest:P.successorArtifactDigest});
  await verifyHeldCanonicalWriter({releaseSha:P.successorReleaseSha,journal:context.journal});
  if(!same(old,read('/var/lib/blackspire-operator/preparation/owned-buyer-writer-v4-'+P.releaseSha+'.json'))
   ||!same(current,read('/var/lib/blackspire-operator/preparation/owned-gateway-provisioning.json')))fail();
  stable();
 };
 return {observe,operations:()=>{if(inspection)fail();return createMixedN8nCarryoverOperations(context,{observe,verifyInstalled});}};
}
