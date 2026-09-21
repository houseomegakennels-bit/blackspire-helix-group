import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReleaseSource} from '../zola-release/commander-host.js';
import {collectInstalledHeldWriterProfile} from '../zola-release/held-writer-profile.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState,RELEASE_ADMISSION_ROOT} from '../shared/release-admission.js';
const fail=()=>{throw new Error('Denial session runtime rejected');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Only the exact deployed runtime artifact may replace clean release-checkout
// source authority. This supports the merged main SHA without relabeling the
// coordinator checkout or accepting an arbitrary caller-selected code root.
export async function openDenialSessionRuntime(releaseSha,{
 sourceRoot=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),
 root=RELEASE_ADMISSION_ROOT,groupId=fs.lstatSync(path.join(root,'state.json')).gid,
 verifySource=verifyReleaseSource,inspectArtifact=inspectBuyerWriterArtifact,
 collect=collectInstalledHeldWriterProfile,acquire=acquireReleaseAdmissionLock,
 readState=()=>readRootOwnedJson(path.join(root,'state.json'),{groupId,maxBytes:2048}),
}={}){
 let lease;
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??''))fail();
  lease=acquire({root,exclusive:false,allowPending:true,owner:0,groupId});
  const state=validateReleaseAdmissionState(readState()),artifactRoot='/opt/blackspire-command/releases/'+releaseSha;
  const assertHeld=()=>{lease.assertIdentity();if(state.mode!=='held'||state.releaseSha!==releaseSha||!same(state,validateReleaseAdmissionState(readState())))fail();};
  const observe=async()=>{
   assertHeld();let sourceProof;
   if(sourceRoot===artifactRoot)sourceProof=await inspectArtifact({artifactRoot,releaseSha,environment:'production'});
   else await verifySource(releaseSha,{root:sourceRoot});
   const installed=await collect(releaseSha),context=installed.context;
   if(context.releaseSha!==releaseSha||context.artifactRoot!==artifactRoot||context.environment!=='production'||context.workspace!=='blackspire-command'
    ||state.apiGeneration!==null&&(state.apiGeneration!==context.apiGeneration||state.workerGeneration!==installed.workerGeneration))fail();
   const artifact=await inspectArtifact({artifactRoot,releaseSha,environment:'production'});
   if(artifact.releaseSha!==releaseSha||artifact.environment!=='production'||artifact.artifactDigest!==installed.artifactDigest
    ||sourceProof&&(sourceProof.releaseSha!==releaseSha||sourceProof.artifactDigest!==artifact.artifactDigest))fail();
   assertHeld();
   // Issuance never needs the installed preparation credential.
   return {context,artifactDigest:installed.artifactDigest,workerGeneration:installed.workerGeneration,configurationDigest:installed.configurationDigest};
  };
  const profile=await observe();
  const assertCurrent=async()=>{if(!same(profile,await observe()))fail();};
  await assertCurrent();
  return Object.freeze({profile,assertCurrent,assertHeld,close:()=>lease.close()});
 }catch{lease?.close();fail();}
}
