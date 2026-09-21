import {createHash,randomUUID} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),same=(a,b)=>hash(a)===hash(b);
const fail=()=>{throw Error('Owned successor final inputs refused; retain preparation records');};
const stages=['workflow','bundle','backup','input'];
export async function prepareOwnedSuccessorFinalInputs({releaseSha,inspect=false},{host,generateOperationId=randomUUID}={}){
 if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||releaseSha==='2636a1e75cd0f422aff036dfee8a93a81cd5008b'||typeof inspect!=='boolean')fail();
 const snapshot=await host.snapshot(releaseSha);let plan=host.read('plan.json');
 if(!plan){if(inspect)fail();plan={version:1,kind:'owned-successor-final-inputs',releaseSha,operationId:generateOperationId(),snapshotDigest:hash(snapshot)};
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(plan.operationId)||plan.operationId==='95a11ea1-289f-46a9-b5cd-cc7805497242')fail();host.publish('plan.json',plan);}
 if(Object.keys(plan).sort().join(',')!=='kind,operationId,releaseSha,snapshotDigest,version'||plan.version!==1||plan.kind!=='owned-successor-final-inputs'||plan.releaseSha!==releaseSha||plan.snapshotDigest!==hash(snapshot)||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(plan.operationId)||plan.operationId==='95a11ea1-289f-46a9-b5cd-cc7805497242')fail();
 if(!inspect)host.publish('plan.json',plan);
 const fence=async()=>{if(!same(await host.snapshot(releaseSha),snapshot))fail();};const results={};
 for(const stage of stages){await fence();const intent={version:1,planDigest:hash(plan),stage},old=host.read(stage+'.intent.json'),result=host.read(stage+'.result.json');
  if(old&&!same(old,intent)||result&&!old)fail();
  if(result){if(result.version!==1||result.planDigest!==hash(plan)||result.stage!==stage||Object.keys(result).sort().join(',')!=='planDigest,stage,value,version')fail();await host.verify(stage,plan,results,result.value);results[stage]=result.value;if(!inspect){host.publish(stage+'.intent.json',intent);host.publish(stage+'.result.json',result);}continue;}
  if(inspect)fail();let value;if(old){if(!['bundle','input'].includes(stage)||typeof host.reconcile!=='function')fail();value=await host.reconcile(stage,plan,results);}
  else{host.publish(stage+'.intent.json',intent);value=await host.execute(stage,plan,results);}await fence();await host.verify(stage,plan,results,value);
  host.publish(stage+'.result.json',{version:1,planDigest:hash(plan),stage,value});results[stage]=value;
 }
 await fence();return {status:inspect?'OWNED_SUCCESSOR_FINAL_INPUTS_VERIFIED':'OWNED_SUCCESSOR_FINAL_INPUTS_PREPARED',releaseSha,operationId:plan.operationId,productionInputFile:results.input.productionInputFile,successorLineageFile:results.input.successorLineageFile,lineageRequired:true,activationReady:false,productionAccepted:false};
}
