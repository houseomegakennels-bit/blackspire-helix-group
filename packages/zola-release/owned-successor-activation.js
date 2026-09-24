import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateOwnedStoreTransitionPlan} from './owned-store-transition.js';
import {hash} from './commander-journal.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {partitionRetiredReleaseHistory} from './retired-release-history.js';
import {successorRuntimePredecessor,validateSuccessorRetirement} from './successor-runtime-predecessor.js';
const fail=()=>{throw new Error('Owned successor activation refused; preserve retained phases');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const digest=v=>/^[a-f0-9]{64}$/.test(v??''),sha=v=>/^[a-f0-9]{40}$/.test(v??''),uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??'');
function validateActivationResults(input,planDigest,configurationPlan,configurationResult,gatewayResult){
  if(configurationResult&&(!exact(configurationResult,'version,planDigest,result')||configurationResult.version!==1||configurationResult.planDigest!==planDigest||!exact(configurationResult.result,'status,releaseSha,profileDigest,planDigest,storePlan')||configurationResult.result.status!=='OWNED_SUCCESSOR_CONFIGURATION_PREPARED'||configurationResult.result.releaseSha!==input.releaseSha||configurationResult.result.profileDigest!==input.profileDigest||configurationResult.result.planDigest!==hash(configurationPlan)))fail();
  if(gatewayResult&&(!exact(gatewayResult,'version,planDigest,result')||gatewayResult.version!==1||gatewayResult.planDigest!==planDigest||!exact(gatewayResult.result,'version,status,releaseSha,operationId,attemptId,unitDigest,planDigest,daemonReloaded')||gatewayResult.result.version!==1||gatewayResult.result.status!=='OWNED_SUCCESSOR_GATEWAY_UNIT_VERIFIED'||gatewayResult.result.releaseSha!==input.releaseSha||gatewayResult.result.operationId!==input.operationId||gatewayResult.result.attemptId!==input.attemptId||!digest(gatewayResult.result.unitDigest)||!digest(gatewayResult.result.planDigest)||gatewayResult.result.daemonReloaded!==true))fail();
}
export function inspectOwnedSuccessorActivationAuthority(input,journal){
 if(!exact(input,'releaseSha,operationId,attemptId,inputDigest,checkOutputDigest,profileDigest,successorLineageFile')||!sha(input.releaseSha)||![input.operationId,input.attemptId].every(uuid)||![input.inputDigest,input.checkOutputDigest,input.profileDigest].every(digest)
  ||input.successorLineageFile!==`/var/lib/blackspire-operator/owned-migration-successors/${input.operationId}/plan.json`)fail();
 const events=journal.stream('release').events();partitionRetiredReleaseHistory(events);const retired=events.findLast(e=>e.type==='sequence_retired');
 validateSuccessorRetirement(retired,input.releaseSha);
 if(retired.successorReleaseSha!==input.releaseSha||retired.successorOperationId!==input.operationId||retired.profileDigest!==input.profileDigest)fail();
 const state=inspectReleaseSequenceHistory(events),p=state.pending;
 if(state.context?.operationId!==input.operationId||state.context.releaseSha!==input.releaseSha||state.nextOrdinal!==5||p?.stage!=='admission_lease'
  ||p.attemptId!==input.attemptId||p.inputDigest!==input.inputDigest||p.checkOutputDigest!==input.checkOutputDigest)fail();
 return {retired,journalDigest:hash(events)};
}
export async function activateOwnedSuccessorBeforeHeld({journal:inputJournal,...input},{journal=inputJournal,host,store,uid=process.getuid()}={}){
 if(inputJournal&&inputJournal!==journal)fail();
 if(uid!==0)fail();const authority=inspectOwnedSuccessorActivationAuthority(input,journal);
 // Native factories may create private record directories, so construct them
 // only after exact current sequence authority has been checked.
 if(!host||!store){const native=await import('./owned-successor-activation-host.js');host??=await native.createOwnedSuccessorActivationHost(input,journal);store??=native.createOwnedSuccessorActivationStore(input);}
 const guard=()=>{if(!same(inspectOwnedSuccessorActivationAuthority(input,journal),authority))fail();};
 const first=await host.fence();guard();
 const fence=async()=>{guard();if(!same(await host.fence(),first))fail();guard();};
 const expectedPlan={version:1,input,identity:first.identity};
 let plan=store.read('plan');if(plan){if(!same(plan,expectedPlan))fail();}else{await fence();store.retain('plan',expectedPlan);plan=expectedPlan;}
 const planDigest=hash(plan),stepIntent={version:1,planDigest};
 const configInput={previousReleaseSha:successorRuntimePredecessor(input.releaseSha).releaseSha,releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,profileDigest:input.profileDigest,frontendOrigin:first.identity.frontendOrigin};
 const unitInput={releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,profileDigest:input.profileDigest,successorLineageFile:input.successorLineageFile};
 let configurationPlan=store.read('configuration-plan'),configurationResult=store.read('configuration-result'),gatewayResult=store.read('gateway-result'),completed=store.read('result');
 const observe=async()=>{if(!configurationPlan||await host.observeConfiguration(configurationPlan)!==true||await host.observeGateway(unitInput)!==true)fail();await fence();};

 validateActivationResults(input,planDigest,configurationPlan,configurationResult,gatewayResult);
 if(completed){
  if(!same(store.read('configuration-intent'),stepIntent)||!same(store.read('gateway-intent'),stepIntent)||!same(configurationPlan?.input,configInput))fail();
  if(!configurationResult||!gatewayResult||!same(completed,{version:1,planDigest,configurationResultDigest:hash(configurationResult),gatewayResultDigest:hash(gatewayResult),status:'OWNED_SUCCESSOR_ACTIVATION_VERIFIED'}))fail();
  await observe();return {...completed,releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,activationDigest:hash(completed)};
 }
 if(first.runtime.mode!=='stopped-sealed')fail();
 const configIntent=store.read('configuration-intent');if(configIntent&&!same(configIntent,stepIntent)||configurationResult&&!configIntent)fail();
 if(!configurationResult){
  if(!configIntent){await fence();store.retain('configuration-intent',stepIntent);}
  if(!configurationPlan){configurationPlan=await host.prepareConfiguration(configInput);await fence();store.retain('configuration-plan',configurationPlan);}
  else if(!same(configurationPlan.input,configInput))fail();
  await fence();const result=await host.publishConfiguration(configurationPlan);await fence();
  if(result?.status!=='OWNED_SUCCESSOR_CONFIGURATION_PREPARED'||result.releaseSha!==input.releaseSha||result.profileDigest!==input.profileDigest||!digest(result.planDigest))fail();
  if(await host.observeConfiguration(configurationPlan)!==true)fail();configurationResult={version:1,planDigest,result};validateActivationResults(input,planDigest,configurationPlan,configurationResult,gatewayResult);store.retain('configuration-result',configurationResult);
 }
 if(!configurationPlan||!same(configurationPlan.input,configInput)||await host.observeConfiguration(configurationPlan)!==true)fail();
 const gatewayIntent=store.read('gateway-intent');if(gatewayIntent&&!same(gatewayIntent,stepIntent)||gatewayResult&&!gatewayIntent)fail();
 if(!gatewayResult){
  if(!gatewayIntent){await fence();store.retain('gateway-intent',stepIntent);}
  const unitPlan=await host.prepareGateway(unitInput);await fence();const result=await host.installGateway(unitPlan);await fence();
  if(await host.observeGateway(unitInput)!==true)fail();gatewayResult={version:1,planDigest,result};validateActivationResults(input,planDigest,configurationPlan,configurationResult,gatewayResult);store.retain('gateway-result',gatewayResult);
 }
 await observe();completed={version:1,planDigest,configurationResultDigest:hash(configurationResult),gatewayResultDigest:hash(gatewayResult),status:'OWNED_SUCCESSOR_ACTIVATION_VERIFIED'};
 store.retain('result',completed);return {...completed,releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,activationDigest:hash(completed)};
}

// Read-only handoff to candidate deployment. This returns the actual retained
// predecessor-to-successor store plan, never a newly synthesized same-SHA plan.
export function readOwnedSuccessorActivationStorePlan({journal,...input},{read=readRootOwnedJsonSnapshot}={}){
 const authority=inspectOwnedSuccessorActivationAuthority(input,journal);
 const root='/var/lib/blackspire-operator/owned-successor-activation/'+input.operationId+'/'+input.attemptId;
 const snapshot=name=>{const s=read(root+'/'+name+'.json',{groupId:0,maxBytes:65536});if(s.identity.uid!==0||s.identity.gid!==0||(s.identity.mode&0o7777)!==0o600)fail();return s;};
 const names=['plan','configuration-intent','configuration-plan','configuration-result','gateway-intent','gateway-result','result'];
 const records=Object.fromEntries(names.map(name=>[name,snapshot(name)]));
 const plan=records.plan,configuration=records['configuration-result'],gateway=records['gateway-result'],result=records.result,configurationPlan=records['configuration-plan'].value;
 const planDigest=hash(plan.value),intent={version:1,planDigest};
 const configInput={previousReleaseSha:successorRuntimePredecessor(input.releaseSha).releaseSha,releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,profileDigest:input.profileDigest,frontendOrigin:plan.value.identity.frontendOrigin};
 if(!exact(plan.value,'version,input,identity')||plan.value.version!==1||!same(plan.value.input,input)||!same(configurationPlan.input,configInput)||!same(records['configuration-intent'].value,intent)||!same(records['gateway-intent'].value,intent)
  ||!same(result.value,{version:1,planDigest,configurationResultDigest:hash(configuration.value),gatewayResultDigest:hash(gateway.value),status:'OWNED_SUCCESSOR_ACTIVATION_VERIFIED'}))fail();
 validateActivationResults(input,planDigest,configurationPlan,configuration.value,gateway.value);
 const value=validateOwnedStoreTransitionPlan(configuration.value.result.storePlan);
 if(value.releaseSha!==input.releaseSha||value.previousSha!==successorRuntimePredecessor(input.releaseSha).releaseSha||value.profileDigest!==input.profileDigest||value.origin!==plan.value.identity.frontendOrigin)fail();
 if(names.some(name=>!same(records[name],snapshot(name)))||!same(authority,inspectOwnedSuccessorActivationAuthority(input,journal)))fail();return value;
}
