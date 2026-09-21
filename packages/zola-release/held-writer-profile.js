import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {lookupBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
import {createBuyerWriterRuntimeInspector} from '../buyer-writer/runtime-inspection.js';
import {captureBuyerWriterServiceProcesses} from '../buyer-writer/process-collector.js';
import {validateBuyerWriterClientConfiguration} from '../buyer-writer/configuration.js';
import {validateBuyerWriterGatewayServiceConfiguration} from '../buyer-writer/gateway-entry.js';
import {createOperationPermitSigner,validateOperationPermitSigningConfiguration} from '../buyer-writer/operation-permit-signer.js';
import {installedBuyerWriterManifestPath} from './installed-buyer-writer.js';
import {hash} from './commander-journal.js';
const fail=()=>{throw new Error('HELD writer installed profile rejected');};
const exact=(v,k)=>v&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
const options={encoding:'utf8',timeout:2000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','pipe','pipe']};
// All credentials remain private to this call. Only digests enter journal plans.
export async function collectInstalledHeldWriterProfile(releaseSha,{io=fs,run=execFileSync,readSnapshot=readRootOwnedJsonDigestSnapshot,
 resolveIdentity=lookupBuyerWriterIdentity,capture=captureBuyerWriterServiceProcesses,inspectFactory=createBuyerWriterRuntimeInspector,
 configDirectory='/etc/blackspire',gatewayDirectory='/etc/blackspire-buyer-writer-gateway',unitDirectory='/etc/systemd/system'}={}){
 try{
 if(process.getuid()!==0||!/^[a-f0-9]{40}$/.test(releaseSha??''))fail();
 const identity=await resolveIdentity(),snapshots=[];
 const read=(file,groupId,maxBytes=65536)=>{const snapshot=readSnapshot(file,{groupId,maxBytes});snapshots.push({file,groupId,maxBytes,snapshot});return snapshot;};
 const manifest=read(installedBuyerWriterManifestPath(releaseSha,{configDirectory}),0,16384).value;
 if(!exact(manifest,['schema','kind','releaseSha','artifactDigest','workspace','clientConfig','ingressConfig','signerConfig','gatewayConfig','serviceDropin'])
  ||manifest.schema!==1||manifest.kind!=='zola_installed_buyer_writer'||manifest.releaseSha!==releaseSha||manifest.workspace!=='blackspire-command'||!/^[a-f0-9]{64}$/.test(manifest.artifactDigest))fail();
 for(const key of ['clientConfig','ingressConfig','signerConfig','gatewayConfig','serviceDropin']){
  const ref=manifest[key];if(!exact(ref,['path','digest'])||!/^[a-f0-9]{64}$/.test(ref.digest))fail();
  if(['clientConfig','ingressConfig','signerConfig'].includes(key)&&(path.dirname(ref.path)!==configDirectory||!new RegExp('^buyer-writer-'+key.replace('Config','')+'-[a-f0-9]{64}\\.json$').test(path.basename(ref.path))))fail();
 }
 if(manifest.gatewayConfig.path!==path.join(gatewayDirectory,'gateway.json')||manifest.serviceDropin.path!==path.join(unitDirectory,'blackspire-command.service.d/40-zola-writer.conf'))fail();
 const group=run('/usr/bin/getent',['group','blackspire-writer'],options).trim().split(':');if(group.length!==4||group[0]!=='blackspire-writer'||!/^[1-9][0-9]*$/.test(group[2]))fail();
 const values={};for(const key of ['clientConfig','ingressConfig','signerConfig','gatewayConfig']){const ref=manifest[key],s=read(ref.path,key==='gatewayConfig'?Number(group[2]):identity.credentialGroupId);if(s.digest!==ref.digest)fail();values[key]=s.value;}
 const client=validateBuyerWriterClientConfiguration(values.clientConfig,{workspace:manifest.workspace,environment:'production'}),ingress=values.ingressConfig,signing=values.signerConfig;
 const gateway=validateBuyerWriterGatewayServiceConfiguration(values.gatewayConfig);
 if(client.authority.releaseSha!==releaseSha||JSON.stringify(client.authority)!==JSON.stringify(gateway.authority)||gateway.workspace!==manifest.workspace)fail();
 const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
 if(!exact(ingress,['version','workspace','bindingFile','writerCredential','issuerCredential'])||ingress.version!==1||ingress.workspace!==manifest.workspace||ingress.bindingFile!==path.join(configDirectory,'buyer-writer-binding.json')
  ||!opaque(ingress.writerCredential)||!opaque(ingress.issuerCredential)||ingress.writerCredential===ingress.issuerCredential)fail();
 if(!exact(signing,['version','operationPermitConfiguration','signer'])||signing.version!==1)fail();
 const permit=JSON.parse(signing.operationPermitConfiguration),signer=createOperationPermitSigner(signing.signer,{expectedUid:identity.uid});
 validateOperationPermitSigningConfiguration(permit,signer.activeKeyId);
 if(JSON.stringify(permit)!==signing.operationPermitConfiguration||permit.releaseSha!==releaseSha||permit.workspace!==manifest.workspace||permit.operationId!==client.authority.operationId||permit.attemptId!==client.authority.attemptId||permit.keyId!==signer.activeKeyId)fail();
 const dropin=io.readFileSync(manifest.serviceDropin.path),dropinStat=io.lstatSync(manifest.serviceDropin.path);
 if(!dropinStat.isFile()||dropinStat.isSymbolicLink()||dropinStat.uid!==0||dropinStat.nlink!==1||(dropinStat.mode&0o7777)!==0o644||hash(dropin.toString())!==manifest.serviceDropin.digest)fail();
 const main=Number(run('/usr/bin/systemctl',['show','--no-pager','--property=MainPID','--value','--','blackspire-command.service'],options).trim());
 const artifactRoot='/opt/blackspire-command/releases/'+releaseSha,api=capture({mainPid:main,role:'api',artifactRoot,controlGroup:'/system.slice/blackspire-command.service'});
 const context={filename:ingress.bindingFile,credentialGroupId:identity.credentialGroupId,workspace:manifest.workspace,releaseSha,
  apiGeneration:'',apiUid:identity.uid,apiPid:api.child.pid,workerUid:identity.workerUid,apiUnit:'blackspire-command.service',workerUnit:'blackspire-command-worker.service',artifactRoot,environment:'production',host:'127.0.0.1',port:8789};
 const runtime=await inspectFactory(context)();context.apiGeneration=runtime.api.invocationId;
 for(const s of snapshots)if(JSON.stringify(s.snapshot)!==JSON.stringify(readSnapshot(s.file,{groupId:s.groupId,maxBytes:s.maxBytes})))fail();
 if(!io.readFileSync(manifest.serviceDropin.path).equals(dropin))fail();
 return {context,artifactDigest:manifest.artifactDigest,workerGeneration:runtime.worker.invocationId,configurationDigest:hash(snapshots.map(s=>({file:s.file,digest:s.snapshot.digest}))),preparationCredential:ingress.issuerCredential};
 }catch{fail();}
}
