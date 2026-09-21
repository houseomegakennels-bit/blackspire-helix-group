import {validateOwnedSourceCurrentSecurityProof} from './owned-source-demo-restriction.js';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyReleaseSource} from '../zola-release/commander-host.js';
import {openReleaseJournal} from '../zola-release/commander-journal.js';
import {readRootOwnedMetadataSnapshot} from './protected-json.js';
import {readOwnedDatabaseProfile,databaseProfileDigest} from './database-profile.js';
import {observeOwnedMigrationPrerequisitesWithDemoRestriction} from './owned-target-hardening-host.js';
import {createOwnedSourceSecurityFiles} from './owned-source-security-host.js';
import fs from 'node:fs';
import {RELEASE_ADMISSION_ROOT,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {observeHeldLifecycle,validateHeldLifecycleProof} from '../zola-release/held-lifecycle.js';
const fail=()=>{throw new Error('Owned migration successor evidence refused');};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const OWNED_MIGRATION_PREDECESSOR=Object.freeze({releaseSha:'2636a1e75cd0f422aff036dfee8a93a81cd5008b',operationId:'95a11ea1-289f-46a9-b5cd-cc7805497242',profileDigest:'2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505',sourceSecurityManifestDigest:'a07fb7bf9e998c976eb57abcdd422a463ba2718c1b9ec8c59c6108da4edb81ac',sourceBodySha256:'4687ea2738680ad3fa5b0bc522246a48298877167b91c3866f275e8217c71091',copyManifestDigest:'2a09adfbb53b449be42aa151bd88c6d2cdb9f99da6269faf2b0b5d92e373aaa3',targetHardeningBodySha256:'bed890d8bd645d3467197979a3405f85c5a1c16fed4375df896f955113d29177',targetHardeningMigrationSha256:'61baa67314a77d4fa0f0b587821de9216dfa0220d1bb9e22b2808bc2002ae01e'});
const P=OWNED_MIGRATION_PREDECESSOR,BASE='/var/lib/blackspire-operator';
export const OWNED_MIGRATION_PREDECESSOR_FILES=Object.freeze({sourceSecurityConfigurationFile:`${BASE}/owned-source-security/${P.operationId}/configuration.json`,ownedMigrationConfigurationFile:`${BASE}/owned-buyer-migration/${P.operationId}/manifest.json`,hardeningPlanFile:`${BASE}/owned-target-hardening/${P.operationId}/plan.json`});
const F=OWNED_MIGRATION_PREDECESSOR_FILES;
export const OWNED_MIGRATION_PREDECESSOR_RECORD_DIGESTS=Object.freeze({sourceSecurityConfigurationFile:'b69d7cae18f25f3b680f1b673933811a220ea1fa2364de7432b76d421da93046',ownedMigrationConfigurationFile:'d76629d1aa0677af9ed917ffc8b07a37afbd13cc7f72a31ea50dc02125bdd483',hardeningPlanFile:'176e277c6d6d5c030fbd11806b4ff2daf4148681ff4e4c1512f652bca1eda461'});
export function ownedMigrationSuccessorFile(operationId){if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(operationId??'')||operationId===P.operationId)fail();return `${BASE}/owned-migration-successors/${operationId}/plan.json`;}
function input(value){const optional=['successorLineageFile','sourceSecurityConfigurationFile','ownedMigrationConfigurationFile'];if(!value||Object.keys(value).some(k=>!['releaseSha','operationId','profileDigest',...optional].includes(k))||!/^[a-f0-9]{40}$/.test(value.releaseSha??'')||value.releaseSha===P.releaseSha||value.profileDigest!==P.profileDigest)fail();const file=ownedMigrationSuccessorFile(value.operationId);for(const k of optional)if(value[k]!==undefined&&value[k]!==(k==='successorLineageFile'?file:F[k]))fail();return {releaseSha:value.releaseSha,operationId:value.operationId,profileDigest:value.profileDigest};}
export function verifyOwnedMigrationSuccessorSource(releaseSha,{root=fileURLToPath(new URL('../../',import.meta.url)),verify=verifyReleaseSource,run=execFileSync}={}){
 if(releaseSha===P.releaseSha||!/^[a-f0-9]{40}$/.test(releaseSha??''))fail();verify(releaseSha,{root});
 const options={encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'}};
 run('/usr/bin/git',['--no-replace-objects','-C',root,'cat-file','-e',P.releaseSha+'^{commit}'],options);
 run('/usr/bin/git',['--no-replace-objects','-C',root,'merge-base','--is-ancestor',P.releaseSha,releaseSha],options);
}
function capture(){const result={};for(const[k,file]of Object.entries(F)){const r=readRootOwnedMetadataSnapshot(file,{groupId:0});if(r.identity.uid!==0||r.identity.gid!==0||(r.identity.mode&0o7777)!==0o600||hash(r.value)!==OWNED_MIGRATION_PREDECESSOR_RECORD_DIGESTS[k])fail();result[k]=hash(r.value);}return result;}
export function validateOwnedMigrationSuccessorPlan(plan,request){const bound=input(request),expected={version:1,kind:'owned-migration-successor-lineage-v1',...bound,predecessor:{...P},originalRecordDigests:{...OWNED_MIGRATION_PREDECESSOR_RECORD_DIGESTS},originalPaths:{...F},dataCopied:false,hardeningReapplied:false};if(!same(plan,expected))fail();return expected;}
async function run(request,prepare,deps){const bound=input(request);if((deps.uid??process.getuid)()!==0)fail();const file=ownedMigrationSuccessorFile(bound.operationId),files=deps.files??createOwnedSourceSecurityFiles(),verify=deps.verifySource??verifyOwnedMigrationSuccessorSource,readProfile=deps.readProfile??readOwnedDatabaseProfile,profileHash=deps.profileDigest??databaseProfileDigest,captureRecords=deps.captureRecords??capture;
 const fence=()=>{verify(bound.releaseSha);if(profileHash(readProfile())!==P.profileDigest||!same(captureRecords(),OWNED_MIGRATION_PREDECESSOR_RECORD_DIGESTS))fail();};
 fence();const plan={version:1,kind:'owned-migration-successor-lineage-v1',...bound,predecessor:{...P},originalRecordDigests:{...OWNED_MIGRATION_PREDECESSOR_RECORD_DIGESTS},originalPaths:{...F},dataCopied:false,hardeningReapplied:false};
 const retained=files.read(file);if(retained!==null)validateOwnedMigrationSuccessorPlan(retained,bound);else if(!prepare)fail();
 const observation=await(deps.observePredecessor??observeOwnedMigrationPrerequisitesWithDemoRestriction)({releaseSha:P.releaseSha,operationId:P.operationId,profileDigest:P.profileDigest,sourceSecurityConfigurationFile:F.sourceSecurityConfigurationFile,ownedMigrationConfigurationFile:F.ownedMigrationConfigurationFile},{verifySource:sha=>{if(sha!==P.releaseSha)fail();fence();}});
 const original=observation?.historicalPrerequisites,currentSecurity=observation?.currentSecurity;validateOwnedSourceCurrentSecurityProof(currentSecurity);
 if(observation?.status!=='OWNED_MIGRATION_CURRENT_SECURITY_VERIFIED'||currentSecurity?.status!=='OWNED_SOURCE_DEMO_RESTRICTION_VERIFIED'||currentSecurity.manifestDigest!==P.sourceSecurityManifestDigest||currentSecurity.originalBodySha256!==P.sourceBodySha256||currentSecurity.sourceWritesDenied!==true||currentSecurity.ownerReadPreserved!==true||currentSecurity.demoReadDenied!==true||currentSecurity.sourceSqlReapplied!==false||!['currentCatalogDigest','historicalProofDigest'].every(k=>/^[a-f0-9]{64}$/.test(currentSecurity[k]??'')))fail();
 if(original?.status!=='OWNED_MIGRATION_PREREQUISITES_VERIFIED'||original.releaseSha!==P.releaseSha||original.operationId!==P.operationId||original.profileDigest!==P.profileDigest||original.sourceWritesDenied!==true||original.targetBrowserSecurityVerified!==true||original.originalSourceMigrationsReapplied!==false||['sourceSecurityManifestDigest','copyManifestDigest','targetHardeningBodySha256'].some(k=>original[k]!==P[k]))fail();
 fence();const proof={status:'OWNED_MIGRATION_SUCCESSOR_VERIFIED',...bound,predecessorReleaseSha:P.releaseSha,predecessorOperationId:P.operationId,sourceSecurityManifestDigest:P.sourceSecurityManifestDigest,copyManifestDigest:P.copyManifestDigest,targetHardeningBodySha256:P.targetHardeningBodySha256,lineageDigest:hash(plan),predecessorProofDigest:hash(original),sourceWritesDenied:true,targetBrowserSecurityVerified:true,originalSourceMigrationsReapplied:false,dataCopied:false,hardeningReapplied:false};
 const resultFile=file.replace(/plan\.json$/,'result.json'),extensionFile=file.replace(/plan\.json$/,'current-source-security.json');
 const extension={version:1,status:'OWNED_SUCCESSOR_CURRENT_SOURCE_SECURITY_VERIFIED',...bound,lineageDigest:hash(plan),historicalResultDigest:hash(proof),currentSecurity};
 if(prepare){await deps.preparationFence();files.directory(file.slice(0,file.lastIndexOf('/')));files.publish(file,plan);files.publish(resultFile,proof);files.publish(extensionFile,extension);fence();await deps.preparationFence();}else if(!same(files.read(resultFile),proof)||!same(files.read(extensionFile),extension))fail();
 if(!same(files.read(file),plan))fail();return {...proof,currentSourceSecurity:extension};
}
export async function observeOwnedMigrationPreparationHeld(journal,{observe=observeHeldLifecycle,readState}={}){
 const runId='3502c7e8-896e-49e3-bd58-618fe86d2b1c',file=RELEASE_ADMISSION_ROOT+'/state.json';
 const read=readState??(()=>readRootOwnedJsonSnapshot(file,{groupId:fs.lstatSync(file).gid,maxBytes:2048}).value);
 const state=validateReleaseAdmissionState(read());if(state.mode!=='held'||state.releaseSha!==P.releaseSha||state.runId!==runId||state.apiGeneration!==null||state.workerGeneration!==null)fail();
 const rows=journal.stream('release').events().filter(e=>e.type==='release_lifecycle_result'&&e.runId===runId);
 if(rows.length!==1||rows[0].releaseSha!==P.releaseSha)fail();const prior=validateHeldLifecycleProof(rows[0].proof,{releaseSha:P.releaseSha,runId});
 const current=validateHeldLifecycleProof(await observe({releaseSha:P.releaseSha,runId}),{releaseSha:P.releaseSha,runId});
 if(!same(prior,current)||!same(read(),state))fail();return current;
}
export async function prepareOwnedMigrationSuccessor(request,deps={}){const guard=(deps.openGlobal??openReleaseJournal)();try{
 const observe=deps.observePreparationHeld??observeOwnedMigrationPreparationHeld,held=await observe(guard);
 const preparationFence=async()=>{if(!same(await observe(guard),held))fail();};
 return await run(request,true,{...deps,preparationFence});
 }finally{guard.close();}}
export async function observeOwnedMigrationSuccessor(request,deps={}){return run(request,false,deps);}
