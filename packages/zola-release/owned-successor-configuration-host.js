import {successorRuntimePredecessor} from './successor-runtime-predecessor.js';
import {MIXED_RETIREMENT} from './mixed-retirement-history.js';
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
import {lookupBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
import {prepareOwnedZolaConfigurationInstall,installZolaConfiguration} from './configuration-install.js';
import {OWNED_CONFIG_PREDECESSOR,buildInheritedOwnedFrontend,renderOwnedSuccessorLiveWriter} from './owned-successor-configuration.js';
const PREP='/var/lib/blackspire-operator/preparation',ROOT='/var/lib/blackspire-operator/owned-successor-configuration';
const liveGateway='/etc/blackspire-buyer-writer-gateway/gateway.json',liveDropin='/etc/systemd/system/blackspire-command.service.d/40-zola-writer.conf';
const credential=PREP+'/owned-gateway-provisioning.json',source=PREP+'/owned-source-v1.json';
const fail=()=>{throw new Error('Owned successor host refused');};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),same=(a,b)=>hash(a)===hash(b),bytes=v=>JSON.stringify(v)+'\n';
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',timeout:5000,maxBuffer:8192,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim();
const rootRead=file=>{const value=readOwnedConfigurationBytes(file);return value===null?null:JSON.parse(value);};
function directory(){try{fs.mkdirSync(ROOT,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}for(let p=ROOT;;p=path.dirname(p)){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)||run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',p])!=='')fail();if(p===ROOT&&(s.gid!==0||(s.mode&0o7777)!==0o700))fail();const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(p==='/')break;}}
function retained(file){const a=rootRead(file),b=rootRead(file+'.owned-buyer-stage');if(a!==null&&b!==null)fail();return a??b;}
const file=sha=>{if(!/^[a-f0-9]{40}$/.test(sha??''))fail();return ROOT+'/'+sha+'.json';};
export function publishOwnedSuccessorLiveWriter({before,after,gatewayGid,paths={gateway:liveGateway,dropin:liveDropin}},{publish=publishOwnedConfigurationBytes}={}){
 if(!before||!after||!Number.isSafeInteger(gatewayGid)||gatewayGid<1)fail();publish(paths.gateway,before.gateway,after.gateway,{gid:gatewayGid,mode:0o640});publish(paths.dropin,before.dropin,after.dropin,{mode:0o644});
}

// Read-only exact publication attestation. No SQL, fsync, service or artifact mutation.
export function verifyOwnedSuccessorWriterPublication(plan,{credentialGroupId,read=readOwnedConfigurationBytes}={}){
 if(!Number.isSafeInteger(credentialGroupId)||credentialGroupId<1)fail();
 const exact=(name,value,options={})=>{if(read(name,options)!==bytes(value))fail();};
 exact(source,plan.before.source);exact(credential,plan.candidate.credentialSource);
 exact(PREP+'/owned-buyer-writer-v4-'+plan.input.releaseSha+'.json',plan.candidate.gateway);
 const rendered=plan.candidate.rendered,live=renderOwnedSuccessorLiveWriter(rendered),digest=value=>createHash('sha256').update(value).digest('hex');
 const manifest={schema:1,kind:'zola_installed_buyer_writer',releaseSha:plan.input.releaseSha,artifactDigest:plan.evidence.artifactDigest,workspace:'blackspire-command'};
 for(const kind of ['client','ingress','signer']){const value=rendered[kind+'Config'],content=bytes(value),name='/etc/blackspire/buyer-writer-'+kind+'-'+digest(content)+'.json';exact(name,value,{gid:credentialGroupId,mode:0o640});manifest[kind+'Config']={path:name,digest:digest(content)};}
 if(read(liveGateway,{gid:plan.before.live.gatewayGid,mode:0o640})!==live.gateway||read(liveDropin,{mode:0o644})!==live.dropin)fail();
 manifest.gatewayConfig={path:liveGateway,digest:digest(live.gateway)};manifest.serviceDropin={path:liveDropin,digest:digest(live.dropin)};
 const manifestPath='/etc/blackspire/zola-installed-'+plan.input.releaseSha+'.json';exact(manifestPath,manifest);
 exact(file(plan.input.releaseSha)+'.configuration_install_verified.json',{event:'configuration_install_verified',releaseSha:plan.input.releaseSha,manifestPath,manifestDigest:digest(bytes(manifest))});
 return true;
}

// Caller must hold the global commander lock across prepare/publication. No SQL
// writes, credential generation, service starts or initial provisioning occur here.
export function createOwnedSuccessorConfigurationHost({verifyRetirement,verifyLineage}){
 if(process.getuid?.()!==0||typeof verifyRetirement!=='function'||typeof verifyLineage!=='function')fail();
 const profileSnapshot=readRootOwnedJsonSnapshot('/etc/blackspire/owned-postgres/profile.json',{groupId:0});
 const assertStoppedHeld=input=>{verifyOwnedBuyerMigrationQuiescence();if(input.previousReleaseSha!==successorRuntimePredecessor(input.releaseSha).releaseSha||databaseProfileDigest(readOwnedDatabaseProfile())!==input.profileDigest||!same(profileSnapshot,readRootOwnedJsonSnapshot('/etc/blackspire/owned-postgres/profile.json',{groupId:0})))fail();
  const stateFile='/etc/blackspire/release-admission/state.json',state=validateReleaseAdmissionState(readRootOwnedJsonSnapshot(stateFile,{groupId:fs.statSync(stateFile).gid}).value);if(state.mode!=='held'||![input.previousReleaseSha,input.releaseSha].includes(state.releaseSha))fail();};
 return {
  assertStoppedHeld,
  async verifyEvidence(input){assertStoppedHeld(input);const old=await inspectBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+input.previousReleaseSha,releaseSha:input.previousReleaseSha,environment:'production'}),next=await inspectSealedBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+input.releaseSha,releaseSha:input.releaseSha,environment:'production'});
   const receiver=rootRead(PREP+'/receiver-origin.json');if(receiver?.releaseSha!==input.releaseSha||receiver.frontendOrigin!==input.frontendOrigin)fail();await observeReceiverDeployment({releaseSha:input.releaseSha,mode:'preview',origin:receiver.frontendOrigin,deploymentId:receiver.deploymentId});
   const retirement=await verifyRetirement(input),lineage=await verifyLineage(input);assertStoppedHeld(input);return{retirement,lineage,previousArtifactDigest:old.artifactDigest,artifactDigest:next.artifactDigest};},
  readPlan:sha=>retained(file(sha)),
  readFinalPlan:sha=>{const value=rootRead(file(sha));if(rootRead(file(sha)+'.owned-buyer-stage')!==null)fail();return value;},
  readRecord(sha,suffix,{final=false}={}){if(!['intent','result','restore-intent','restore-result'].includes(suffix))fail();const name=file(sha)+'.'+suffix+'.json';if(final){if(rootRead(name+'.owned-buyer-stage')!==null)fail();return rootRead(name);}return retained(name);},
  async observeWriter(plan){if(databaseProfileDigest(readOwnedDatabaseProfile())!==plan.input.profileDigest||!same(profileSnapshot,readRootOwnedJsonSnapshot('/etc/blackspire/owned-postgres/profile.json',{groupId:0})))fail();const ids=await lookupBuyerWriterIdentity();verifyOwnedSuccessorWriterPublication(plan,{credentialGroupId:ids.credentialGroupId});},
  retainPlan(plan){directory();publishOwnedConfigurationBytes(file(plan.input.releaseSha),null,bytes(plan));},
  readWriterInputs(previous){if(previous!==OWNED_CONFIG_PREDECESSOR&&previous!==MIXED_RETIREMENT.releaseSha)fail();const gateway=rootRead(PREP+'/owned-buyer-writer-v4-'+previous+'.json'),rendered=renderZolaGatewayConfigurations(gateway);
   const group=run('/usr/bin/getent',['group','blackspire-writer']).split(':');if(group.length!==4||group[0]!=='blackspire-writer'||!Number.isSafeInteger(Number(group[2])))fail();
   const installed=readRootOwnedJsonSnapshot('/etc/blackspire-buyer-writer-gateway/gateway.json',{groupId:Number(group[2])}).value;if(!same(installed,rendered.gatewayConfig))fail();
   const live=renderOwnedSuccessorLiveWriter(rendered),actualGateway=readOwnedConfigurationBytes(liveGateway,{gid:Number(group[2]),mode:0o640}),actualDropin=readOwnedConfigurationBytes(liveDropin,{mode:0o644});if(actualGateway!==live.gateway||actualDropin!==live.dropin)fail();
   return{profile:readOwnedDatabaseProfile(),credentialSource:rootRead(credential),source:rootRead(source),gateway,live:{...live,gatewayGid:Number(group[2])}};},
  assertSourceUnchanged:value=>{if(!same(rootRead(source),value))fail();},
  publishCredentialSource:(before,after)=>publishOwnedConfigurationBytes(credential,bytes(before),bytes(after)),
  publishGatewayCandidate:(sha,value)=>{file(sha);publishOwnedConfigurationBytes(PREP+'/owned-buyer-writer-v4-'+sha+'.json',null,bytes(value));},
  publishLiveWriter(plan){assertStoppedHeld(plan.input);const next=renderOwnedSuccessorLiveWriter(plan.candidate.rendered),before=plan.before.live;if(!before)fail();publishOwnedSuccessorLiveWriter({before,after:next,gatewayGid:before.gatewayGid});assertStoppedHeld(plan.input);},
  restoreLiveWriter(plan){assertStoppedHeld(plan.input);const next=renderOwnedSuccessorLiveWriter(plan.candidate.rendered),before=plan.before.live;publishOwnedSuccessorLiveWriter({before:next,after:before,gatewayGid:before.gatewayGid});assertStoppedHeld(plan.input);},
  async installWriter(plan){assertStoppedHeld(plan.input);const install=await prepareOwnedZolaConfigurationInstall({releaseSha:plan.input.releaseSha,configurationFile:PREP+'/owned-buyer-writer-v4-'+plan.input.releaseSha+'.json'});const result=await installZolaConfiguration(install,{record:event=>{if(!['configuration_install_intent','configuration_install_verified'].includes(event.event)||event.releaseSha!==plan.input.releaseSha)fail();publishOwnedConfigurationBytes(file(plan.input.releaseSha)+'.'+event.event+'.json',null,bytes(event));}});assertStoppedHeld(plan.input);return result;},
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
