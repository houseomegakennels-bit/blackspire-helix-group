import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectBuyerWriterArtifact,inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {readOwnedDatabaseProfile,databaseProfileDigest} from '../buyer-writer/database-profile.js';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {verifyOwnedBuyerMigrationQuiescence} from '../buyer-writer/owned-migration-host.js';
import {validateReleaseAdmissionState} from '../shared/release-admission.js';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
import {renderZolaGatewayConfigurations} from './gateway-configuration-render.js';
import {OWNED_CONFIG_PREDECESSOR,buildInheritedOwnedFrontend} from './owned-successor-configuration.js';
const PREP='/var/lib/blackspire-operator/preparation',ROOT='/var/lib/blackspire-operator/owned-successor-configuration';
const credential=PREP+'/owned-gateway-provisioning.json',source=PREP+'/owned-source-v1.json';
const fail=()=>{throw new Error('Owned successor host refused');};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),same=(a,b)=>hash(a)===hash(b),bytes=v=>JSON.stringify(v)+'\n';
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',timeout:5000,maxBuffer:8192,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim();
const rootRead=file=>{const value=readOwnedConfigurationBytes(file);return value===null?null:JSON.parse(value);};
function directory(){try{fs.mkdirSync(ROOT,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}for(let p=ROOT;;p=path.dirname(p)){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)||run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',p])!=='')fail();if(p===ROOT&&(s.gid!==0||(s.mode&0o7777)!==0o700))fail();const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(p==='/')break;}}
function retained(file){const a=rootRead(file),b=rootRead(file+'.owned-buyer-stage');if(a!==null&&b!==null)fail();return a??b;}
const file=sha=>{if(!/^[a-f0-9]{40}$/.test(sha??''))fail();return ROOT+'/'+sha+'.json';};
// Caller must hold the global commander lock across prepare/publication. No SQL
// writes, credential generation, service starts or initial provisioning occur here.
export function createOwnedSuccessorConfigurationHost({verifyRetirement,verifyLineage}){
 if(process.getuid?.()!==0||typeof verifyRetirement!=='function'||typeof verifyLineage!=='function')fail();
 directory();const profileSnapshot=readRootOwnedJsonSnapshot('/etc/blackspire/owned-postgres/profile.json',{groupId:0});
 const assertStoppedHeld=input=>{verifyOwnedBuyerMigrationQuiescence();if(input.previousReleaseSha!==OWNED_CONFIG_PREDECESSOR||databaseProfileDigest(readOwnedDatabaseProfile())!==input.profileDigest||!same(profileSnapshot,readRootOwnedJsonSnapshot('/etc/blackspire/owned-postgres/profile.json',{groupId:0})))fail();
  const stateFile='/etc/blackspire/release-admission/state.json',state=validateReleaseAdmissionState(readRootOwnedJsonSnapshot(stateFile,{groupId:fs.statSync(stateFile).gid}).value);if(state.mode!=='held'||![input.previousReleaseSha,input.releaseSha].includes(state.releaseSha))fail();};
 return {
  assertStoppedHeld,
  async verifyEvidence(input){assertStoppedHeld(input);const old=await inspectBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+input.previousReleaseSha,releaseSha:input.previousReleaseSha,environment:'production'}),next=await inspectSealedBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+input.releaseSha,releaseSha:input.releaseSha,environment:'production'});
   const receiver=rootRead(PREP+'/receiver-origin.json');if(receiver?.releaseSha!==input.releaseSha||receiver.frontendOrigin!==input.frontendOrigin)fail();await observeReceiverDeployment({releaseSha:input.releaseSha,mode:'preview',origin:receiver.frontendOrigin,deploymentId:receiver.deploymentId});
   const retirement=await verifyRetirement(input),lineage=await verifyLineage(input);assertStoppedHeld(input);return{retirement,lineage,previousArtifactDigest:old.artifactDigest,artifactDigest:next.artifactDigest};},
  readPlan:sha=>retained(file(sha)),
  retainPlan(plan){directory();publishOwnedConfigurationBytes(file(plan.input.releaseSha),null,bytes(plan));},
  readWriterInputs(previous){if(previous!==OWNED_CONFIG_PREDECESSOR)fail();const gateway=rootRead(PREP+'/owned-buyer-writer-v4-'+previous+'.json'),rendered=renderZolaGatewayConfigurations(gateway);
   const group=run('/usr/bin/getent',['group','blackspire-writer']).split(':');if(group.length!==4||group[0]!=='blackspire-writer'||!Number.isSafeInteger(Number(group[2])))fail();
   const installed=readRootOwnedJsonSnapshot('/etc/blackspire-buyer-writer-gateway/gateway.json',{groupId:Number(group[2])}).value;if(!same(installed,rendered.gatewayConfig))fail();
   return{profile:readOwnedDatabaseProfile(),credentialSource:rootRead(credential),source:rootRead(source),gateway};},
  assertSourceUnchanged:value=>{if(!same(rootRead(source),value))fail();},
  publishCredentialSource:(before,after)=>publishOwnedConfigurationBytes(credential,bytes(before),bytes(after)),
  publishGatewayCandidate:(sha,value)=>{file(sha);publishOwnedConfigurationBytes(PREP+'/owned-buyer-writer-v4-'+sha+'.json',null,bytes(value));},
  record(plan,suffix,value){if(!['intent','result','restore-intent','restore-result'].includes(suffix))fail();directory();publishOwnedConfigurationBytes(file(plan.input.releaseSha)+'.'+suffix+'.json',null,bytes(value));},
 };
}
export async function prepareInheritedOwnedFrontend({releaseSha},{transport,verifySuccessorArtifact}){
 if(process.getuid?.()!==0||typeof verifySuccessorArtifact!=='function')fail();await verifySuccessorArtifact(releaseSha);
 const frontendRoot=PREP+'/owned-buyer-configuration',frontendPlan=rootRead(frontendRoot+'/frontend-plan.json'),rows=await transport.observe(),results={};
 for(const scope of ['preview','production'])for(const key of ['BLACKSPIRE_BUYER_STORE_MODE','BLACKSPIRE_BUYER_STORE_URL','BLACKSPIRE_BUYER_DEAL_CONTEXT_KEY']){const name=scope+'-'+key.toLowerCase();results[name]=rootRead(frontendRoot+'/'+name+'.result.json');}
 const proof=buildInheritedOwnedFrontend({previousReleaseSha:OWNED_CONFIG_PREDECESSOR,releaseSha,frontendPlan,rows,results});
 if(!same(rows,await transport.observe())||!same(frontendPlan,rootRead(frontendRoot+'/frontend-plan.json')))fail();await verifySuccessorArtifact(releaseSha);directory();publishOwnedConfigurationBytes(ROOT+'/'+releaseSha+'-frontend.json',null,bytes(proof));return proof;
}
