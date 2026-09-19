import {createHash} from 'node:crypto';
import {validateBuyerWriterGatewayServiceConfiguration} from './gateway-entry.js';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
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

function upgradePlan({operationId,oldConfiguration,newConfiguration,controls,appendJournal,now}){
  try{
    if(!UUID.test(operationId??'')||!controls||typeof controls!=='object'
      ||controlsRequired.some(name=>typeof controls[name]!=='function')
      ||typeof appendJournal!=='function'||typeof now!=='function')fail();
    const oldConfig=validateBuyerWriterGatewayServiceConfiguration(oldConfiguration);
    const newConfig=validateBuyerWriterGatewayServiceConfiguration(newConfiguration);
    if(oldConfig.version!==2||newConfig.version!==4||newConfig.mode!=='research-admission')fail();
    for(const key of ['workspace','socketPath','gatewayCapability','creatorOid'])
      if(oldConfig[key]!==newConfig[key])fail();
    for(const key of ['runtime','issuer'])if(!same(oldConfig[key],newConfig[key]))fail();
    if(oldConfig.authority.releaseSha===newConfig.authority.releaseSha)fail();
    const oldConfigDigest=digest(oldConfig),newConfigDigest=digest(newConfig);
    if(oldConfigDigest===newConfigDigest)fail();
    return Object.freeze({operationId,oldConfig,newConfig,oldConfigDigest,newConfigDigest,
      controls,appendJournal,now});
  }catch(error){
    if(error?.message==='Buyer writer gateway configuration upgrade failed')throw error;
    fail();
  }
}

async function record(state,phase,status='IN_PROGRESS'){
  await state.appendJournal({
    version:1,
    kind:'buyer_writer_gateway_configuration_upgrade',
    operationId:state.operationId,
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
  operationId,oldConfiguration,newConfiguration,
}={}){
  const noop=async()=>true;
  const controls=Object.fromEntries(controlsRequired.map(name=>[name,noop]));
  const state=upgradePlan({
    operationId,oldConfiguration,newConfiguration,controls,appendJournal:noop,now:Date.now,
  });
  return Object.freeze({
    status:'UPGRADE_PREPARED',
    operationId:state.operationId,
    oldConfigDigest:state.oldConfigDigest,
    newConfigDigest:state.newConfigDigest,
    requiresQuiescence:true,
    mutationEnabled:false,
  });
}
export async function upgradeBuyerWriterGatewayConfiguration(input){
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
      operationId:state.operationId,
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
