import fs from 'node:fs';
import {hash} from './commander-journal.js';
import {MIXED_RETIREMENT as P} from './mixed-retirement-history.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readReleaseProtectedBytes} from './commander-host.js';
import {captureProtectedReleaseBackup,verifyProtectedReleaseBackup} from './commander-backup.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
const ROOT='/var/lib/blackspire-operator/preparation/mixed-backup-renewal-b9679cbd-5331-45ae-a026-02b7f5e117e9';
const fail=()=>{throw Error('MIXED_BACKUP_RENEWAL_REFUSED');};
const exact=(v,k)=>v&&Object.keys(v).sort().join(',')===k.split(',').sort().join(',');
export function validateMixedBackupRenewal(record,release,originalDigest){
 if(hash(release)!==P.successorInputDigest||!exact(record,'version,releaseSha,operationId,originalManifestFile,originalManifestDigest,manifestFile,proof,proofDigest')
  ||record.version!==1||record.releaseSha!==P.successorReleaseSha||record.operationId!==P.successorOperationId
  ||record.originalManifestFile!==release.backupManifestFile||record.originalManifestDigest!==originalDigest
  ||typeof record.manifestFile!=='string'||!new RegExp('^/var/lib/blackspire-operator/preparation/zola-backups/'+P.successorReleaseSha+'-[a-f0-9-]{36}/manifest.json$').test(record.manifestFile)
  ||record.manifestFile===record.originalManifestFile||record.proof?.status!=='PROTECTED_BACKUP_VERIFIED'
  ||record.proof.releaseSha!==P.successorReleaseSha||record.proof.sourceIdentityBound!==true||record.proofDigest!==hash(record.proof))fail();
 return record;
}
export function resolveProductionBackup(context){
 const release=context.release;
 if(release?.releaseSha!==P.successorReleaseSha||release?.operationId!==P.successorOperationId)return release.backupManifestFile;
 if(!fs.existsSync(ROOT))return release.backupManifestFile;
 const files=createBuyerStoreProtectedFiles(),record=files.value(ROOT+'/result.json',true);
 if(!record)return release.backupManifestFile;
 validateMixedBackupRenewal(record,release,hash(readReleaseProtectedBytes(release.backupManifestFile,16384)));
 return record.manifestFile;
}
export async function prepareMixedBackupRenewal({release,journal,fence}){
 const sequence=inspectReleaseSequenceHistory(journal.stream('release').events());
 if(sequence.nextOrdinal<14)return;
 if(hash(release)!==P.successorInputDigest||sequence.context.operationId!==P.successorOperationId)fail();
 const files=createBuyerStoreProtectedFiles(),originalDigest=hash(readReleaseProtectedBytes(release.backupManifestFile,16384));
 const old=fs.existsSync(ROOT)?files.value(ROOT+'/result.json',true):null;
 if(old){validateMixedBackupRenewal(old,release,originalDigest);verifyProtectedReleaseBackup({releaseSha:P.successorReleaseSha,manifestFile:old.manifestFile});return;}
 if(sequence.nextOrdinal!==14||sequence.pending?.stage!=='rollback_acceptance'
  ||journal.stream('release').events().some(e=>e.type==='rollback_acceptance_probe_result'))fail();
 let lease;
 try{
  fence();const admissionRoot='/etc/blackspire/release-admission',gid=fs.statSync(admissionRoot+'/state.json').gid;
  lease=acquireReleaseAdmissionLock({root:admissionRoot,exclusive:true,owner:0,groupId:gid});
  const state=validateReleaseAdmissionState(JSON.parse(files.read(admissionRoot+'/state.json',{gid,mode:0o640})));
  const a=sequence.outputs.admission_lease;
  if(state.mode!=='held'||state.releaseSha!==P.successorReleaseSha||state.runId!==a?.epochRunId)fail();
  const lifecycle=await observeHeldLifecycle({releaseSha:state.releaseSha,runId:state.runId});
  if(lifecycle.api.generation!==a.apiGeneration||lifecycle.worker.generation!==a.workerGeneration)fail();
  const manifest=JSON.parse(readReleaseProtectedBytes(release.backupManifestFile,16384));
  if(!Number.isFinite(Date.parse(manifest.startedAt))||Date.now()-Date.parse(manifest.startedAt)<=3600000)fail();
  files.directory(ROOT,{create:true});
  if(files.value(ROOT+'/intent.json',true))fail();
  files.record(ROOT+'/intent.json',{version:1,releaseSha:P.successorReleaseSha,operationId:P.successorOperationId,originalManifestDigest:originalDigest,attemptId:sequence.pending.attemptId});
  lease.assertIdentity();fence();
  const captured=captureProtectedReleaseBackup(P.successorReleaseSha),proof=verifyProtectedReleaseBackup({releaseSha:P.successorReleaseSha,manifestFile:captured.manifestFile});
  const record={version:1,releaseSha:P.successorReleaseSha,operationId:P.successorOperationId,originalManifestFile:release.backupManifestFile,
   originalManifestDigest:originalDigest,manifestFile:captured.manifestFile,proof,proofDigest:hash(proof)};
  validateMixedBackupRenewal(record,release,originalDigest);lease.assertIdentity();fence();
  files.record(ROOT+'/result.json',record);
 }finally{lease?.close();}
}
