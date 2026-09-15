import {commitBuyerWriterBinding} from './commit-file.js';
import {checkBuyerWriterActivationReadiness} from './activation-readiness.js';
import {pathToFileURL} from 'node:url';
import {verifyBuyerWriterActivationContainer} from './activation-container.js';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {createBuyerWriterRuntimeInspector} from './runtime-inspection.js';
import {resolveBuyerWriterIdentity} from './runtime-identity.js';
import {validateBuyerWriterConfiguration} from './configuration.js';
import {validateBuyerWriterRehearsal} from './rehearsal.js';
import {publishVerifiedBuyerWriterActivation} from './activation.js';
import {publishBuyerWriterBinding} from './activation-file.js';

export async function activateBuyerWriterFromProfile({filename,verifyContainer=verifyBuyerWriterActivationContainer,readSnapshot=readRootOwnedJsonSnapshot,
  inspectRuntimeFactory=createBuyerWriterRuntimeInspector,resolveIdentity=resolveBuyerWriterIdentity,activate=publishVerifiedBuyerWriterActivation,publish=publishBuyerWriterBinding,commit=commitBuyerWriterBinding,checkReadiness=checkBuyerWriterActivationReadiness}){
  try{
    await verifyContainer();
    const snapshots=[];
    const load=(file,groupId,maxBytes)=>{
      const options={groupId,maxBytes},snapshot=readSnapshot(file,options);
      snapshots.push({file,options,fingerprint:JSON.stringify(snapshot)});return snapshot.value;
    };
    const profile=load(filename,0,16384);
    if(!profile||profile.version!==1||typeof profile.configurationFile!=='string'||!profile.context
      ||Object.keys(profile).some(key=>!['version','configurationFile','context','startup'].includes(key)))throw new Error();
    const context=profile.context,inspectRuntime=inspectRuntimeFactory(context),runtime=await inspectRuntime();
    // Root observes the actual API process first; NSS then verifies that this
    // process really has the fixed API identity and private credential group.
    const identity=await resolveIdentity({uid:runtime.api.uid,euid:runtime.api.euid,gid:runtime.api.gid,egid:runtime.api.egid,groups:runtime.api.groups});
    if(identity.uid!==context.apiUid||identity.workerUid!==context.workerUid||identity.credentialGroupId!==context.credentialGroupId)throw new Error();
    const input=load(profile.configurationFile,identity.credentialGroupId,65536);
    let rehearsal;
    if(input?.rehearsalFile!==undefined){
      if(typeof input.rehearsalFile!=='string'||!/^\/var\/lib\/blackspire-zola-rehearsal\/activation\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/config\/rehearsal\.json$/.test(input.rehearsalFile))throw new Error();
      rehearsal=validateBuyerWriterRehearsal(load(input.rehearsalFile,identity.credentialGroupId,4096),input,
        {configurationFile:profile.configurationFile,workspace:context.workspace,releaseSha:context.releaseSha,environment:context.environment,startup:profile.startup});
    }
    const config=validateBuyerWriterConfiguration(input,{workspace:context.workspace,environment:context.environment,rehearsal});
    if(config.bindingFile!==context.filename||context.apiUnit!==(config.units?.api??'blackspire-command.service')
      ||context.workerUnit!==(config.units?.worker??'blackspire-command-worker.service'))throw new Error();
    const unchanged=()=>{
      for(const snapshot of snapshots)if(JSON.stringify(readSnapshot(snapshot.file,snapshot.options))!==snapshot.fingerprint)throw new Error();
    };
    unchanged();
    return await activate({context,inspectRuntime,
      checkReadiness:options=>checkReadiness({...options,preparationCredential:config.issuerCredential}),
      commit:options=>commit({...options,beforeCommit:unchanged}),publish:options=>publish({...options,verify:async target=>{
      unchanged();const proof=await options.verify(target);unchanged();return proof;
    }})});
  }catch(error){
    if(error?.message==='Buyer writer activation outcome unknown')throw new Error('Buyer writer activation outcome unknown');
    throw new Error(['Buyer writer activation cleanup incomplete','Buyer writer binding publication cleanup incomplete'].includes(error?.message)
      ?'Buyer writer activation cleanup incomplete':'Buyer writer activation command rejected');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3)throw new Error();
    const result=await activateBuyerWriterFromProfile({filename:process.argv[2]});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){
    const message=['Buyer writer activation cleanup incomplete','Buyer writer activation outcome unknown'].includes(error?.message)?error.message:'Buyer writer activation command rejected';
    process.stderr.write(message+'\n');
    process.exitCode=1;
  }
}
