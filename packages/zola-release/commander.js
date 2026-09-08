import {verifyProtectedReleaseBackup} from './commander-backup.js';
import {verifyReleaseArtifactDisk} from './commander-preconditions.js';
import {randomUUID} from 'node:crypto';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {hash} from './commander-journal.js';
import {readReleaseProtectedBytes,verifyReleaseSource,verifyReleaseCi} from './commander-host.js';
import {prepareN8nTransition,executeN8nTransition,createN8nTransport} from './commander-n8n.js';

// This is an executable observational prefix, not permission to perform the
// remaining release. No production mutation adapter exists in this module.
export const UNWIRED_RELEASE_GATES=Object.freeze([
 'provider_acl','historical_route_containment','rollback_acceptance','connected_six_reads',
 'intake_held_activation','writer_identity','migration_execution',
 'n8n_continuity','protected_merge','production_sha_pairing','production_smoke',
]);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const reject=()=>{throw new Error('Release preflight rejected');};
const keys=(value,expected)=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==expected.split(',').sort().join(','))reject();
};
function ciProof(value,releaseSha){
 keys(value,'releaseSha,mainSha,runId,runAttempt,ciMergeSha,ciTreeSha,artifactId,artifactZipDigest,ciArtifactDigest,status');
 if(value.releaseSha!==releaseSha||![value.mainSha,value.ciMergeSha,value.ciTreeSha].every(sha)
  ||![value.runId,value.runAttempt,value.artifactId].every(n=>Number.isSafeInteger(n)&&n>0)
  ||!/^sha256:[a-f0-9]{64}$/.test(value.artifactZipDigest??'')||!(/^[a-f0-9]{64}$/).test(value.ciArtifactDigest??'')||value.status!=='success')reject();
 return structuredClone(value);
}
const PREFLIGHT_STAGES=Object.freeze(['source','ci','artifact_disk','protected_backup','n8n_package','n8n_live','identity_recheck']);
function history(journal){
 const events=journal.stream('release').events();
 // Unknown events may represent a future/crashed mutation. Never reinterpret
 // them as harmless observations or permit a new SHA/run ID to bypass them.
 const runs=new Map();
 for(const row of events){
  if(row?.schema!==1||!['preflight_started','preflight_passed','preflight_stopped'].includes(row.type)
   ||!sha(row.releaseSha)||typeof row.runId!=='string'||!(/^[a-f0-9-]{36}$/).test(row.runId))reject();
  keys(row,'schema,type,runId,releaseSha'+(row.type==='preflight_started'?'':row.type==='preflight_passed'?',stage,proof':',stage'));
  if(row.type==='preflight_started'){
   if(runs.has(row.runId))reject();runs.set(row.runId,{releaseSha:row.releaseSha,next:0,closed:false});
  }else{
   const run=runs.get(row.runId);
   if(!run||run.closed||row.releaseSha!==run.releaseSha)reject();
   if(row.type==='preflight_passed'){
    if(row.stage!==PREFLIGHT_STAGES[run.next++])reject();
    if(row.stage==='ci'||row.stage==='identity_recheck')ciProof(row.proof,row.releaseSha);
   }else{
    if(row.stage!==(PREFLIGHT_STAGES[run.next]??'unwired_release_gates'))reject();run.closed=true;
   }
  }
 }

 return events;
}
export function inspectReleaseCommander(journal){
 const events=history(journal);
 return{status:'OBSERVED',eventCount:events.length,releaseReady:false,mutationSent:false,
  remainingGates:[...UNWIRED_RELEASE_GATES]};
}

// Dependency injection is a library test seam only. The executable below wires
// fixed host primitives and never accepts evidence booleans or command strings.
export async function runReleasePreflight({input,journal},{
 readJson=filename=>readRootOwnedJson(filename,{groupId:0}),readBytes=readReleaseProtectedBytes,
 verifySource=verifyReleaseSource,verifyCi=verifyReleaseCi,transport=createN8nTransport,
 verifyArtifactDisk=verifyReleaseArtifactDisk,verifyBackup=verifyProtectedReleaseBackup,
}={}){
 let stage='input',runId,releaseSha;
 const record=(type,detail={})=>journal.stream('release').append({schema:1,type,runId,releaseSha,...detail});
 try{
  keys(input,'releaseSha,packageConfigurationFile,backupFile,diskConfigurationFile,backupManifestFile');
  releaseSha=input.releaseSha;if(!sha(releaseSha))reject();
  for(const field of ['packageConfigurationFile','backupFile','diskConfigurationFile','backupManifestFile'])if(typeof input[field]!=='string'||!input[field].startsWith('/'))reject();
  history(journal);
  runId=randomUUID();record('preflight_started');
  const passed=proof=>record('preflight_passed',{stage,proof});
  stage='source';verifySource(releaseSha);passed({releaseSha});
  stage='ci';const ci=ciProof(await verifyCi(releaseSha),releaseSha);passed(ci);
  stage='artifact_disk';
  const diskConfiguration=readJson(input.diskConfigurationFile),diskConfigDigest=hash(diskConfiguration);
  const local=await verifyArtifactDisk({releaseSha,configuration:diskConfiguration});passed(local);
  stage='protected_backup';const backupProof=await verifyBackup({releaseSha,manifestFile:input.backupManifestFile});passed(backupProof);
  stage='n8n_package';
  const configuration=readJson(input.packageConfigurationFile);
  const backupBytes=readBytes(input.backupFile,2*1024*1024);
  if(configuration.releaseSha!==releaseSha)reject();
  const plan=prepareN8nTransition({configuration,backupBytes});
  const configDigest=hash(configuration);
  const stable=()=>{
   if(hash(readJson(input.diskConfigurationFile))!==diskConfigDigest
    ||hash(readJson(input.packageConfigurationFile))!==configDigest
    ||hash(readBytes(input.backupFile,2*1024*1024))!==plan.backupSha256)reject();
  };
  passed({namespace:plan.namespace,backupSha256:plan.backupSha256,configurationDigest:configDigest});
  stage='n8n_live';
  const request=transport(readBytes('/var/lib/blackspire-operator/n8n-api-key',16384).trim());
  // Defense in depth: even a future change to inspect cannot send a mutation.
  const getOnly=(method,pathname,body)=>{
   if(method!=='GET'||body!==undefined)reject();return request(method,pathname);
  };
  await executeN8nTransition({plan,mode:'inspect',request:getOnly,journal:journal.stream('n8n')});
  const n8nEvents=journal.stream('n8n').events();
  // An inspection may observe a target, but does not reconcile pending writes.
  if(n8nEvents.some(e=>e.type==='intent'&&!n8nEvents.some(done=>done.type==='confirmed'&&done.operation===e.operation)))reject();
  stable();passed({namespace:plan.namespace});
  stage='identity_recheck';verifySource(releaseSha);stable();
  if(JSON.stringify(await verifyBackup({releaseSha,manifestFile:input.backupManifestFile}))!==JSON.stringify(backupProof))reject();
  if(JSON.stringify(ciProof(await verifyCi(releaseSha),releaseSha))!==JSON.stringify(ci))reject();
  passed(ci);
  stage='unwired_release_gates';record('preflight_stopped',{stage});
  return{status:'STOPPED',reason:'RELEASE_GATES_UNWIRED',preflightCompleted:true,releaseSha,runId,
   releaseReady:false,mutationSent:false,remainingGates:[...UNWIRED_RELEASE_GATES]};
 }catch{
  if(runId)try{record('preflight_stopped',{stage});}catch{/* Original durable prefix remains authoritative. */}
  return{status:'STOPPED',reason:'PREFLIGHT_REJECTED',stage,preflightCompleted:false,
   releaseReady:false,mutationSent:false};
 }
}
