export const FEATURE_STEPS=Object.freeze(['hold','stop','prepare','install','switchRelease','start','store','writer','verifyHeld','open','verifyOpen']);
export async function runFeatureRelease(host){
 let plan,entered=false;
 try{
  plan=await host.preflight();
  for(const step of FEATURE_STEPS){
   await host.record(step,'intent');if(step==='hold')entered=true;
   await host[step](plan);await host.record(step,'complete');
  }
  await host.finish(plan);return {status:'FEATURE_RELEASE_ACTIVE'};
 }catch(error){
  if(entered){
   await host.contain(plan);
   try{await host.rollback(plan);await host.record('rollback','complete');}
   catch{await host.contain(plan);throw new Error('Feature release failed; rollback incomplete, retain HELD containment');}
  }
  throw error;
 }finally{await host.close();}
}
