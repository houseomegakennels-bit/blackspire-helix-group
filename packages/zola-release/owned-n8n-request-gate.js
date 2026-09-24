// Separately reviewed operator-only transport gate. Native transition owns all
// workflow mutations and journal intents; this gate cannot invent a transition.
const fail=()=>{throw new Error('Owned n8n operator gate refused');};
const mutations=new Set(['intent','response','confirmed','unknown']);
export function createOwnedN8nRequestGate({request,events,binding,synchronize,assertConfigured,workflowId}){
 const route='/api/v1/workflows/'+workflowId;
 let synchronized=false;
 const state=()=>{
  const b=binding(),rows=events();
  for(const row of rows)if(row.namespace!==b.namespace||row.releaseSha!==b.releaseSha||mutations.has(row.type)&&(row.operationId!==b.operationId||row.stageAttemptId!==b.stageAttemptId))fail();
  const deactivated=rows.some(r=>r.type==='confirmed'&&r.operation==='deactivate'&&r.state?.kind==='BASELINE'&&r.state.active===false);
  const updateIntent=rows.some(r=>r.type==='intent'&&r.operation==='update');
  return {b,deactivated,updateIntent};
 };
 return async(method,path,body)=>{
  if(method==='GET'&&path===route){
   const s=state();
   if(s.updateIntent)await assertConfigured(s.b);
   if(s.deactivated&&!s.updateIntent&&!synchronized){await synchronize(s.b);await assertConfigured(s.b);synchronized=true;}
  }
  if(method==='PUT'&&path===route||method==='POST'&&path===route+'/activate'){
   const s=state();if(!s.deactivated)fail();await assertConfigured(s.b);
  }
  return request(method,path,body);
 };
}
