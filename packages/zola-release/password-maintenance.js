export const MAINTENANCE_STEPS=Object.freeze(['hold','stop','install','revoke','start','store','writer','verifyHeld','open','verifyOpen']);
export async function runPasswordMaintenance(host){
 const plan=await host.preflight();let entered=false;
 try{
  for(const step of MAINTENANCE_STEPS){
   await host.record(step,'intent');
   if(step==='hold')entered=true;
   await host[step](plan);
   await host.record(step,'complete');
  }
  await host.finish(plan);return {status:'PASSWORD_ACTIVATED'};
 }catch(error){
  if(entered)await host.contain(plan);
  throw error;
 }
}

export function validatePasswordReadinessRecovery(events,operationId){
 const expected=[];
 for(const step of MAINTENANCE_STEPS.slice(0,8)){
  expected.push({schema:1,type:'password_maintenance',operationId,step,phase:'intent'});
  if(step==='verifyHeld')break;
  if(step==='writer')for(const part of ['retire_commit','retire_binding','publish'])for(const phase of ['intent','complete'])expected.push({schema:1,type:'maintenance_writer',step:part,phase});
  expected.push({schema:1,type:'password_maintenance',operationId,step,phase:'complete'});
 }
 if(JSON.stringify(events)!==JSON.stringify(expected))throw Error('Password recovery history rejected');
 return true;
}

export function validatePasswordMaintenanceReadiness(status,j,{open,releaseSha}){
 const keys=['releaseAdmission','lifecycle','database','productionConfig','worker','scheduler','deploymentIdentity','buyerStore','buyerWriter'];
 if(status!==(open?200:503)||j.ok!==open||JSON.stringify(Object.keys(j.checks??{}).sort())!==JSON.stringify([...keys].sort())
 ||keys.some(k=>j.checks[k]!==((['releaseAdmission','buyerWriter'].includes(k))?open:true))
 ||j.deploymentIdentity?.build?.value!==releaseSha||j.dependencies?.worker?.activeTask!==false||j.dependencies?.buyerWriter?.ok!==true)
 throw Error('Maintenance readiness rejected');
 return true;
}
