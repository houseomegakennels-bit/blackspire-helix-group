import path from 'node:path';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {measureDeploymentHeadroom} from './disk.js';

const reject=()=>{throw new Error('Release host precondition rejected');};
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&value!=='/';
export async function verifyReleaseArtifactDisk({releaseSha,configuration},{inspect=inspectBuyerWriterArtifact,measure=measureDeploymentHeadroom}={}){
 const required=['artifactRoot','databasePath','releaseRoot','buildPeakBytes','packagePeakBytes','logTempReserveBytes'];
 if(!configuration||Object.keys(configuration).length!==required.length||required.some(key=>!Object.hasOwn(configuration,key))
  ||!absolute(configuration.artifactRoot)||path.basename(configuration.artifactRoot)!==releaseSha)reject();
 const artifact=await inspect({artifactRoot:configuration.artifactRoot,releaseSha,environment:'production'});
 if(artifact.releaseSha!==releaseSha||artifact.environment!=='production'||!(/^[a-f0-9]{64}$/).test(artifact.artifactDigest??''))reject();
 const disk=measure(configuration);
 if(disk.deploymentSafe!==true||!Number.isSafeInteger(disk.freeBytes)||!Number.isSafeInteger(disk.requiredBytes)
  ||disk.requiredBytes<=0||disk.freeBytes<disk.requiredBytes)reject();
 const after=await inspect({artifactRoot:configuration.artifactRoot,releaseSha,environment:'production'});
 if(JSON.stringify(artifact)!==JSON.stringify(after))reject();
 return{artifact:{releaseSha,environment:'production',artifactDigest:artifact.artifactDigest},disk};
}
