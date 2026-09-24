import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {PARTIAL_RELEASE} from './partial-retirement-history.js';
import {hash} from './commander-journal.js';
import {verifyReleaseSource} from './commander-host.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {readRootOwnedJsonSnapshot,readRootOwnedMetadataSnapshot} from '../buyer-writer/protected-json.js';
import {readOwnedDatabaseProfile,databaseProfileDigest} from '../buyer-writer/database-profile.js';
import {RELEASE_ADMISSION_ROOT,acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
const ROOT='/var/lib/blackspire-operator/release-retirements/partial-2636';
const REPOSITORY='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921';
const SERVICES=Object.freeze([
 ['blackspire-command.service','blackspire-api'],['blackspire-command-worker.service','blackspire-worker'],
 ['blackspire-buyer-writer-gateway.service','blackspire-writer'],['blackspire-buyer-store.service','blackspire-buyer-store'],
]);
const fail=()=>{throw new Error('Partial release retirement host refused');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const command=(file,args,timeout=3000)=>{const r=spawnSync(file,args,{encoding:'utf8',timeout,maxBuffer:16384,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});if(r.status!==0||r.error||r.signal||r.stderr!=='')fail();return r.stdout;};
export function createPartialRetirementStore(){
 const files=createBuyerStoreProtectedFiles();files.directory(ROOT,{create:true});
 const filename=name=>{if(!['plan','stop-intent','stop-result','retirement'].includes(name))fail();return ROOT+'/'+name+'.json';};
 return {read:name=>files.value(filename(name),true),retain:(name,value)=>files.record(filename(name),value)};
}
export function createPartialRetirementHost(){
 let lease;
 const state=()=>{const file=RELEASE_ADMISSION_ROOT+'/state.json',gid=fs.lstatSync(file).gid,snapshot=readRootOwnedJsonSnapshot(file,{groupId:gid,maxBytes:2048});
  const v=validateReleaseAdmissionState(snapshot.value);if(v.mode!=='held'||v.releaseSha!==PARTIAL_RELEASE.releaseSha||v.runId!==PARTIAL_RELEASE.runId||v.apiGeneration!==null||v.workerGeneration!==null)fail();return snapshot;};
 const absentBindings=()=>{for(const name of fs.readdirSync('/etc/blackspire'))if(name==='buyer-writer-binding.json'||name.startsWith('buyer-writer-binding.json.')||name.startsWith('.buyer-binding-')||name.startsWith('.buyer-commit-'))fail();return true;};
 const fileSnapshot=file=>{const gid=fs.lstatSync(file).gid,s=readRootOwnedMetadataSnapshot(file,{groupId:gid});return {identity:s.identity,valueDigest:hash(s.value)};};
 const protectedState=()=>{
  const profile=readOwnedDatabaseProfile();if(databaseProfileDigest(profile)!==PARTIAL_RELEASE.profileDigest)fail();
  if(fs.realpathSync('/opt/blackspire-command/current')!=='/opt/blackspire-command/releases/'+PARTIAL_RELEASE.releaseSha)fail();
  absentBindings();const admission=state();
  const pending=fileSnapshot(RELEASE_ADMISSION_ROOT+'/pending.json');
  const files=Object.fromEntries([
   '/etc/blackspire/owned-postgres/profile.json','/etc/blackspire-buyer-store/runtime.json','/etc/blackspire-buyer-store/installed.json',
   '/etc/blackspire-buyer-writer-gateway/gateway.json','/var/lib/blackspire-operator/owned-buyer-writer-provisioning/state.json',
   '/var/lib/blackspire-operator/preparation/owned-gateway-provisioning.json',
  ].map(file=>[file,fileSnapshot(file)]));
  return {admission,pending,files,currentSha:PARTIAL_RELEASE.releaseSha,profileDigest:PARTIAL_RELEASE.profileDigest,bindingAbsent:true};
 };
 const units=running=>SERVICES.map(([unit,user])=>{
  const lines=command('/usr/bin/systemctl',['show','--no-pager','--property=Id,LoadState,ActiveState,SubState,MainPID,InvocationID,User','--',unit]).trim().split('\n');
  const v=Object.fromEntries(lines.map(x=>x.split('=')));
  if(lines.length!==7||Object.keys(v).sort().join(',')!=='ActiveState,Id,InvocationID,LoadState,MainPID,SubState,User'||v.Id!==unit||v.LoadState!=='loaded'||v.User!==user)fail();
  if(running?(v.ActiveState!=='active'||v.SubState!=='running'||!/^\d+$/.test(v.MainPID)||Number(v.MainPID)<1||!/^[a-f0-9]{32}$/.test(v.InvocationID)):(v.ActiveState!=='inactive'||v.SubState!=='dead'||v.MainPID!=='0'))fail();
  return v;
 });
 const noSurvivors=()=>{
  const uids=SERVICES.map(([,user])=>{const p=command('/usr/bin/getent',['passwd',user]).trim().split(':');if(p.length!==7||p[0]!==user||!/^\d+$/.test(p[2])||Number(p[2])===0)fail();return p[2];});
  for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){let text;try{text=fs.readFileSync('/proc/'+pid+'/status','utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
   const ids=text.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);if(!ids||ids.slice(1).some(id=>uids.includes(id)))fail();
  }
  return true;
 };
 return {
  verifySuccessor:async({successorReleaseSha})=>{verifyReleaseSource(successorReleaseSha,{root:REPOSITORY,requireRemote:true});command('/usr/bin/git',['-C',REPOSITORY,'merge-base','--is-ancestor',PARTIAL_RELEASE.releaseSha,successorReleaseSha]);},
  lineage:async({successorReleaseSha,successorOperationId})=>{const {observeOwnedMigrationSuccessor}=await import('../buyer-writer/owned-migration-successor.js');const r=await observeOwnedMigrationSuccessor({releaseSha:successorReleaseSha,operationId:successorOperationId,profileDigest:PARTIAL_RELEASE.profileDigest});if(!/^[a-f0-9]{64}$/.test(r.lineageDigest??''))fail();return r;},
  lease:async()=>{const s=state();lease=acquireReleaseAdmissionLock({root:RELEASE_ADMISSION_ROOT,exclusive:true,allowPending:true,owner:0,groupId:s.identity.gid});lease.assertIdentity();return lease;},
  observeRunning:async()=>{lease.assertIdentity();const before=protectedState(),services=units(true),lifecycle=await observeHeldLifecycle({releaseSha:PARTIAL_RELEASE.releaseSha,runId:PARTIAL_RELEASE.runId});
   const artifact=await inspectBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+PARTIAL_RELEASE.releaseSha,releaseSha:PARTIAL_RELEASE.releaseSha,environment:'production'});
   if(!same(before,protectedState())||!same(services,units(true)))fail();lease.assertIdentity();return {protected:before,services,lifecycle,artifact,admissionStateDigest:hash(before.admission.value),pendingMarkerDigest:before.pending.valueDigest};},
  stop:async()=>{lease.assertIdentity();const output=command('/usr/bin/systemctl',['stop','--',...SERVICES.map(([unit])=>unit)],45000);if(output!=='')fail();},
  observeStopped:async before=>{lease.assertIdentity();if(!same(before.protected,protectedState()))fail();units(false);noSurvivors();
   const artifact=await inspectBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+PARTIAL_RELEASE.releaseSha,releaseSha:PARTIAL_RELEASE.releaseSha,environment:'production'});
   if(!same(artifact,before.artifact)||!same(before.protected,protectedState()))fail();units(false);noSurvivors();lease.assertIdentity();
   return {hostStopped:true,noDetachedSurvivors:true,bindingAbsent:true,currentSha:PARTIAL_RELEASE.releaseSha,retainedProtectedDigest:hash(before.protected),artifactDigest:artifact.artifactDigest};},
 };
}
