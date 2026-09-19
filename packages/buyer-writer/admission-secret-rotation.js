import {createHash} from 'node:crypto';
import {validateBuyerWriterGatewayServiceConfiguration} from './gateway-entry.js';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const requiredControls=['assertQuiesced','stopGateway','prepareConfiguration','bindPassword',
  'authenticate','publishConfiguration','startGateway','verify','restoreConfiguration','finalizeConfiguration'];
const fail=(rollbackSafe=false)=>{
  const error=new Error('Buyer writer admission secret rotation failed');
  error.rollbackSafe=rollbackSafe;throw error;
};
const digest=value=>createHash('sha256').update(JSON.stringify(value)+'\n').digest('hex');

function plan({operationId,oldConfiguration,newConfiguration,controls,appendJournal,now}){
  try{
    if(!UUID.test(operationId??'')||typeof appendJournal!=='function'||typeof now!=='function'
      ||!controls||typeof controls!=='object'||requiredControls.some(name=>typeof controls[name]!=='function'))fail();
    const oldConfig=validateBuyerWriterGatewayServiceConfiguration(oldConfiguration);
    const newConfig=validateBuyerWriterGatewayServiceConfiguration(newConfiguration);
    const oldPassword=oldConfig.admission.connection.password,newPassword=newConfig.admission.connection.password;
    if(oldPassword===newPassword)fail();
    const normalized=structuredClone(newConfig);
    normalized.admission.connection.password=oldPassword;
    if(JSON.stringify(normalized)!==JSON.stringify(oldConfig))fail();
    const oldConfigDigest=digest(oldConfig),newConfigDigest=digest(newConfig);
    if(oldConfigDigest===newConfigDigest)fail();
    return Object.freeze({operationId,oldConfig,newConfig,oldPassword,newPassword,
      oldConfigDigest,newConfigDigest,controls,appendJournal,now});
  }catch{fail();}
}

async function succeeds(callback){
  try{return await callback()===true;}catch{return false;}
}

async function record(state,phase,status='IN_PROGRESS'){
  await state.appendJournal({version:1,kind:'buyer_writer_admission_secret_rotation',
    operationId:state.operationId,phase,status,oldConfigDigest:state.oldConfigDigest,
    newConfigDigest:state.newConfigDigest,updatedAt:new Date(state.now()).toISOString()});
}

async function proveExclusive(state){
  const newWorks=await succeeds(()=>state.controls.authenticate(state.newConfig));
  const oldWorks=await succeeds(()=>state.controls.authenticate(state.oldConfig));
  return {newWorks,oldWorks,exclusive:newWorks!==oldWorks};
}
async function restoreOld(state,prepared){
  try{
    await state.controls.stopGateway();
    await state.controls.bindPassword(state.oldPassword);
    const proof=await proveExclusive(state);
    if(!proof.exclusive||!proof.oldWorks)fail();
    await state.controls.restoreConfiguration(prepared,state.oldConfig);
    await state.controls.startGateway();
    if(await state.controls.verify(state.oldConfig)!==true)fail();
    await state.controls.finalizeConfiguration(prepared,'rollback');
    await record(state,'rolled-back','ROLLED_BACK');
    return true;
  }catch{
    try{await record(state,'fail-closed','FAIL_CLOSED');}catch{}
    fail(false);
  }
}

export function inspectBuyerWriterAdmissionSecretRotation({operationId,oldConfiguration,newConfiguration}={}){
  const noop=async()=>true,controls=Object.fromEntries(requiredControls.map(name=>[name,noop]));
  const state=plan({operationId,oldConfiguration,newConfiguration,controls,appendJournal:noop,now:Date.now});
  return Object.freeze({status:'ROTATION_PREPARED',operationId:state.operationId,
    oldConfigDigest:state.oldConfigDigest,newConfigDigest:state.newConfigDigest,
    requiresQuiescence:true,mutationEnabled:false});
}

export async function rotateBuyerWriterAdmissionSecret(input){
  const state=plan(input);let prepared,newConfirmed=false;
  try{
    await record(state,'started');
    if(await state.controls.assertQuiesced()!==true)fail();
    await record(state,'quiesced');
    if(await state.controls.stopGateway()!==true)fail();
    prepared=await state.controls.prepareConfiguration(state.oldConfig,state.newConfig);
    if(!prepared||typeof prepared!=='object')fail();
    await record(state,'prepared');
    try{await state.controls.bindPassword(state.newPassword);}catch{}
    await record(state,'database-commit-sent');
    const proof=await proveExclusive(state);
    if(!proof.exclusive){
      try{await record(state,'fail-closed','FAIL_CLOSED');}catch{}
      fail(false);
    }
    if(proof.oldWorks){
      await state.controls.restoreConfiguration(prepared,state.oldConfig);
      await state.controls.startGateway();
      if(await state.controls.verify(state.oldConfig)!==true)fail();
      await state.controls.finalizeConfiguration(prepared,'rollback');
      await record(state,'rolled-back','ROLLED_BACK');
      fail(true);
    }
    newConfirmed=true;await record(state,'database-new-confirmed');
    if(await state.controls.publishConfiguration(prepared,state.newConfig)!==true)fail();
    await record(state,'configuration-published');
    if(await state.controls.startGateway()!==true||await state.controls.verify(state.newConfig)!==true)fail();
    await record(state,'gateway-ready');
    if(await state.controls.finalizeConfiguration(prepared,'commit')!==true)fail();
    await record(state,'completed','COMPLETED');
    return Object.freeze({status:'ROTATED',operationId:state.operationId,
      oldConfigDigest:state.oldConfigDigest,newConfigDigest:state.newConfigDigest});
  }catch(error){
    if(error?.message==='Buyer writer admission secret rotation failed'&&error.rollbackSafe===true)throw error;
    if(prepared&&(newConfirmed||await succeeds(()=>state.controls.authenticate(state.newConfig)))){
      await restoreOld(state,prepared);fail(true);
    }
    if(prepared){
      try{
        await state.controls.restoreConfiguration(prepared,state.oldConfig);
        await state.controls.startGateway();
        if(await state.controls.verify(state.oldConfig)!==true)fail();
        await state.controls.finalizeConfiguration(prepared,'rollback');
        await record(state,'rolled-back','ROLLED_BACK');
        fail(true);
      }catch(inner){
        if(inner?.message==='Buyer writer admission secret rotation failed')throw inner;
      }
    }
    try{await record(state,'fail-closed','FAIL_CLOSED');}catch{}
    fail(false);
  }
}
