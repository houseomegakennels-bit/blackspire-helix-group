import {partitionRetiredReleaseHistory} from './retired-release-history.js';
import {readOwnedDatabaseProfile,databaseProfileDigest,OWNED_DATABASE_MANAGEMENT} from '../buyer-writer/database-profile.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from './commander-journal.js';
import {inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {BUYER_WRITER_PROVISIONING_JOURNAL_FILE,OWNED_BUYER_WRITER_PROVISIONING_JOURNAL_ROOT} from '../buyer-writer/production-provisioning-journal.js';
import {BUYER_WRITER_GATEWAY_CONFIG_FILE,BUYER_WRITER_GATEWAY_UPGRADE_STATE}
 from '../buyer-writer/gateway-configuration-upgrade-files.js';
import {buyerWriterGatewayV4IntentPath} from '../buyer-writer/gateway-v4-preparation.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const SHA=/^[a-f0-9]{40}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const PHASES=['source_v1','gateway_v4','gateway_upgrade','database_provisioning','configuration_install','gateway_unit'];
const PREPARATION='/var/lib/blackspire-operator/preparation';
export const BUYER_WRITER_ACTIVATION_PATHS=Object.freeze({
 credentialSource:`${PREPARATION}/zola-gateway-6f7e0c2-provisioning.json`,source:`${PREPARATION}/source-v1.json`,
 candidate:releaseSha=>`${PREPARATION}/buyer-writer-v4-${releaseSha}.json`,
 gatewayInstallationState:'/var/lib/blackspire-operator/gateway-installation/state.json',
 management:'/etc/blackspire-buyer-writer-gateway/management.json',
 configJournal:operationId=>`${PREPARATION}/zola-config-${operationId}.journal.jsonl`,
 artifactRoot:releaseSha=>`/opt/blackspire-command/releases/${releaseSha}`,
});
export const OWNED_BUYER_WRITER_ACTIVATION_PATHS=Object.freeze({
 credentialSource:`${PREPARATION}/owned-gateway-provisioning.json`,source:`${PREPARATION}/owned-source-v1.json`,
 candidate:releaseSha=>`${PREPARATION}/owned-buyer-writer-v4-${releaseSha}.json`,management:OWNED_DATABASE_MANAGEMENT,
});
const reject=()=>{throw new Error('Buyer writer pre-HELD activation rejected');};
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function binding(input){
 if(!exact(input,['releaseSha','operationId','attemptId','inputDigest','checkOutputDigest',...(input?.backendProfile==='owned-postgres-v1'?['backendProfile','profileDigest']:[])])
  ||!SHA.test(input.releaseSha??'')||!UUID.test(input.operationId??'')||!UUID.test(input.attemptId??'')
  ||input.operationId===input.attemptId||!DIGEST.test(input.inputDigest??'')
  ||!DIGEST.test(input.checkOutputDigest??'')||(input.backendProfile==='owned-postgres-v1'&&!DIGEST.test(input.profileDigest??'')))reject();
 return Object.freeze({...input});
}
function defaultRun(script,args){
 const stdout=execFileSync('/bin/bash',['scripts/with-node.sh',script,...args],{cwd:ROOT,
  encoding:'utf8',timeout:120000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',LANG:'C'}});
 const result=JSON.parse(stdout);
 if(!result||typeof result!=='object'||Array.isArray(result))reject();return result;
}
function defaultReloadSystemd(){
 const result=spawnSync('/usr/bin/systemctl',['daemon-reload'],{encoding:'utf8',timeout:120000,
  maxBuffer:65536,killSignal:'SIGKILL',stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',LANG:'C'}});
 if(result.status!==0||result.error||result.signal!==null||result.stdout!==''||result.stderr!=='')reject();
 return Object.freeze({status:'SYSTEMD_RELOADED'});
}
function history(events,bound){
 const partition=partitionRetiredReleaseHistory(events);
 if(partition.retired){
  inspectBuyerWriterActivationHistory(partition.prefix);
  return history(partition.current,bound);
 }
 const rows=events.filter(row=>row?.type==='buyer_writer_activation_intent'
  ||row?.type==='buyer_writer_activation_result');
 if(rows.length===0)return {intent:null,completed:new Map()};
 const intent=rows[0],bindingDigest=hash(bound);
 if(intent.type!=='buyer_writer_activation_intent'||intent.schema!==1
  ||intent.bindingDigest!==bindingDigest||hash(intent.binding)!==bindingDigest)reject();
 const completed=new Map();let cursor=0;
 for(const row of rows.slice(1)){
  const phase=PHASES[cursor];
  if(row.schema!==1||row.type!=='buyer_writer_activation_result'||row.phase!==phase
   ||row.bindingDigest!==bindingDigest||typeof row.status!=='string'||!DIGEST.test(row.evidenceDigest??''))reject();
  completed.set(phase,row);cursor++;
 }
 return {intent,completed};
}
export function inspectBuyerWriterActivationHistory(events){
 const partition=partitionRetiredReleaseHistory(events);
 if(partition.retired){
  const prior=inspectBuyerWriterActivationHistory(partition.prefix);
  if(prior.completed.size!==3)reject();
  return inspectBuyerWriterActivationHistory(partition.current);
 }
 const rows=events.filter(row=>['buyer_writer_activation_intent','buyer_writer_activation_result'].includes(row?.type));
 if(!rows.length)return {intent:null,completed:new Map()};
 const bound=binding(rows[0].binding);
 const observed=history(events,bound);
 const statuses={source_v1:['BUYER_WRITER_SOURCE_V1_PREPARED'],gateway_v4:['BUYER_WRITER_GATEWAY_V4_PREPARED','COMPLETE'],
  gateway_upgrade:['UPGRADED'],database_provisioning:['COMPLIANT','PROVISIONED','ALREADY_COMPLIANT'],configuration_install:['INSTALLED_AND_RELOADED'],gateway_unit:['UNIT_PREPARED']};
 for(let index=0;index<events.length;index++){
  const row=events[index];if(!rows.includes(row))continue;
  if(!exact(row,row.type==='buyer_writer_activation_intent'?['schema','type','binding','bindingDigest']
   :['schema','type','phase','bindingDigest','status','evidenceDigest']))reject();
  if(row.type==='buyer_writer_activation_result'&&!statuses[row.phase]?.includes(row.status))reject();
  const state=inspectReleaseSequenceHistory(events.slice(0,index)),pending=state.pending;
  if(!pending||pending.stage!=='admission_lease'||state.context.releaseSha!==bound.releaseSha
   ||state.context.operationId!==bound.operationId
   ||['attemptId','inputDigest','checkOutputDigest'].some(key=>pending[key]!==bound[key]))reject();
 }
 return observed;
}
function requireStatus(result,allowed){
 if(!allowed.includes(result?.status))reject();return result;
}
function provisioningMode(bound,io,readJson){
 const owned=bound.backendProfile==='owned-postgres-v1',filename=owned?`${OWNED_BUYER_WRITER_PROVISIONING_JOURNAL_ROOT}/state.json`:BUYER_WRITER_PROVISIONING_JOURNAL_FILE;
 try{
  io.lstatSync(filename);
  const value=readJson(filename,{groupId:0,maxBytes:4096});
  if(value.version!==(owned?3:2)||(owned&&(value.backendProfile!==bound.backendProfile||value.profileDigest!==bound.profileDigest))||value.releaseSha!==bound.releaseSha||value.operationId!==bound.operationId
   ||value.attemptId!==bound.attemptId)reject();
  return '--reconcile';
 }catch(error){if(error?.code==='ENOENT')return '--apply';throw error;}
}
async function sourcePhase(bound,run,paths){
 return requireStatus(await run('scripts/prepare-buyer-writer-source-v1.js',['--prepare',bound.releaseSha,
  bound.operationId,bound.attemptId,paths.credentialSource,paths.management,paths.source]),
 ['BUYER_WRITER_SOURCE_V1_PREPARED']);
}
async function gatewayPhase(bound,run,paths,io){
 const args=[bound.releaseSha,bound.operationId,bound.attemptId,paths.source,paths.candidate];
 const intentPath=buyerWriterGatewayV4IntentPath(paths.candidate);let result;
 try{io.lstatSync(intentPath);
  result=await run('scripts/prepare-buyer-writer-gateway-v4.js',['--inspect',...args]);
 }catch(error){
  if(error?.code!=='ENOENT')throw error;
  result=await run('scripts/prepare-buyer-writer-gateway-v4.js',['--prepare',...args]);
 }
 if(['ABSENT','PARTIAL'].includes(result.status))
  result=await run('scripts/prepare-buyer-writer-gateway-v4.js',['--reconcile',...args]);
 return requireStatus(result,['BUYER_WRITER_GATEWAY_V4_PREPARED','COMPLETE']);
}
async function upgradePhase(bound,run,paths,io,inspectArtifact,readJson){
 const artifact=await inspectArtifact({artifactRoot:paths.artifactRoot,
  releaseSha:bound.releaseSha,environment:'production'});
 if(artifact?.status!=='SEALED_ARTIFACT_VERIFIED'||artifact.releaseSha!==bound.releaseSha
  ||!DIGEST.test(artifact.artifactDigest??'')||artifact.deployed!==false
  ||artifact.productionAccepted!==false)reject();
 const stateFile=path.join(BUYER_WRITER_GATEWAY_UPGRADE_STATE,bound.operationId+'.state.json');
 let mode='--upgrade',candidateDigest;
 try{
  io.lstatSync(stateFile);mode='--reconcile';
  const state=readJson(stateFile,{groupId:0,maxBytes:4096});
  const keys=['version','kind','releaseSha','operationId','attemptId','artifactDigest',
   'candidateDigest','phase','configurationFile','backupFile','oldConfigDigest','newConfigDigest'];
  if(!exact(state,keys)||state.version!==2
   ||state.kind!=='buyer_writer_gateway_configuration_upgrade'
   ||state.releaseSha!==bound.releaseSha||state.operationId!==bound.operationId
   ||state.attemptId!==bound.attemptId||state.artifactDigest!==artifact.artifactDigest
   ||!DIGEST.test(state.candidateDigest??'')||!DIGEST.test(state.oldConfigDigest??'')
   ||!DIGEST.test(state.newConfigDigest??'')
   ||!['INTENT','PREPARED','PUBLISHED','COMPLETED','ROLLED_BACK'].includes(state.phase)
   ||state.configurationFile!==BUYER_WRITER_GATEWAY_CONFIG_FILE
   ||state.backupFile!==path.join(BUYER_WRITER_GATEWAY_UPGRADE_STATE,
    bound.operationId+'.backup.json'))reject();
  candidateDigest=state.candidateDigest;
 }catch(error){if(error?.code!=='ENOENT')throw error;}
 if(mode==='--upgrade'){
  const gateway=await gatewayPhase(bound,run,paths,io);
  candidateDigest=gateway.candidateDigest;
 }
 const result=await run('scripts/upgrade-buyer-writer-gateway-configuration.js',[mode,bound.releaseSha,
  bound.operationId,bound.attemptId,artifact.artifactDigest,candidateDigest,paths.candidate]);
 return requireStatus(result,['UPGRADED']);
}
async function provisionPhase(bound,run,paths,io,readJson){
 const args=['--management-config',paths.management];
 const inspection=await run('scripts/provision-buyer-writer-production.js',['--inspect',...args]);
 if(inspection.status==='COMPLIANT')return requireStatus(
  await run('scripts/provision-buyer-writer-production.js',['--verify',...args]),['COMPLIANT']);
 if(inspection.status!=='NONCOMPLIANT')reject();
 const mode=provisioningMode(bound,io,readJson);
 return requireStatus(await run('scripts/provision-buyer-writer-production.js',[mode,...args]),
  ['PROVISIONED','ALREADY_COMPLIANT']);
}
async function configPhase(bound,run,paths,reloadSystemd){
 const installed=requireStatus(await run('scripts/zola-config-install.js',['--install',bound.releaseSha,
  paths.candidate,paths.configJournal]),['INSTALLED_RELOAD_REQUIRED']);
 const reloaded=requireStatus(await reloadSystemd(),['SYSTEMD_RELOADED']);
 return Object.freeze({status:'INSTALLED_AND_RELOADED',installEvidenceDigest:hash(installed),
  reloadEvidenceDigest:hash(reloaded)});
}

async function gatewayUnitPhase(bound,run,paths,io){
 let mode='--prepare';try{io.lstatSync(paths.gatewayInstallationState);mode='--reconcile-prepared';}catch(error){if(error.code!=='ENOENT')throw error;}
 return requireStatus(await run('scripts/buyer-writer-gateway-install.js',[mode,bound.releaseSha]),['UNIT_PREPARED']);
}

export async function activateBuyerWriterBeforeHeld(input,{journal,run=defaultRun,io=fs,
 inspectArtifact=inspectSealedBuyerWriterArtifact,readJson=readRootOwnedJson,
 reloadSystemd=defaultReloadSystemd,paths:overrides={},readProfile=readOwnedDatabaseProfile}={}){
 const bound=binding(input);if(!journal?.stream)reject();
 const owned=bound.backendProfile==='owned-postgres-v1';
 const assertProfile=()=>{if(owned&&databaseProfileDigest(readProfile())!==bound.profileDigest)reject();};
 assertProfile();
 const paths={...BUYER_WRITER_ACTIVATION_PATHS,...(owned?OWNED_BUYER_WRITER_ACTIVATION_PATHS:{}),...overrides};
 paths.candidate=typeof paths.candidate==='function'?paths.candidate(bound.releaseSha):paths.candidate;
 paths.configJournal=typeof paths.configJournal==='function'?paths.configJournal(bound.operationId):paths.configJournal;
 paths.artifactRoot=typeof paths.artifactRoot==='function'?paths.artifactRoot(bound.releaseSha):paths.artifactRoot;
 const stream=journal.stream('release'),observed=history(stream.events(),bound);
 const bindingDigest=hash(bound);
 if(!observed.intent)stream.append({schema:1,type:'buyer_writer_activation_intent',
  binding:bound,bindingDigest});
 const actions={source_v1:()=>sourcePhase(bound,run,paths),
  gateway_v4:()=>gatewayPhase(bound,run,paths,io),
  gateway_upgrade:()=>upgradePhase(bound,run,paths,io,inspectArtifact,readJson),
  database_provisioning:()=>provisionPhase(bound,run,paths,io,readJson),
  configuration_install:()=>configPhase(bound,run,paths,reloadSystemd),gateway_unit:()=>gatewayUnitPhase(bound,run,paths,io)};
 for(const phase of PHASES){
  if(observed.completed.has(phase))continue;
  assertProfile();const result=await actions[phase]();assertProfile();
  const row={schema:1,type:'buyer_writer_activation_result',phase,bindingDigest,
   status:result.status,evidenceDigest:hash(result)};
  stream.append(row);observed.completed.set(phase,row);
 }
 assertProfile();
 const evidence={releaseSha:bound.releaseSha,operationId:bound.operationId,
  attemptId:bound.attemptId,bindingDigest,completed:[...PHASES]};
 return Object.freeze({status:'BUYER_WRITER_PRE_HELD_READY',...evidence,
  evidenceDigest:hash(evidence)});
}
