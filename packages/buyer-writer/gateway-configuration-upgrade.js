import {assertOwnedGatewayConfigurationTransition} from './owned-gateway-transition.js';
import {createHash} from 'node:crypto';
import {validateBuyerWriterGatewayServiceConfiguration} from './gateway-entry.js';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const controlsRequired=[
  'assertQuiesced','prepareReplacement','publishReplacement',
  'verifyReplacement','restoreReplacement','finalizeReplacement',
];
const fail=(rollbackSafe=false)=>{
  const error=new Error('Buyer writer gateway configuration upgrade failed');
  error.rollbackSafe=rollbackSafe;
  throw error;
};
const digest=value=>createHash('sha256').update(JSON.stringify(value)+'\n').digest('hex');
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

function upgradePlan({releaseSha,operationId,attemptId,artifactDigest,candidateDigest,
  oldConfiguration,newConfiguration,controls,appendJournal,now,ownedProfile,ownedSource}){
  try{
    if(!SHA.test(releaseSha??'')||!UUID.test(operationId??'')||!UUID.test(attemptId??'')
      ||operationId===attemptId||!DIGEST.test(artifactDigest??'')||!DIGEST.test(candidateDigest??'')
      ||!controls||typeof controls!=='object'
      ||controlsRequired.some(name=>typeof controls[name]!=='function')
      ||typeof appendJournal!=='function'||typeof now!=='function')fail();
    const oldConfig=validateBuyerWriterGatewayServiceConfiguration(oldConfiguration);
    const newConfig=validateBuyerWriterGatewayServiceConfiguration(newConfiguration);
    if(ownedProfile)assertOwnedGatewayConfigurationTransition({oldConfiguration:oldConfig,newConfiguration:newConfig,ownedProfile,ownedSource,releaseSha,operationId,attemptId});
    else {
    if(oldConfig.version!==2||newConfig.version!==4||newConfig.mode!=='research-admission')fail();
    for(const key of ['workspace','socketPath','gatewayCapability','creatorOid'])
      if(oldConfig[key]!==newConfig[key])fail();
    for(const key of ['runtime','issuer'])if(!same(oldConfig[key],newConfig[key]))fail();
    }
    if(oldConfig.authority.releaseSha===newConfig.authority.releaseSha
      ||newConfig.authority.releaseSha!==releaseSha
      ||newConfig.authority.operationId!==operationId
      ||newConfig.authority.attemptId!==attemptId)fail();
    const oldConfigDigest=digest(oldConfig),newConfigDigest=digest(newConfig);
    if(oldConfigDigest===newConfigDigest)fail();
    return Object.freeze({releaseSha,operationId,attemptId,artifactDigest,candidateDigest,
      oldConfig,newConfig,oldConfigDigest,newConfigDigest,controls,appendJournal,now});
  }catch(error){
    if(error?.message==='Buyer writer gateway configuration upgrade failed')throw error;
    fail();
  }
}

async function record(state,phase,status='IN_PROGRESS'){
  await state.appendJournal({
    version:1,
    kind:'buyer_writer_gateway_configuration_upgrade',
    releaseSha:state.releaseSha,
    operationId:state.operationId,
    attemptId:state.attemptId,
    artifactDigest:state.artifactDigest,
    candidateDigest:state.candidateDigest,
    phase,
    status,
    oldConfigDigest:state.oldConfigDigest,
    newConfigDigest:state.newConfigDigest,
    updatedAt:new Date(state.now()).toISOString(),
  });
}
async function restoreOld(state,prepared){
  try{
    if(await state.controls.restoreReplacement(prepared,state.oldConfig)!==true)fail();
    if(await state.controls.verifyReplacement(state.oldConfig)!==true)fail();
    if(await state.controls.finalizeReplacement(prepared,'rollback')!==true)fail();
    await record(state,'rolled-back','ROLLED_BACK');
    return true;
  }catch{
    try{await record(state,'fail-closed','FAIL_CLOSED');}catch{}
    fail(false);
  }
}

export function inspectBuyerWriterGatewayConfigurationUpgrade({
  releaseSha,operationId,attemptId,artifactDigest,candidateDigest,
  oldConfiguration,newConfiguration,
}={}){
  const noop=async()=>true;
  const controls=Object.fromEntries(controlsRequired.map(name=>[name,noop]));
  const state=upgradePlan({
    releaseSha,operationId,attemptId,artifactDigest,candidateDigest,
    oldConfiguration,newConfiguration,controls,appendJournal:noop,now:Date.now,
  });
  return Object.freeze({
    status:'UPGRADE_PREPARED',
    releaseSha:state.releaseSha,
    operationId:state.operationId,
    attemptId:state.attemptId,
    artifactDigest:state.artifactDigest,
    candidateDigest:state.candidateDigest,
    oldConfigDigest:state.oldConfigDigest,
    newConfigDigest:state.newConfigDigest,
    requiresQuiescence:true,
    mutationEnabled:false,
  });
}
async function executeUpgrade(input){
  const state=upgradePlan(input);
  let prepared,published=false;
  try{
    await record(state,'started');
    if(await state.controls.assertQuiesced()!==true)fail();
    await record(state,'quiesced');
    prepared=await state.controls.prepareReplacement(state.oldConfig,state.newConfig);
    if(!prepared||typeof prepared!=='object')fail();
    await record(state,'prepared');
    if(await state.controls.publishReplacement(prepared,state.newConfig)!==true)fail();
    published=true;
    await record(state,'configuration-published');
    if(await state.controls.verifyReplacement(state.newConfig)!==true)fail();
    await record(state,'configuration-verified');
    if(await state.controls.finalizeReplacement(prepared,'commit')!==true)fail();
    await record(state,'completed','COMPLETED');
    return Object.freeze({
      status:'UPGRADED',
      releaseSha:state.releaseSha,
      operationId:state.operationId,
      attemptId:state.attemptId,
      artifactDigest:state.artifactDigest,
      candidateDigest:state.candidateDigest,
      oldConfigDigest:state.oldConfigDigest,
      newConfigDigest:state.newConfigDigest,
    });
  }catch(error){
    if(error?.message==='Buyer writer gateway configuration upgrade failed'
      &&error.rollbackSafe===true)throw error;
    if(prepared&&published){
      await restoreOld(state,prepared);
      fail(true);
    }
    if(prepared){
      try{
        if(await state.controls.restoreReplacement(prepared,state.oldConfig)!==true)fail();
        if(await state.controls.verifyReplacement(state.oldConfig)!==true)fail();
        if(await state.controls.finalizeReplacement(prepared,'rollback')!==true)fail();
        await record(state,'rolled-back','ROLLED_BACK');
        fail(true);
      }catch(inner){
        if(inner?.message==='Buyer writer gateway configuration upgrade failed')throw inner;
      }
    }
    try{await record(state,'fail-closed','FAIL_CLOSED');}catch{}
    fail(false);
  }
}

export async function upgradeBuyerWriterGatewayConfiguration(input){
 if(input?.ownedProfile!==undefined||input?.ownedSource!==undefined)fail();return executeUpgrade(input);
}
export function inspectOwnedBuyerWriterGatewayConfigurationUpgrade(input){
 if(!input?.ownedProfile||!input?.ownedSource)fail();
 const noop=async()=>true,controls=Object.fromEntries(controlsRequired.map(name=>[name,noop]));
 const state=upgradePlan({...input,controls,appendJournal:noop,now:Date.now});
 return Object.freeze({status:'UPGRADE_PREPARED',releaseSha:state.releaseSha,operationId:state.operationId,attemptId:state.attemptId,artifactDigest:state.artifactDigest,candidateDigest:state.candidateDigest,oldConfigDigest:state.oldConfigDigest,newConfigDigest:state.newConfigDigest,requiresQuiescence:true,mutationEnabled:false});
}
export async function upgradeOwnedBuyerWriterGatewayConfiguration(input){
 if(!input?.ownedProfile||!input?.ownedSource)fail();return executeUpgrade(input);
}
