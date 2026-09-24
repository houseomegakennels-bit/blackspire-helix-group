import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareOwnedSuccessorGatewayUnit as prepare,installOwnedSuccessorGatewayUnit as install,observeOwnedSuccessorGatewayUnit as observe,readOwnedSuccessorGatewayUnitReceipt as receipt,captureOwnedSuccessorRuntimePhase as phase} from '../packages/buyer-writer/owned-successor-gateway-unit.js';
import {encodeGatewayPreparedState,renderGatewayUnit,GATEWAY_SERVICE} from '../packages/buyer-writer/gateway-installation.js';
import {PARTIAL_RELEASE as P} from '../packages/zola-release/partial-retirement-history.js';
import {hash as journalHash} from '../packages/zola-release/commander-journal.js';
import {publishOwnedConfigurationBytes} from '../packages/zola-release/owned-buyer-configuration-host.js';
const hash=v=>createHash('sha256').update(v).digest('hex'),json=v=>JSON.stringify(v)+'\n';
const template=fs.readFileSync(new URL('../ops/runtime-ownership/blackspire-buyer-writer-gateway.service',import.meta.url),'utf8');
export function createOwnedSuccessorGatewayUnitFixture({releaseSha='a'.repeat(40),operationId='11111111-1111-4111-8111-111111111111',artifactDigest='c'.repeat(64)}={}){
 const root=fs.mkdtempSync('/run/owned-unit-test-'),attemptId='22222222-2222-4222-8222-222222222222',d=artifactDigest;
 const input={releaseSha,operationId,attemptId,profileDigest:P.profileDigest,successorLineageFile:`/var/lib/blackspire-operator/owned-migration-successors/${operationId}/plan.json`};
 const paths={current:root+'/current',root:root+'/receipts',releases:root+'/releases',unit:root+'/gateway.service',oldState:root+'/old-state.json',retirement:root+'/retirement.json'};
 const put=(p,bytes,mode=0o600)=>{fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,bytes,{mode});};
 for(const sha of [P.releaseSha,releaseSha])put(paths.releases+'/'+sha+'/ops/runtime-ownership/'+GATEWAY_SERVICE,template,0o644);
 fs.symlinkSync(paths.releases+'/'+P.releaseSha,paths.current);
 const old=renderGatewayUnit(template,{sha:P.releaseSha}),next=renderGatewayUnit(template,{sha:releaseSha});put(paths.unit,old,0o644);
 put(paths.oldState,encodeGatewayPreparedState({sha:P.releaseSha,unitBackup:null,previousUnit:null,installedUnit:old,artifactDigest:d,configurationSha256:d}));
 const proof={version:1,runId:P.runId,currentSha:P.releaseSha,hostStopped:true,bindingAbsent:true,retainedEffects:true,n8nJournalDigest:P.n8nJournalDigest,stopPlanDigest:d,stopResultDigest:d,lineageDigest:d};
 const retirement={schema:5,type:'sequence_retired',operationId:P.operationId,releaseSha:P.releaseSha,attemptId:P.attemptId,ordinal:5,stage:'admission_lease',prefixDigest:P.prefixDigest,segmentDigest:P.segmentDigest,successorReleaseSha:releaseSha,successorOperationId:operationId,backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,proof,proofDigest:journalHash(proof)};put(paths.retirement,json(retirement));
 let stopped=true,reloaded=false,failReload=false,renames=0,reloads=0,profileVersion=1,state={version:1,mode:'held',releaseSha:P.releaseSha,runId:P.runId,apiGeneration:null,workerGeneration:null};
 const events=[],record=paths.releases+'/'+releaseSha+'/.deployment-record.json';
 const newHeld=()=>{state={...state,releaseSha,runId:attemptId};};
 const beginCandidate=()=>{newHeld();const receiverOrigin={schema:1,mode:'preview',releaseSha,origin:'https://fixture.vercel.app',deploymentId:'dpl_fixture',previousOrigin:null,previousDropin:false};
 const p={operationId,releaseSha,recoverySha:'b'.repeat(40),runId:attemptId,artifactDigest:d,recoveryArtifactDigest:d,previousSha:P.releaseSha,previousArtifactDigest:d,stateDigest:journalHash(state),receiverOrigin,backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,
 ownedStore:{version:1,releaseSha,previousSha:P.releaseSha,origin:receiverOrigin.origin,backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,retainedDigest:d}};
 events.push({schema:2,type:'candidate_deployment_intent',...p},{schema:2,type:'candidate_deployment_step_intent',...p,step:'pointer'});};
 const addRecord=()=>put(record,json({schema:'blackspire-deployment-record',version:1,recordedAt:'2026-09-21T00:00:00.000Z',commitSha:releaseSha}),0o644);
 const switchPointer=()=>{fs.unlinkSync(paths.current);fs.symlinkSync(paths.releases+'/'+releaseSha,paths.current);};
 const deps={paths,releaseEvents:()=>structuredClone(events),artifactGid:0,verifyRetirement:async()=>retirement,profileSnapshot:()=>({identity:{uid:0,gid:0,mode:0o600,ino:profileVersion},value:{}}),profileDigest:()=>P.profileDigest,
 held:()=>state,verifySuccessorHeld:(_i,s)=>s.runId===attemptId,stopped:async()=>{if(!stopped)throw Error('running');},
 observeLineage:async()=>({status:'OWNED_MIGRATION_SUCCESSOR_VERIFIED',releaseSha,operationId,profileDigest:P.profileDigest,lineageDigest:d,sourceWritesDenied:true,targetBrowserSecurityVerified:true,dataCopied:false,hardeningReapplied:false}),
 inspectDeployed:async({releaseSha})=>({releaseSha,artifactDigest:d,environment:'production'}),inspectSealed:async({releaseSha})=>({releaseSha,artifactDigest:d,environment:'production',status:'SEALED_ARTIFACT_VERIFIED',deployed:false,productionAccepted:false}),
 publish:(p,b,a,o)=>{if(fs.readFileSync(p,'utf8')!==a)renames++;publishOwnedConfigurationBytes(p,b,a,o);},run:args=>{if(args[0]==='daemon-reload'){reloads++;reloaded=true;if(failReload){failReload=false;throw Error('lost reload ACK');}return '';}
 assert.equal(args[0],'show');assert.equal(args[1],GATEWAY_SERVICE);return `LoadState=loaded\nFragmentPath=${paths.unit}\nDropInPaths=\nNeedDaemonReload=${reloaded?'no':'yes'}\nWorkingDirectory=/opt/blackspire-command/releases/${reloaded?releaseSha:P.releaseSha}`;}};
 return {root,input,paths,deps,old,next,put,events,record,newHeld,beginCandidate,addRecord,switchPointer,setStopped:v=>stopped=v,setReloadFailure:()=>failReload=true,setRunning:()=>{if(!events.length)beginCandidate();if(!fs.existsSync(record))addRecord();switchPointer();stopped=false;newHeld();},driftProfile:()=>profileVersion++,counts:()=>({renames,reloads}),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
