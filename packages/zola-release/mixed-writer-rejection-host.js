import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {hash} from './commander-journal.js';
import {MIXED_WRITER_REJECTION as P,MIXED_WRITER_UNRESERVED,validateRetiredWriterPrefix,validateMixedWriterRejectionEvent,validateMixedWriterRejectionPrefix} from './mixed-writer-rejection.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readOwnedDatabaseProfile,databaseProfileDigest} from '../buyer-writer/database-profile.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
const root='/var/lib/blackspire-operator/preparation/mixed-writer-rejection-76698759-cafd-49d2-af94-cad39a77256c';
const targetFile='/var/lib/blackspire-operator/owned-writer-acceptance.json';
const admissionRoot='/etc/blackspire/release-admission';
const fail=()=>{throw Error('MIXED_WRITER_REJECTION_HOST_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const lit=s=>"'"+String(s).replaceAll("'","''")+"'";
export function buildMixedWriterTargetRefresh(before,observation,{profileDigest,subject}){
 if(hash(before)!==P.targetBeforeDigest)fail();
 const t=JSON.parse(before);
 if(t.schema!==1||t.kind!=='zola_owned_bounded_writer_acceptance_target'||t.releaseSha!==P.releaseSha
  ||t.backendProfile!=='owned-postgres-v1'||t.profileDigest!==profileDigest
  ||t.workspace!=='blackspire-command'||t.principal!=='blackspire-release-root'||t.capability!=='buyer.writer.acceptance'
  ||t.ownerId!==subject||t.criteria?.county!=='Zola Acceptance'||t.criteria?.property_type!=='acceptance'
  ||typeof observation.updatedAt!=='string'||!(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/).test(observation.updatedAt)
  ||observation.updatedAt===t.updatedAt||!same(Object.keys(observation).sort(),['proof','updatedAt']))fail();
 const after=JSON.stringify({...t,updatedAt:observation.updatedAt})+'\n';
 const event={schema:1,type:P.type,releaseSha:P.releaseSha,operationId:P.operationId,attemptId:P.attemptId,
  prefixDigest:P.prefixDigest,handleDigest:P.handleDigest,targetBeforeDigest:P.targetBeforeDigest,
  targetAfterDigest:hash(after),proof:observation.proof,proofDigest:hash(observation.proof)};
 validateMixedWriterRejectionEvent(event);
 return {version:1,before,after,event};
}
export function observeMixedRejectedIssue(handle,target,bound){
 const bytes=hash(bound),dispatch=bytes.slice(0,8)+'-'+bytes.slice(8,12)+'-4'+bytes.slice(13,16)+'-8'+bytes.slice(17,20)+'-'+bytes.slice(20,32);
 const sql='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('+
 "'updatedAt',to_char(j.updated_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),"+
 "'proof',json_build_object("+
 "'expired',a.expires_at<clock_timestamp(),'reserved',a.state='reserved','unbound',a.subject is null and a.result is null and a.completed_at is null,"+
 "'requestMatches',a.request_id="+lit(handle.requestId)+"::uuid,'digestMatches',a.raw_body_digest="+lit(handle.bodyDigest)+","+
 "'ownerMatches',j.user_id="+lit(target.ownerId)+"::uuid,'signerMatches',j.user_id="+lit(handle.authority.subject)+"::uuid,"+
 "'criteriaMatches',buyer_writer.criteria(to_jsonb(j))="+lit(JSON.stringify(target.criteria))+"::jsonb,"+
 "'versionStale',j.updated_at<>"+lit(target.updatedAt)+"::timestamptz,"+
 "'syntheticTarget',j.county='Zola Acceptance' and j.property_type='acceptance',"+
 "'dispatchAbsent',not exists(select from buyer_writer.dispatches where id="+lit(dispatch)+"::uuid),"+
 "'noActiveDispatches',not exists(select from buyer_writer.dispatches where job_id=j.id and state in('pending','processing')),"+
 "'jobFailed',j.status='failed')) from public.\"SearchJob\" j cross join buyer_writer.operation_admissions a"+
 " where j.id="+lit(target.jobId)+"::uuid and a.issuer="+lit(handle.authority.issuer)+" and a.jti="+lit(handle.jti)+"::uuid; ROLLBACK;";
 // Existing host cluster administrator, bounded to one read-only observation.
 const raw=execFileSync('/usr/bin/docker',['exec','--user','70:70','-i','blackspire-owned-postgres','psql','-X','-qAt','-U','blackspire_cluster_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
  {input:sql,encoding:'utf8',timeout:10000,maxBuffer:8192,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 return JSON.parse(raw.trim());
}
export async function repairMixedRejectedWriter(context,call,{fence}){
 if(context.input.releaseSha!==P.releaseSha||context.release.operationId!==P.operationId||call.attemptId!==P.attemptId)fail();
 let lease;
 try{
  fence();
  const files=createBuyerStoreProtectedFiles(),stream=context.journal.stream('release');
  const stateFile=admissionRoot+'/state.json',gid=fs.statSync(stateFile).gid;
  lease=acquireReleaseAdmissionLock({root:admissionRoot,exclusive:true,owner:0,groupId:gid});
  const state=validateReleaseAdmissionState(JSON.parse(files.read(stateFile,{gid,mode:0o640})));
  const sequence=inspectReleaseSequenceHistory(stream.events()),a=sequence.outputs.admission_lease;
  if(sequence.pending?.stage!=='bounded_writer_e2e'||sequence.pending.attemptId!==P.attemptId||state.mode!=='held'
   ||state.releaseSha!==P.releaseSha||state.runId!==a?.epochRunId)fail();
  const lifecycle=await observeHeldLifecycle({releaseSha:P.releaseSha,runId:state.runId});
  if(lifecycle.api.generation!==a.apiGeneration||lifecycle.worker.generation!==a.workerGeneration||lifecycle.artifactDigest!==a.artifactDigest)fail();
  for(const n of ['premerge-reads-active.json','acceptance-active.json'])if(fs.existsSync(admissionRoot+'/'+n))fail();
  const targetGid=Number(execFileSync('/usr/bin/getent',['group','blackspire-api'],{encoding:'utf8',timeout:1000}).trim().split(':')[2]);
  if(!Number.isInteger(targetGid)||targetGid<1)fail();
  const read=()=>readOwnedConfigurationBytes(targetFile,{gid:targetGid,mode:0o640});
  const rows=stream.events(),prefix=rows.slice(0,P.eventCount),original=prefix.filter(r=>r.type==='bounded_writer_admission_handle'&&r.attemptId===P.attemptId).at(-1);
  if(prefix.length!==P.eventCount||hash(prefix)!==P.prefixDigest||hash(original)!==P.handleRowDigest)fail();
  const bound=Object.fromEntries(['releaseSha','operationId','workspace','principal','attemptId','inputDigest','checkOutputDigest'].map(k=>[k,original[k]]));
  files.directory(root,{create:true});
  let plan=files.value(root+'/plan.json',true);
  if(!plan){
   if(rows.length!==P.eventCount)fail();
   const before=read(),t=JSON.parse(before),profile=readOwnedDatabaseProfile();
   plan=buildMixedWriterTargetRefresh(before,observeMixedRejectedIssue(original.handle,t,bound),{profileDigest:databaseProfileDigest(profile),subject:original.handle.authority.subject});
   if(read()!==before)fail();lease.assertIdentity();fence();files.record(root+'/plan.json',plan);
  }
  if(!same(Object.keys(plan).sort(),['version','before','after','event'].sort())||plan.version!==1
   ||hash(plan.before)!==P.targetBeforeDigest||hash(plan.after)!==plan.event.targetAfterDigest)fail();
  const before=JSON.parse(plan.before),after=JSON.parse(plan.after);
  if(!same({...before,updatedAt:after.updatedAt},after)||after.updatedAt===before.updatedAt)fail();
  validateMixedWriterRejectionPrefix(prefix,plan.event);
  const terminal=rows[P.eventCount];
  if(terminal&&!same(terminal,plan.event))fail();
  if(!terminal){
   if(rows.length!==P.eventCount||read()!==plan.before)fail();
   const proof=observeMixedRejectedIssue(original.handle,before,bound);
   if(!same(proof.proof,plan.event.proof)||proof.updatedAt!==after.updatedAt)fail();
   lease.assertIdentity();fence();stream.append(plan.event);
  }
  const current=read();
  if(current!==plan.before&&current!==plan.after)fail();
  if(current===plan.before){
   const proof=observeMixedRejectedIssue(original.handle,before,bound);
   if(!same(proof.proof,plan.event.proof)||proof.updatedAt!==after.updatedAt)fail();
   lease.assertIdentity();fence();publishOwnedConfigurationBytes(targetFile,plan.before,plan.after,{gid:targetGid,mode:0o640});
  }
  if(read()!==plan.after)fail();
  lease.assertIdentity();fence();
  files.record(root+'/result.json',{version:1,status:'EXPIRED_UNISSUED_WRITER_RETIRED',eventDigest:hash(plan.event),targetAfterDigest:hash(plan.after)});
  const finalRows=stream.events(),Q=MIXED_WRITER_UNRESERVED;
  if(finalRows.length===Q.eventCount){
   const event=observeMixedUnreservedRetirement(finalRows,read());
   lease.assertIdentity();fence();stream.append(event);
  }else validateRetiredWriterPrefix(finalRows.slice(0,Q.eventCount),finalRows[Q.eventCount]);
  files.record(root+'/unreserved-result.json',{version:1,eventDigest:hash(stream.events()[Q.eventCount])});
  return {status:'EXPIRED_UNISSUED_WRITER_RETIRED'};
 }finally{lease?.close();}
}

export function observeMixedUnreservedRetirement(rows,targetBytes){
 const Q=MIXED_WRITER_UNRESERVED;
 if(rows.length!==Q.eventCount||hash(rows)!==Q.prefixDigest||hash(targetBytes)!==Q.targetDigest)fail();
 const handles=rows.filter(r=>r.type==='bounded_writer_admission_handle'&&r.attemptId===Q.attemptId);
 const old=handles[0]?.handle,current=handles[1]?.handle,t=JSON.parse(targetBytes);
 if(handles.length!==2||hash(handles[1])!==Q.handleRowDigest||current.requestId!==old.requestId||current.jti===old.jti)fail();
 const sql='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('+
 "'admissionAbsent',not exists(select from buyer_writer.operation_admissions where issuer="+lit(current.authority.issuer)+" and jti="+lit(current.jti)+"::uuid),"+
 "'originalExpiredReserved',a.expires_at<clock_timestamp() and a.state='reserved' and a.subject is null and a.result is null,"+
 "'requestCollision',a.request_id="+lit(current.requestId)+"::uuid and a.raw_body_digest="+lit(old.bodyDigest)+","+
 "'dispatchAbsent',not exists(select from buyer_writer.dispatches where id="+lit(current.requestId)+"::uuid),"+
 "'targetCurrent',j.updated_at="+lit(t.updatedAt)+"::timestamptz and j.user_id="+lit(t.ownerId)+"::uuid"+
 " and j.user_id="+lit(current.authority.subject)+"::uuid and buyer_writer.criteria(to_jsonb(j))="+lit(JSON.stringify(t.criteria))+"::jsonb"+
 " and j.county='Zola Acceptance' and j.property_type='acceptance' and j.status='failed',"+
 "'noActiveDispatches',not exists(select from buyer_writer.dispatches where job_id=j.id and state in('pending','processing')))"+
 " from buyer_writer.operation_admissions a cross join public.\"SearchJob\" j where a.issuer="+lit(old.authority.issuer)+" and a.jti="+lit(old.jti)+"::uuid and j.id="+lit(t.jobId)+"::uuid; ROLLBACK;";
 const raw=execFileSync('/usr/bin/docker',['exec','--user','70:70','-i','blackspire-owned-postgres','psql','-X','-qAt','-U','blackspire_cluster_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
 {input:sql,encoding:'utf8',timeout:10000,maxBuffer:8192,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 const proof=JSON.parse(raw.trim()),event={schema:1,type:Q.type,releaseSha:Q.releaseSha,operationId:Q.operationId,attemptId:Q.attemptId,
 prefixDigest:Q.prefixDigest,handleDigest:Q.handleDigest,targetDigest:Q.targetDigest,proof,proofDigest:hash(proof)};
 validateRetiredWriterPrefix(rows,event);return event;
}
