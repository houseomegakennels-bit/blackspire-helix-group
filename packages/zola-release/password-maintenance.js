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
