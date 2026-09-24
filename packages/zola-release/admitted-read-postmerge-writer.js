import {readPriorReadRecovery} from './admitted-read-prior-recovery.js';
import {readCompletedReadRecovery} from './admitted-read-fresh-acceptance.js';
import {READ_RECOVERY_ROOT as R} from './admitted-read-transition-preparation.js';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash} from './admitted-read-recovery.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {openReleaseJournal} from './commander-journal.js';
const canonical='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921';
const fail=()=>{throw Error('READ_RECOVERY_POSTMERGE_WRITER_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function ensureReadRecoveryWriterBinding({journal,...input}){
 await readPriorReadRecovery();readCompletedReadRecovery();
 const {inspectReleaseSequenceHistory}=await import(canonical+'/packages/zola-release/commander-sequence.js');
 const state=inspectReleaseSequenceHistory(journal.stream('release').events());
 if(input.stage!=='post_merge_held_epoch'||state.pending?.stage!==input.stage||state.context.operationId!==P.operationId
 ||input.operationId!==P.operationId||state.pending.attemptId!==input.attemptId||state.pending.inputDigest!==input.inputDigest
 ||state.pending.checkOutputDigest!==input.checkOutputDigest||state.outputs.capture_new_main_sha?.newMainSha!==input.releaseSha)fail();
 const files=createBuyerStoreProtectedFiles(),root=R+'/postmerge-writer';
 files.directory(root,{create:true});let log,host;
 try{
  log=openReleaseJournal({root});
  const stream=log.stream('release'),events=stream.events();
  const {createHeldWriterBindingHost}=await import(canonical+'/packages/zola-release/held-writer-binding.js');
  host=createHeldWriterBindingHost();await host.lease(input.releaseSha);
  let plan=files.value(root+'/plan.json',true);
  if(!plan){const prior={plan:files.value(R+'/writer-plan.json'),result:files.value(R+'/writer-result.json')};
   plan=await host.prepare(input,prior);files.record(root+'/plan.json',plan);
  }
  if(Object.keys(input).some(k=>plan[k]!==input[k]))fail();await host.check(plan);
  const steps=['retire_commit','retire_binding','publish'];let next=0,pending=null;
  for(const e of events){
   if(e.version!==1||e.planDigest!==hash(plan)||e.step!==steps[next])fail();
   if(e.type==='intent'){if(pending)fail();pending=e.step;}
   else if(e.type==='result'){if(pending!==e.step)fail();pending=null;next++;}
   else fail();
  }
  for(let i=next;i<steps.length;i++){
   const step=steps[i];await host.check(plan);
   if(!pending){stream.append({version:1,type:'intent',planDigest:hash(plan),step});await host.execute(step,plan);}
   if(await host.observe(step,plan)!==true)fail();
   stream.append({version:1,type:'result',planDigest:hash(plan),step});pending=null;
  }
  const proof=await host.inspect(plan),out={status:'HELD_WRITER_BINDING_VERIFIED',releaseSha:plan.releaseSha,runId:plan.runId,
   apiGeneration:plan.apiGeneration,workerGeneration:plan.workerGeneration,...proof};
  files.record(root+'/result.json',out);if(!same(files.value(root+'/result.json'),out))fail();
  return out;
 }finally{host?.close();log?.close();}
}
