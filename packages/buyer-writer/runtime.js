import {resolveBuyerWriterIdentity} from './runtime-identity.js';
import {readRootOwnedJson} from './protected-json.js';
import {validateBuyerWriterClientConfiguration,validateBuyerWriterConfiguration} from './configuration.js';
import {createBuyerWriterLocalClient} from './local-gateway-client.js';
import {createBuyerWriterAdmittedLocalClient} from './admitted-local-client.js';
import {createOperationPermitSigner,validateOperationPermitSigningConfiguration} from './operation-permit-signer.js';
import {createBuyerWriterBindingObserver} from './binding.js';
import {createBuyerWriterRuntimeInspector} from './runtime-inspection.js';
import {createBuyerWriterAvailability,createBuyerWriterPreparation} from './availability.js';
import {createBuyerWriterRequestHandler} from './http.js';
import {validateBuyerWriterRehearsal} from './rehearsal.js';

// Explicit API-only composition. A missing activation binding denies operations
// but does not prevent API boot, so the worker can start before root approval.
export async function createBuyerWriterRuntime({backendProfile,profileDigest,configurationFile,clientConfigurationFile,ingressConfigurationFile,signerConfigurationFile,workspace,releaseSha,apiGeneration,environment,startup,getHealth,getReadiness,
  resolveIdentity=resolveBuyerWriterIdentity,readConfiguration=readRootOwnedJson,createPostgres,createClient=createBuyerWriterLocalClient,
  createSigner=createOperationPermitSigner,createAdmittedClient=createBuyerWriterAdmittedLocalClient,createBinding=createBuyerWriterBindingObserver}) {
  let database;
  try {
    const legacyTestTransport=typeof createPostgres==='function';
    if((legacyTestTransport?typeof configurationFile!=='string':typeof clientConfigurationFile!=='string'||typeof ingressConfigurationFile!=='string'
        ||typeof signerConfigurationFile!=='string')
      ||typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
      ||!/^[a-f0-9]{40}$/.test(releaseSha??'')||!/^[a-f0-9]{32}$/.test(apiGeneration??'')
      ||!['production','staging','disposable-staging'].includes(environment)
      ||[getHealth,getReadiness,resolveIdentity,readConfiguration,createClient,createBinding].some(value=>typeof value!=='function'))throw new Error();
    const identity=await resolveIdentity();
    const input=readConfiguration(legacyTestTransport?configurationFile:clientConfigurationFile,{groupId:identity.credentialGroupId,maxBytes:65536});
    let rehearsal;
    if(legacyTestTransport&&input?.rehearsalFile!==undefined){
      if(typeof input.rehearsalFile!=='string'||!/^\/var\/lib\/blackspire-zola-rehearsal\/activation\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/config\/rehearsal\.json$/.test(input.rehearsalFile))throw new Error();
      rehearsal=validateBuyerWriterRehearsal(readConfiguration(input.rehearsalFile,{groupId:identity.credentialGroupId,maxBytes:4096}),input,
        {configurationFile,workspace,releaseSha,environment,startup});
    }
    if(legacyTestTransport&&environment==='production'&&!rehearsal)throw new Error();
    let config,ingress;
    if(legacyTestTransport){
      // Explicit dependency injection is retained only for disposable/operator
      // tests. No production composition imports or defaults to PostgreSQL.
      config=validateBuyerWriterConfiguration(input,{workspace,environment,rehearsal});
      if(config.bindingFile===configurationFile)throw new Error();
      database=await createPostgres({runtime:config.runtime,issuer:config.issuer,creatorOid:config.creatorOid});
      ingress=config;
    }else{
      config=validateBuyerWriterClientConfiguration(input,{workspace,environment});
      if(config.authority.releaseSha!==releaseSha)throw new Error();
      const value=readConfiguration(ingressConfigurationFile,{groupId:identity.credentialGroupId,maxBytes:4096});
      const keys=['version','workspace','bindingFile','writerCredential','issuerCredential'];
      const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)&&Buffer.from(v,'base64url').length===32;
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))
        ||value.version!==1||value.workspace!==workspace||typeof value.bindingFile!=='string'||!value.bindingFile.startsWith('/')
        ||!opaque(value.writerCredential)||!opaque(value.issuerCredential)||value.writerCredential===value.issuerCredential)throw new Error();
      ingress=Object.freeze({...value});
      const signerInput=readConfiguration(signerConfigurationFile,{groupId:identity.credentialGroupId,maxBytes:16384});
      const signerKeys=['version','operationPermitConfiguration','signer'];
      if(!signerInput||typeof signerInput!=='object'||Array.isArray(signerInput)
        ||Object.keys(signerInput).length!==signerKeys.length||signerKeys.some(key=>!Object.hasOwn(signerInput,key))
        ||signerInput.version!==1||typeof signerInput.operationPermitConfiguration!=='string'
        ||signerInput.operationPermitConfiguration.length<2||signerInput.operationPermitConfiguration.length>4096)throw new Error();
      const permit=JSON.parse(signerInput.operationPermitConfiguration);
      if(JSON.stringify(permit)!==signerInput.operationPermitConfiguration
        ||permit.releaseSha!==config.authority.releaseSha||permit.operationId!==config.authority.operationId
        ||permit.attemptId!==config.authority.attemptId||permit.workspace!==workspace)throw new Error();
      const signer=createSigner(signerInput.signer,{expectedUid:identity.uid});
      validateOperationPermitSigningConfiguration(permit,signer.activeKeyId);
      if(signer.activeKeyId!==permit.keyId)throw new Error();
      const client=createClient({socketPath:config.socketPath,capability:config.gatewayCapability,authority:config.authority});
      database=client;
      database=createAdmittedClient({client,signer,configuration:permit});
    }
    const units=legacyTestTransport&&config.units?{apiUnit:config.units.api,workerUnit:config.units.worker}:{};
    const bindingOptions={filename:ingress.bindingFile,credentialGroupId:identity.credentialGroupId,workspace,releaseSha,apiGeneration,
      apiUid:identity.uid,workerUid:identity.workerUid,...units,inspectRuntime:createBuyerWriterRuntimeInspector(units)};
    const observeBinding=createBinding(bindingOptions);
    const available=createBuyerWriterAvailability({workspace,releaseSha,apiGeneration,environment,getHealth,getReadiness,observeBinding});
    const prepared=createBuyerWriterPreparation({backendProfile,profileDigest,workspace,releaseSha,apiGeneration,environment,getHealth,getReadiness,
      observeBinding:createBinding({...bindingOptions,requireCommit:false})});
    let closed=false,closing;
    const checkAvailability=async()=>{
      try {return !closed&&database.isHealthy()===true
        &&(typeof database.checkAvailability!=='function'||await database.checkAvailability()===true)
        &&await available()===true&&!closed&&database.isHealthy()===true;}
      catch{return false;}
    };
    const checkPreparation=async()=>{
      try{return !closed&&database.isHealthy()===true
        &&(typeof database.checkAvailability!=='function'||await database.checkAvailability()===true)
        &&await prepared()===true&&!closed&&database.isHealthy()===true;}
      catch{return false;}
    };
    const handler=createBuyerWriterRequestHandler({credential:ingress.writerCredential,workspace,query:database.runtimeQuery,isAvailable:checkAvailability,
      isPrepared:checkPreparation,issuer:{credential:ingress.issuerCredential,query:database.issuerQuery}});
    return Object.freeze({...handler,checkAvailability,checkPreparation,isHealthy:()=>!closed&&database.isHealthy()===true,close:()=>{
      if(closing)return closing;
      closed=true;handler.stopAdmission();
      closing=Promise.resolve().then(async()=>{
        // A disconnected client may still own a database query. Give admitted
        // work a bounded drain before pool closure; forced closure is an unknown
        // transaction outcome and must be reconciled through the receipt ledger.
        const deadline=performance.now()+2000;
        while(!handler.isDrained()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
        await database.close();
      });return closing;
    }});
  }catch{
    if(database){try{await database.close();}catch{}}
    throw new Error('Buyer writer runtime initialization failed');
  }
}
