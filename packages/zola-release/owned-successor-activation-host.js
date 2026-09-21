import {hash} from './commander-journal.js';
import {inspectOwnedSuccessorActivationAuthority} from './owned-successor-activation.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {readOwnedDatabaseProfile,databaseProfileDigest} from '../buyer-writer/database-profile.js';
import {inspectBuyerWriterArtifact,inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {verifyReleaseSource} from './commander-host.js';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
import {verifyOwnedBuyerMigrationQuiescence} from '../buyer-writer/owned-migration-host.js';
import {observeOwnedMigrationSuccessor} from '../buyer-writer/owned-migration-successor.js';
const fail=()=>{throw new Error('Owned successor activation host refused');};
const ROOT='/var/lib/blackspire-operator/owned-successor-activation';
const REPOSITORY='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createOwnedSuccessorActivationStore(input){
 const files=createBuyerStoreProtectedFiles(),root=ROOT+'/'+input.operationId+'/'+input.attemptId;files.directory(root,{create:true});
 const file=name=>{if(!['plan','configuration-intent','configuration-plan','configuration-result','gateway-intent','gateway-result','result'].includes(name))fail();return root+'/'+name+'.json';};
 return {read:name=>files.value(file(name),true),retain:(name,value)=>files.record(file(name),value)};
}
export async function createOwnedSuccessorActivationHost(input,journal){
 const verifyRetirement=()=>inspectOwnedSuccessorActivationAuthority(input,journal).retired;
 const verifyLineage=()=>observeOwnedMigrationSuccessor({releaseSha:input.releaseSha,operationId:input.operationId,profileDigest:input.profileDigest});
 const configurationModule=await import('./owned-successor-configuration.js'),configurationHostModule=await import('./owned-successor-configuration-host.js');
 const {createOwnedStoreTransition}=await import('./owned-store-transition.js');
 const configHost=configurationHostModule.createOwnedSuccessorConfigurationHost({verifyRetirement:()=>{const r=verifyRetirement();return {previousReleaseSha:r.releaseSha,releaseSha:r.successorReleaseSha,digest:hash(r)};},verifyLineage});
 const config=configurationModule.createOwnedSuccessorConfiguration({host:configHost,store:createOwnedStoreTransition()});
 const gateway=await import('../buyer-writer/owned-successor-gateway-unit.js');
 const gatewayDeps={verifyRetirement,releaseEvents:()=>journal.stream('release').events(),verifySuccessorHeld:(_,state)=>{verifyRetirement();const events=journal.stream('release').events(),row=events.findLast(e=>e.type==='release_hold_result'&&e.releaseSha===input.releaseSha);
  return Boolean(row&&row.runId===state.runId&&state.mode==='held'&&state.apiGeneration===null&&state.workerGeneration===null&&hash(state)===row.stateDigest);}};
 const metadata=()=>{const s=readRootOwnedJsonSnapshot('/var/lib/blackspire-operator/preparation/receiver-origin.json',{groupId:0,maxBytes:2048}),v=s.value;
  if(s.identity.uid!==0||s.identity.gid!==0||(s.identity.mode&0o7777)!==0o600||Object.keys(v).sort().join(',')!=='deploymentId,frontendOrigin,releaseSha,schema'||v.schema!==1||v.releaseSha!==input.releaseSha)fail();return s;};
 const phaseInput={releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,profileDigest:input.profileDigest,successorLineageFile:input.successorLineageFile};
 const runtime=async()=>{
  const phase=gateway.captureOwnedSuccessorRuntimePhase(phaseInput,gatewayDeps);
  if(phase.requiresStopped)await verifyOwnedBuyerMigrationQuiescence();
  if(!same(phase,gateway.captureOwnedSuccessorRuntimePhase(phaseInput,gatewayDeps)))fail();
  return {mode:phase.sealed?'stopped-sealed':'deployed',phase};
 };
 return {
  async fence(){
   verifyReleaseSource(input.releaseSha,{root:REPOSITORY,requireRemote:true});const retired=verifyRetirement(),profile=readOwnedDatabaseProfile(),preview=metadata(),before=await runtime();
   if(databaseProfileDigest(profile)!==input.profileDigest)fail();const lineage=await verifyLineage();
   if(lineage.lineageDigest!==retired.proof.lineageDigest)fail();
   await observeReceiverDeployment({releaseSha:input.releaseSha,mode:'preview',origin:preview.value.frontendOrigin,deploymentId:preview.value.deploymentId});
   const artifact=await (before.mode==='deployed'?inspectBuyerWriterArtifact:inspectSealedBuyerWriterArtifact)({artifactRoot:'/opt/blackspire-command/releases/'+input.releaseSha,releaseSha:input.releaseSha,environment:'production'});
   if(artifact.releaseSha!==input.releaseSha||(before.phase.artifactDigest!==null&&artifact.artifactDigest!==before.phase.artifactDigest)||!same(before,await runtime())||!same(profile,readOwnedDatabaseProfile())||!same(preview,metadata()))fail();verifyReleaseSource(input.releaseSha,{root:REPOSITORY,requireRemote:true});verifyRetirement();
   return {identity:{retirementDigest:hash(retired),lineageDigest:lineage.lineageDigest,profileDigest:input.profileDigest,previewDigest:hash(preview),frontendOrigin:preview.value.frontendOrigin,artifactDigest:artifact.artifactDigest},runtime:before};
  },
  prepareConfiguration:value=>config.prepare(value),publishConfiguration:plan=>config.publish(plan),
  observeConfiguration:async plan=>{const result=await config.observe(plan);return result.status==='OWNED_SUCCESSOR_CONFIGURATION_PREPARED'&&result.releaseSha===input.releaseSha&&result.profileDigest===input.profileDigest;},
  prepareGateway:value=>gateway.prepareOwnedSuccessorGatewayUnit(value,gatewayDeps),installGateway:plan=>gateway.installOwnedSuccessorGatewayUnit(plan),
  observeGateway:async value=>{const r=await gateway.observeOwnedSuccessorGatewayUnit(value,gatewayDeps);return r?.status==='OWNED_SUCCESSOR_GATEWAY_UNIT_VERIFIED'&&r.releaseSha===input.releaseSha&&r.operationId===input.operationId&&r.attemptId===input.attemptId&&r.daemonReloaded===true;},
 };
}
