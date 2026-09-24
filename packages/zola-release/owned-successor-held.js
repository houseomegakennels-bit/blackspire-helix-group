import {successorRuntimePredecessor,validateSuccessorRetirement,successorCanonicalRoot,observeRuntimeSuccessorLineage} from './successor-runtime-predecessor.js';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {hash} from './commander-journal.js';
import {verifyReleaseSource} from './commander-host.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {partitionRetiredReleaseHistory} from './retired-release-history.js';
import {PARTIAL_RELEASE} from './partial-retirement-history.js';
import {inspectAdmissionHoldHistory} from './admission-hold.js';
import {RELEASE_ADMISSION_ROOT,acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {verifyOwnedBuyerMigrationQuiescence} from '../buyer-writer/owned-migration-host.js';
import {createOwnedSourceSecurityFiles} from '../buyer-writer/owned-source-security-host.js';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
const fail=()=>{throw new Error('Successor HELD rollover refused; retain exact plan and admission files');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sha=v=>/^[a-f0-9]{40}$/.test(v??''),uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??''),digest=v=>/^[a-f0-9]{64}$/.test(v??'');
const bytes=v=>JSON.stringify(v)+'\n';
const oldStateFor=releaseSha=>{const p=successorRuntimePredecessor(releaseSha);return {version:1,mode:'held',releaseSha:p.releaseSha,runId:p.runId,apiGeneration:null,workerGeneration:null};};
const marker=state=>({schema:1,releaseSha:state.releaseSha,runId:state.runId,stateDigest:hash(state)});
function bound(input){const P=successorRuntimePredecessor(input?.releaseSha);if(!input||Object.keys(input).sort().join(',')!=='operationId,profileDigest,releaseSha,successorLineageFile'||!sha(input.releaseSha)||input.releaseSha===P.releaseSha||!uuid(input.operationId)||input.operationId===P.operationId||input.profileDigest!==P.profileDigest||input.successorLineageFile!==`/var/lib/blackspire-operator/owned-migration-successors/${input.operationId}/plan.json`)fail();return {...input};}
function validatePlan(p,binding){const P=successorRuntimePredecessor(binding?.releaseSha),oldState=oldStateFor(binding?.releaseSha);if(!p||Object.keys(p).sort().join(',')!=='binding,nextMarker,nextState,previousMarker,previousState,runId,version'||p.version!==1||!same(p.binding,binding)||!uuid(p.runId)||p.runId===P.runId)fail();const next={version:1,mode:'held',releaseSha:binding.releaseSha,runId:p.runId,apiGeneration:null,workerGeneration:null};if(!same(validateReleaseAdmissionState(JSON.parse(p.previousState)),oldState)||!same(JSON.parse(p.previousMarker),marker(oldState))||p.nextState!==bytes(next)||p.nextMarker!==bytes(marker(next)))fail();return next;}
export function validateSuccessorHeldAuthority(input,events,lineage){const request=bound(input),P=successorRuntimePredecessor(request.releaseSha),partition=partitionRetiredReleaseHistory(events),retired=partition.retired,state=inspectReleaseSequenceHistory(events);
 validateSuccessorRetirement(retired,request.releaseSha);
 if(retired.releaseSha!==P.releaseSha||retired.successorReleaseSha!==request.releaseSha||retired.successorOperationId!==request.operationId||retired.profileDigest!==request.profileDigest||state.context?.releaseSha!==request.releaseSha||state.context.operationId!==request.operationId||state.pending?.stage!=='admission_lease')fail();
 if(lineage?.status!=='OWNED_MIGRATION_SUCCESSOR_VERIFIED'||lineage.releaseSha!==request.releaseSha||lineage.operationId!==request.operationId||lineage.profileDigest!==request.profileDigest||lineage.predecessorReleaseSha!==PARTIAL_RELEASE.releaseSha||lineage.predecessorOperationId!==PARTIAL_RELEASE.operationId||lineage.sourceWritesDenied!==true||lineage.targetBrowserSecurityVerified!==true||!digest(lineage.lineageDigest)||lineage.lineageDigest!==retired.proof.lineageDigest)fail();
 return {...request,retirementDigest:hash(retired),lineageDigest:lineage.lineageDigest,attemptId:state.pending.attemptId};
}
export function createOwnedSuccessorHeldHost(input,journal,{root=RELEASE_ADMISSION_ROOT,recordsRoot='/var/lib/blackspire-operator/owned-successor-holds',files=createOwnedSourceSecurityFiles(),readBytes=readOwnedConfigurationBytes,publishBytes=publishOwnedConfigurationBytes,acquire=acquireReleaseAdmissionLock,stopped=verifyOwnedBuyerMigrationQuiescence,verifySource=sha=>verifyReleaseSource(sha,{root:successorCanonicalRoot(sha)}),observeLineage=observeRuntimeSuccessorLineage,current=()=>fs.realpathSync('/opt/blackspire-command/current'),groupId=()=>fs.lstatSync(root+'/state.json').gid}={}){
 if(process.getuid()!==0)fail();const request=bound(input),P=successorRuntimePredecessor(request.releaseSha),work=recordsRoot+'/'+request.operationId,planFile=work+'/plan.json';let lease;
 const state=()=>readBytes(root+'/state.json',{gid:groupId(),mode:0o640}),pending=()=>readBytes(root+'/pending.json',{gid:0,mode:0o600});
 const authorize=async()=>{lease.assertIdentity();verifySource(request.releaseSha);stopped();if(current()!==`/opt/blackspire-command/releases/${P.releaseSha}`||readBytes(root+'/runtime.env',{gid:groupId(),mode:0o640})!==`BLACKSPIRE_RELEASE_RUN_ID=${P.runId}\n`)fail();const proof=await observeLineage(request);lease.assertIdentity();stopped();return validateSuccessorHeldAuthority(request,journal.stream('release').events(),proof);};
 return {acquire(){lease=acquire({root,exclusive:true,allowPending:P!==PARTIAL_RELEASE,owner:0,groupId:groupId()});return lease;},authorize,
 readPlan(){const a=files.read(planFile),b=files.read(planFile+'.pending');if(a&&b)fail();return a??b;},
 retainPlan(p){files.directory(work);files.publish(planFile,p);},snapshot:()=>({state:state(),marker:pending()}),
 publishMarker:p=>publishBytes(root+'/pending.json',p.previousMarker,p.nextMarker,{gid:0,mode:0o600}),
 publishState:p=>publishBytes(root+'/state.json',p.previousState,p.nextState,{gid:groupId(),mode:0o640}),
 events:()=>partitionRetiredReleaseHistory(journal.stream('release').events()).current,
 append:e=>journal.stream('release').append(e)};
}
export async function rolloverOwnedSuccessorHeld({journal,...input},{host=createOwnedSuccessorHeldHost(input,journal),random=randomUUID}={}){
 bound(input);let lease;
 try{lease=host.acquire();lease.assertIdentity();const binding=await host.authorize();let plan=host.readPlan();
 if(!plan){const before=host.snapshot(),runId=random(),next={version:1,mode:'held',releaseSha:input.releaseSha,runId,apiGeneration:null,workerGeneration:null};plan={version:1,binding,runId,previousState:before.state,previousMarker:before.marker,nextState:bytes(next),nextMarker:bytes(marker(next))};}
 const next=validatePlan(plan,binding),record=marker(next),intent={...record,type:'release_hold_intent'},result={...record,type:'release_hold_result'};
 const fence=async()=>{lease.assertIdentity();if(!same(await host.authorize(),binding))fail();const v=host.snapshot();if(!((v.state===plan.previousState&&[plan.previousMarker,plan.nextMarker].includes(v.marker))||(v.state===plan.nextState&&v.marker===plan.nextMarker)))fail();};
 await fence();host.retainPlan(plan);const events=host.events(),holds=events.filter(e=>['release_hold_intent','release_hold_result'].includes(e.type));inspectAdmissionHoldHistory(events);
 if(holds.length>2||holds.some((e,i)=>!same(e,i===0?intent:result)))fail();
 if(!holds.length){await fence();host.append(intent);}if(holds.length<2){await fence();host.publishMarker(plan);await fence();host.publishState(plan);await fence();const v=host.snapshot();if(v.state!==plan.nextState||v.marker!==plan.nextMarker)fail();host.append(result);}
 else{const v=host.snapshot();if(v.state!==plan.nextState||v.marker!==plan.nextMarker)fail();host.publishMarker(plan);host.publishState(plan);}
 await fence();return {status:'OWNED_SUCCESSOR_HELD',releaseSha:input.releaseSha,operationId:input.operationId,runId:plan.runId,stateDigest:record.stateDigest,intakeOpen:false};
 }finally{lease?.close();}
}
