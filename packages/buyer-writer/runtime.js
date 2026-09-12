import {resolveBuyerWriterIdentity} from './runtime-identity.js';
import {readRootOwnedJson} from './protected-json.js';
import {validateBuyerWriterConfiguration} from './configuration.js';
import {createBuyerWriterPostgres} from './postgres.js';
import {createBuyerWriterBindingObserver} from './binding.js';
import {createBuyerWriterRuntimeInspector} from './runtime-inspection.js';
import {createBuyerWriterAvailability} from './availability.js';
import {createBuyerWriterRequestHandler} from './http.js';
import {validateBuyerWriterRehearsal} from './rehearsal.js';

// Explicit API-only composition. A missing activation binding denies operations
// but does not prevent API boot, so the worker can start before root approval.
export async function createBuyerWriterRuntime({configurationFile,workspace,releaseSha,apiGeneration,environment,startup,getHealth,getReadiness,
  resolveIdentity=resolveBuyerWriterIdentity,readConfiguration=readRootOwnedJson,createPostgres=createBuyerWriterPostgres,createBinding=createBuyerWriterBindingObserver}) {
  let database;
  try {
    if(typeof configurationFile!=='string'||typeof workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(workspace)
      ||!/^[a-f0-9]{40}$/.test(releaseSha??'')||!/^[a-f0-9]{32}$/.test(apiGeneration??'')
      ||!['production','staging','disposable-staging'].includes(environment)
      ||[getHealth,getReadiness,resolveIdentity,readConfiguration,createPostgres,createBinding].some(value=>typeof value!=='function'))throw new Error();
    const identity=await resolveIdentity();
    const input=readConfiguration(configurationFile,{groupId:identity.credentialGroupId,maxBytes:65536});
    let rehearsal;
    if(input?.rehearsalFile!==undefined){
      if(typeof input.rehearsalFile!=='string'||!/^\/var\/lib\/blackspire-zola-rehearsal\/activation\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/config\/rehearsal\.json$/.test(input.rehearsalFile))throw new Error();
      rehearsal=validateBuyerWriterRehearsal(readConfiguration(input.rehearsalFile,{groupId:identity.credentialGroupId,maxBytes:4096}),input,
        {configurationFile,workspace,releaseSha,environment,startup});
    }
    const config=validateBuyerWriterConfiguration(input,{workspace,environment,rehearsal});
    if(config.bindingFile===configurationFile)throw new Error();
    database=await createPostgres({runtime:config.runtime,issuer:config.issuer});
    const units=config.units?{apiUnit:config.units.api,workerUnit:config.units.worker}:{};
    const bindingOptions={filename:config.bindingFile,credentialGroupId:identity.credentialGroupId,workspace,releaseSha,apiGeneration,
      apiUid:identity.uid,workerUid:identity.workerUid,...units,inspectRuntime:createBuyerWriterRuntimeInspector(units)};
    const observeBinding=createBinding(bindingOptions);
    const available=createBuyerWriterAvailability({workspace,releaseSha,apiGeneration,environment,getHealth,getReadiness,observeBinding});
    const prepared=createBuyerWriterAvailability({workspace,releaseSha,apiGeneration,environment,getHealth,getReadiness,
      observeBinding:createBinding({...bindingOptions,requireCommit:false})});
    let closed=false,closing;
    const checkAvailability=async()=>{
      try {return !closed&&database.isHealthy()===true&&await available()===true&&!closed&&database.isHealthy()===true;}
      catch{return false;}
    };
    const checkPreparation=async()=>{
      try{return !closed&&database.isHealthy()===true&&await prepared()===true&&!closed&&database.isHealthy()===true;}
      catch{return false;}
    };
    const handler=createBuyerWriterRequestHandler({credential:config.writerCredential,workspace,query:database.runtimeQuery,isAvailable:checkAvailability,
      isPrepared:checkPreparation,issuer:{credential:config.issuerCredential,query:database.issuerQuery}});
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
