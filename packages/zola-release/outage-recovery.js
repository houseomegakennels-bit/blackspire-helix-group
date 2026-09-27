import {hash} from './commander-journal.js';
export function validateOutagePredecessor({priorPlan,priorResult,priorState,oldState,configurationDigest,environmentDigest}) {
  if(priorResult?.status!=='PASSWORD_ACTIVATED'||priorResult.version!==1
    ||hash(priorPlan)!==priorResult.planDigest||hash(oldState)!==priorResult.stateDigest
    ||hash(priorState)!==hash(oldState)||oldState.mode!=='open'
    ||oldState.releaseSha!==priorPlan.releaseSha||oldState.releaseSha!==priorResult.releaseSha
    ||oldState.runId!==priorPlan.runId||configurationDigest!==priorPlan.configurationDigest
    ||environmentDigest!==priorPlan.newEnvironmentDigest)throw Error('Outage predecessor rejected');
}
export const OUTAGE_STEPS=Object.freeze(['hold','stop','start','store','writer','verifyHeld','open','verifyOpen']);
export function validateOutageStopResume(events,operationId) {
 const expected=[
  {schema:1,type:'outage_recovery',operationId,step:'hold',phase:'intent'},
  {schema:1,type:'outage_recovery',operationId,step:'hold',phase:'complete'},
  {schema:1,type:'outage_recovery',operationId,step:'stop',phase:'intent'},
 ];
 if(JSON.stringify(events)!==JSON.stringify(expected))throw Error('Outage stop resume rejected');
}
export async function runOutageRecovery(host,{resumeStop=false}={}) {
  const plan=await host.preflight();let entered=resumeStop;
  try {
    for(const step of (resumeStop?OUTAGE_STEPS.slice(1):OUTAGE_STEPS)) {
      if(!(resumeStop&&step==='stop'))await host.record(step,'intent');
      if(step==='hold')entered=true;
      await host[step](plan);
      await host.record(step,'complete');
    }
    await host.finish(plan);return {status:'OUTAGE_RECOVERED'};
  } catch(error) {if(entered)await host.contain(plan);throw error;}
}
