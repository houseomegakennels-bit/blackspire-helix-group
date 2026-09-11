import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {RELEASE_ADMISSION_ROOT,acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {hash} from './commander-journal.js';

const plans=new WeakMap(),sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value),uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),generation=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const reject=()=>{throw new Error('Post-merge release admission rejected');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function sync(io,root){const fd=io.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
function atomic(io,root,name,value,mode,gid){
 const bytes=JSON.stringify(value)+'\n',temp=path.join(root,`.${name}-${randomUUID()}.tmp`);let fd;
 try{fd=io.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  io.fchownSync(fd,0,gid);io.fchmodSync(fd,mode);io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
  io.renameSync(temp,path.join(root,name));sync(io,root);
 }finally{if(fd!==undefined)io.closeSync(fd);try{io.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
export function inspectPostMergeAdmissionHistory(events){
 const rows=events.filter(row=>String(row?.type??'').startsWith('release_postmerge_')||String(row?.type??'').startsWith('release_open_'));
 let hold,holdDone=false,open,prepared=false,done=false;
 for(const row of rows){
  if(row.schema!==3)reject();
  if(row.type==='release_postmerge_hold_intent'){
   if(hold||Object.keys(row).sort().join(',')!=='candidateSha,commanderRunId,epochRunId,marker,newMainSha,schema,type')reject();hold=row;
  }else if(row.type==='release_postmerge_hold_result'){
   if(!hold||holdDone||!same(row,{...hold,type:row.type}))reject();holdDone=true;
  }else if(row.type==='release_open_intent'){
   if(!holdDone||open||Object.keys(row).sort().join(',')!=='authorizationId,commanderRunId,epochRunId,evidenceDigest,newMainSha,openStateDigest,schema,type')reject();open=row;
  }else if(row.type==='release_open_prepared'){
   if(!open||prepared||!same(row,{...open,type:row.type}))reject();prepared=true;
  }else if(row.type==='release_open_result'){
   if(!prepared||done||!same(row,{...open,type:row.type}))reject();done=true;
  }else reject();
 }
 return rows;
}

export async function beginPostMergeHeldEpoch({commanderRunId,candidateSha,newMainSha,journal},{root=RELEASE_ADMISSION_ROOT,groupId,
 io=fs,acquire=acquireReleaseAdmissionLock,stopAndVerify}={}){
 let lease;try{
  if(process.getuid()!==0||!uuid(commanderRunId)||![candidateSha,newMainSha].every(sha)||candidateSha===newMainSha||!Number.isInteger(groupId)||typeof stopAndVerify!=='function')reject();
  const stream=journal.stream('release'),prior=inspectPostMergeAdmissionHistory(stream.events()),existing=prior.find(row=>row.type==='release_postmerge_hold_intent'&&row.commanderRunId===commanderRunId);
  lease=acquire({root,exclusive:true,owner:0,groupId});lease.assertIdentity();
  const state=validateReleaseAdmissionState(readRootOwnedJson(path.join(root,'state.json'),{groupId,maxBytes:2048}));
  if(existing){
   const expected={version:1,mode:'held',releaseSha:newMainSha,runId:existing.epochRunId,apiGeneration:null,workerGeneration:null};
   const marker=readRootOwnedJson(path.join(root,'pending.json'),{groupId,maxBytes:2048});
   const oldState=state.mode==='held'&&state.releaseSha===candidateSha&&state.apiGeneration===null&&state.workerGeneration===null
    &&hash(state)===existing.marker.priorStateDigest;
   if(!oldState&&!same(state,expected))reject();
   if(!same(marker,existing.marker))atomic(io,root,'pending.json',existing.marker,0o600,0);
   if(oldState)atomic(io,root,'state.json',expected,0o640,groupId);
   lease.assertIdentity();await stopAndVerify({candidateSha});
   if(!prior.some(row=>row.type==='release_postmerge_hold_result'&&row.commanderRunId===commanderRunId))stream.append({...existing,type:'release_postmerge_hold_result'});
   return{status:'POST_MERGE_HELD',newMainSha,epochRunId:existing.epochRunId,intakeOpen:false,reconciled:true};
  }
  if(prior.length||state.mode!=='held'||state.releaseSha!==candidateSha||state.apiGeneration!==null||state.workerGeneration!==null)reject();
  await stopAndVerify({candidateSha});lease.assertIdentity();
  const epochRunId=randomUUID(),next={version:1,mode:'held',releaseSha:newMainSha,runId:epochRunId,apiGeneration:null,workerGeneration:null};
  const marker={schema:3,kind:'post_merge_hold',commanderRunId,candidateSha,newMainSha,epochRunId,priorStateDigest:hash(state),stateDigest:hash(next)};
  const intent={schema:3,type:'release_postmerge_hold_intent',commanderRunId,candidateSha,newMainSha,epochRunId,marker};stream.append(intent);
  atomic(io,root,'state.json',next,0o640,groupId);atomic(io,root,'pending.json',marker,0o600,0);lease.assertIdentity();await stopAndVerify({candidateSha});
  stream.append({...intent,type:'release_postmerge_hold_result'});
  return{status:'POST_MERGE_HELD',newMainSha,epochRunId,intakeOpen:false,reconciled:false};
 }catch{reject();}finally{lease?.close();}
}

function validateEvidence(value,{commanderRunId,newMainSha,epochRunId}){
 const keys=['commanderRunId','epochRunId','newMainSha','mainSha','vercelSha','vpsSha','artifactDigest','apiGeneration','workerGeneration','n8nDigest','migrationDigest','sixReadsDigest','rollbackDigest','securitySmokeDigest','productionSmokeDigest','readCount','crossOwnerDenials','paidProviderCalls','mutationDelta'];
 if(!value||Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.commanderRunId!==commanderRunId||value.epochRunId!==epochRunId
  ||![value.newMainSha,value.mainSha,value.vercelSha,value.vpsSha].every(item=>item===newMainSha)||!digest(value.artifactDigest)
  ||!generation(value.apiGeneration)||!generation(value.workerGeneration)||value.apiGeneration===value.workerGeneration
  ||!['n8nDigest','migrationDigest','sixReadsDigest','rollbackDigest','securitySmokeDigest','productionSmokeDigest'].every(key=>digest(value[key]))
  ||value.readCount!==6||value.crossOwnerDenials!==6||value.paidProviderCalls!==0||value.mutationDelta!==0)reject();
 return structuredClone(value);
}
export async function prepareGuardedOpen({commanderRunId,newMainSha,epochRunId,verify}){
 try{
  if(!uuid(commanderRunId)||!uuid(epochRunId)||!sha(newMainSha)||typeof verify!=='function')reject();const binding={commanderRunId,newMainSha,epochRunId};
  const first=validateEvidence(await verify(binding),binding),second=validateEvidence(await verify(binding),binding);if(!same(first,second))reject();
  const plan=Object.freeze({schema:3,kind:'guarded-open',...binding,evidenceDigest:hash(first),apiGeneration:first.apiGeneration,workerGeneration:first.workerGeneration});
  plans.set(plan,{verify,evidence:first});return plan;
 }catch{reject();}
}
export async function publishGuardedOpen({plan,journal},{root=RELEASE_ADMISSION_ROOT,groupId,io=fs,acquire=acquireReleaseAdmissionLock}={}){
 let lease;try{
  const privatePlan=plans.get(plan);if(!privatePlan||process.getuid()!==0||!Number.isInteger(groupId))reject();const stream=journal.stream('release'),history=inspectPostMergeAdmissionHistory(stream.events());
  lease=acquire({root,exclusive:true,owner:0,groupId});lease.assertIdentity();
  const stateFile=path.join(root,'state.json'),pendingFile=path.join(root,'pending.json');
  let markerPresent=true;try{io.lstatSync(pendingFile);}catch(error){if(error.code==='ENOENT')markerPresent=false;else throw error;}
  const state=validateReleaseAdmissionState(readRootOwnedJson(stateFile,{groupId,maxBytes:2048}));
  const completed=history.find(row=>row.type==='release_open_result'&&row.commanderRunId===plan.commanderRunId);
  if(completed){if(markerPresent||state.mode!=='open'||state.releaseSha!==plan.newMainSha||state.runId!==plan.epochRunId
    ||state.apiGeneration!==plan.apiGeneration||state.workerGeneration!==plan.workerGeneration)reject();return{status:'OPEN',alreadyOpen:true,...plan};}
  const existing=history.find(row=>row.type==='release_open_intent'&&row.commanderRunId===plan.commanderRunId);
  const heldState=state.mode==='held'&&state.releaseSha===plan.newMainSha&&state.runId===plan.epochRunId;
  const alreadyWritten=state.mode==='open'&&state.releaseSha===plan.newMainSha&&state.runId===plan.epochRunId
   &&state.apiGeneration===plan.apiGeneration&&state.workerGeneration===plan.workerGeneration;
  if(!markerPresent&&alreadyWritten&&existing&&history.some(row=>row.type==='release_open_prepared'&&row.authorizationId===existing.authorizationId)){
   stream.append({...existing,type:'release_open_result'});return{status:'OPEN',alreadyOpen:false,reconciled:true,...plan};
  }
  if(!markerPresent||!heldState&&!alreadyWritten)reject();
  const fresh=validateEvidence(await privatePlan.verify({commanderRunId:plan.commanderRunId,newMainSha:plan.newMainSha,epochRunId:plan.epochRunId}),plan);
  if(!same(fresh,privatePlan.evidence)||hash(fresh)!==plan.evidenceDigest)reject();
  const open={version:1,mode:'open',releaseSha:plan.newMainSha,runId:plan.epochRunId,apiGeneration:plan.apiGeneration,workerGeneration:plan.workerGeneration};
  const intent=existing??{schema:3,type:'release_open_intent',commanderRunId:plan.commanderRunId,newMainSha:plan.newMainSha,epochRunId:plan.epochRunId,authorizationId:randomUUID(),evidenceDigest:plan.evidenceDigest,openStateDigest:hash(open)};
  if(existing&&(existing.evidenceDigest!==plan.evidenceDigest||existing.openStateDigest!==hash(open)))reject();
  if(!existing)stream.append(intent);if(!alreadyWritten)atomic(io,root,'state.json',open,0o640,groupId);lease.assertIdentity();
  const final=validateEvidence(await privatePlan.verify({commanderRunId:plan.commanderRunId,newMainSha:plan.newMainSha,epochRunId:plan.epochRunId}),plan);
  if(!same(final,fresh))reject();if(!history.some(row=>row.type==='release_open_prepared'&&row.authorizationId===intent.authorizationId))stream.append({...intent,type:'release_open_prepared'});
  const fd=io.openSync(pendingFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const stat=io.fstatSync(fd);if(!stat.isFile()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o7777)!==0o600)reject();io.unlinkSync(pendingFile);sync(io,root);}finally{io.closeSync(fd);}
  lease.assertIdentity();stream.append({...intent,type:'release_open_result'});return{status:'OPEN',alreadyOpen:false,...plan};
 }catch{reject();}finally{lease?.close();}
}
