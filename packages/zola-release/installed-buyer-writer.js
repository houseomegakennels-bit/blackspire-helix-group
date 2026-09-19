import path from 'node:path';
import {readRootOwnedJsonDigestSnapshot} from '../buyer-writer/protected-json.js';
import {resolveBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
import {validateBuyerWriterClientConfiguration} from '../buyer-writer/configuration.js';
import {createBuyerWriterLocalClient} from '../buyer-writer/local-gateway-client.js';
import {createBuyerWriterAdmittedLocalClient} from '../buyer-writer/admitted-local-client.js';
import {createOperationPermitSigner,validateOperationPermitSigningConfiguration}
  from '../buyer-writer/operation-permit-signer.js';

const CONFIG_DIRECTORY='/etc/blackspire';
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const reject=()=>{throw new Error('Installed buyer writer unavailable');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const canonical=value=>typeof value==='string'&&value.length<=4096&&path.isAbsolute(value)
  &&path.resolve(value)===value&&value!=='/';

export function installedBuyerWriterManifestPath(releaseSha,{configDirectory=CONFIG_DIRECTORY}={}){
  if(!SHA.test(releaseSha??'')||!canonical(configDirectory))reject();
  return path.join(configDirectory,'zola-installed-'+releaseSha+'.json');
}

function fileReference(value,directory){
  if(!exact(value,['path','digest'])||!canonical(value.path)||!DIGEST.test(value.digest)
    ||path.dirname(value.path)!==directory)reject();
  return value;
}function validateManifest(value,{releaseSha,workspace,artifactDigest,configDirectory}){
  const keys=['schema','kind','releaseSha','artifactDigest','workspace','clientConfig',
    'ingressConfig','signerConfig','gatewayConfig','serviceDropin'];
  if(!exact(value,keys)||value.schema!==1||value.kind!=='zola_installed_buyer_writer'
    ||value.releaseSha!==releaseSha||value.workspace!==workspace
    ||!DIGEST.test(value.artifactDigest)
    ||artifactDigest!==undefined&&value.artifactDigest!==artifactDigest)reject();
  for(const key of ['clientConfig','ingressConfig','signerConfig'])
    fileReference(value[key],configDirectory);
  fileReference(value.gatewayConfig,path.dirname(value.gatewayConfig?.path??'/'));
  fileReference(value.serviceDropin,path.dirname(value.serviceDropin?.path??'/'));
  return value;
}

function signerConfiguration(value,client,workspace,createSigner,expectedUid){
  const keys=['version','operationPermitConfiguration','signer'];
  if(!exact(value,keys)||value.version!==1
    ||typeof value.operationPermitConfiguration!=='string'
    ||value.operationPermitConfiguration.length<2
    ||value.operationPermitConfiguration.length>4096)reject();
  const permit=JSON.parse(value.operationPermitConfiguration);
  if(JSON.stringify(permit)!==value.operationPermitConfiguration
    ||permit.releaseSha!==client.authority.releaseSha
    ||permit.operationId!==client.authority.operationId
    ||permit.attemptId!==client.authority.attemptId
    ||permit.workspace!==workspace)reject();
  const signer=createSigner(value.signer,{expectedUid});
  validateOperationPermitSigningConfiguration(permit,signer.activeKeyId);
  if(signer.activeKeyId!==permit.keyId)reject();
  return {permit,signer};
}export async function openInstalledBuyerWriterAdmittedClient({releaseSha,workspace,artifactDigest},{
  configDirectory=CONFIG_DIRECTORY,resolveIdentity=resolveBuyerWriterIdentity,
  readSnapshot=readRootOwnedJsonDigestSnapshot,createClient=createBuyerWriterLocalClient,
  createSigner=createOperationPermitSigner,createAdmittedClient=createBuyerWriterAdmittedLocalClient
}={}){
  let admitted,client;
  try{
    if(!SHA.test(releaseSha??'')||typeof workspace!=='string'
      ||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
      ||artifactDigest!==undefined&&!DIGEST.test(artifactDigest))reject();
    const identity=await resolveIdentity();
    const manifestFile=installedBuyerWriterManifestPath(releaseSha,{configDirectory});
    const manifestSnapshot=readSnapshot(manifestFile,{groupId:0,maxBytes:16384});
    const manifest=validateManifest(manifestSnapshot.value,
      {releaseSha,workspace,artifactDigest,configDirectory});
    const clientSnapshot=readSnapshot(manifest.clientConfig.path,
      {groupId:identity.credentialGroupId,maxBytes:65536});
    const signerSnapshot=readSnapshot(manifest.signerConfig.path,
      {groupId:identity.credentialGroupId,maxBytes:16384});
    if(clientSnapshot.digest!==manifest.clientConfig.digest
      ||signerSnapshot.digest!==manifest.signerConfig.digest)reject();
    const clientConfiguration=validateBuyerWriterClientConfiguration(clientSnapshot.value,
      {workspace,environment:'production'});
    if(clientConfiguration.authority.releaseSha!==releaseSha)reject();
    const signing=signerConfiguration(signerSnapshot.value,clientConfiguration,workspace,
      createSigner,identity.uid);
    client=createClient({socketPath:clientConfiguration.socketPath,
      capability:clientConfiguration.gatewayCapability,authority:clientConfiguration.authority});
    admitted=createAdmittedClient({client,signer:signing.signer,configuration:signing.permit});
    if(await admitted.checkAvailability()!==true)reject();
    return admitted;
  }catch{
    try{await (admitted??client)?.close();}catch{}
    reject();
  }
}
