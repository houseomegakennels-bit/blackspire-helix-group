import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {hash} from './commander-journal.js';
import {inspectReleaseSequence} from './commander-sequence.js';
import {HELD_ACCEPTANCE_CAPABILITIES,inspectHeldAcceptanceHistory} from './held-acceptance-authority.js';
import {compareDivisionSnapshots,validateOwnerWitness} from '../zola-six-reads/database-observer.js';
import {digest as collectorDigest} from '../zola-six-reads/collector.js';

export const PRODUCTION_COMMAND_DATABASE='/opt/blackspire-command/shared/database/command.sqlite';
export const PRODUCTION_COLLECTOR_JOURNAL_ROOT='/var/lib/blackspire-operator/preparation/six-read-journals';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const reject=()=>{throw new Error('Fixed production zero-proof operation rejected');};
const blocked=()=>Object.freeze({status:'BLOCKED_EXTERNAL'});

function invocation(context,call,operation,{attempt=true}={}){
 const input=context?.input,state=call?.state,operationId=state?.context?.operationId;
 if(call?.input!==input||!sha(input?.releaseSha)||!id(input?.workspace)||!id(input?.principal)||!uuid(operationId)
  ||state.context.releaseSha!==input.releaseSha||state.context.workspace!==input.workspace||state.context.principal!==input.principal)reject();
 if(attempt&&(!uuid(call.attemptId)||!digest(call.inputDigest)||!digest(call.checkOutputDigest)
  ||state.pending?.stage!==operation||state.pending.attemptId!==call.attemptId))reject();
 const events=context.journal.stream('release').events(),held=inspectHeldAcceptanceHistory(events),claims=held.claims;
 if(held.status!=='CONSUMING'||held.pending?.operation!==operation||!claims||claims.commanderRunId!==operationId
  ||claims.mergeMainSha!==input.releaseSha||claims.expectedDeploymentSha!==input.releaseSha
  ||claims.workspace!==input.workspace||claims.principal!==input.principal||!uuid(claims.epochRunId))reject();
 return{releaseSha:input.releaseSha,operationId,stageAttemptId:attempt?call.attemptId:null,workspace:input.workspace,
  principal:input.principal,epochRunId:claims.epochRunId,apiGeneration:claims.apiGeneration,workerGeneration:claims.workerGeneration,held,events};
}

function secureFile(filename,root){
 if(!path.isAbsolute(filename)||path.resolve(filename)!==filename||!filename.startsWith(`${root}/`))reject();
 for(let current=path.dirname(filename);;current=path.dirname(current)){
  const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022))reject();
  if(current==='/')break;
 }
 const stat=fs.lstatSync(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o7777)!==0o600||stat.size<1||stat.size>1024*1024)reject();
 return stat;
}

function parseJournal(filename,root){
 const stat=secureFile(filename,root),bytes=fs.readFileSync(filename,'utf8');
 if(Buffer.byteLength(bytes)!==stat.size||!bytes.endsWith('\n'))reject();
 const events=[];let previous='0'.repeat(64);
 for(const line of bytes.split('\n').filter(Boolean)){
  let row;try{row=JSON.parse(line);}catch{reject();}
  const body={sequence:events.length,previous,event:row?.event};
  if(Object.keys(row??{}).sort().join(',')!=='digest,event,previous,sequence'||row.sequence!==events.length
   ||row.previous!==previous||row.digest!==collectorDigest(body))reject();
  previous=row.digest;events.push(row.event);
 }
 const current=fs.lstatSync(filename);if(current.dev!==stat.dev||current.ino!==stat.ino||current.size!==stat.size)reject();
 return events;
}

export function readFixedCollectorEvidence(binding,{root=PRODUCTION_COLLECTOR_JOURNAL_ROOT}={}){
 try{
  const rootStat=fs.lstatSync(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.uid!==0||(rootStat.mode&0o7777)!==0o700)reject();
  const names=fs.readdirSync(root).filter(name=>name.endsWith('.jsonl'));
  if(names.length>128)reject();
  const matches=[];
  for(const name of names){
   try{fs.lstatSync(path.join(root,`${name.slice(0,-6)}.lock`));continue;}catch(error){if(error.code!=='ENOENT')throw error;}
   const events=parseJournal(path.join(root,name),root),reports=events.filter(row=>row?.type==='report');
   if(reports.length!==1)continue;
   const reportEvent=reports[0],run=events.filter(row=>row?.type==='run');
   if(run.length===1&&run[0].releaseSha===binding.releaseSha&&reportEvent.status==='PASS_LIVE_ACCEPTANCE'
    &&reportEvent.digest===heldReadEvidence(binding).collectorDigest)matches.push({events,reportDigest:reportEvent.digest});
  }
  return matches.length===1?matches[0]:null;
 }catch(error){if(error?.message==='Fixed production zero-proof operation rejected')throw error;return null;}
}

function heldReadEvidence(binding){
 const read=binding.events.find(row=>row?.type==='held_acceptance_operation_result'&&row.operation==='six_live_reads')?.evidence;
 if(!read||read.status!=='PASS_LIVE_ACCEPTANCE'||read.livePass!==true||read.readCount!==6||read.crossOwnerDenials!==6
  ||read.paidProviderCalls!==0||read.mutationDelta!==0||!digest(read.collectorDigest))reject();
 return read;
}

export function readFixedCommandUsage(binding,{databasePath=PRODUCTION_COMMAND_DATABASE}={}){
 let database,stat;
 try{
  if(path.resolve(databasePath)!==databasePath)reject();stat=fs.lstatSync(databasePath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)reject();
  database=new DatabaseSync(databasePath,{readOnly:true});database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
  const tasks=[],attempts=[],usage=[];
  for(const [index,capability] of HELD_ACCEPTANCE_CAPABILITIES.entries()){
   const key=`unified:jarvis:zola-six:${binding.epochRunId}:${index}`;
   const found=database.prepare('SELECT id,workspace_id,actor_id,status,idempotency_key FROM tasks WHERE idempotency_key=? LIMIT 2').all(key);
   if(found.length!==1)reject();const task=found[0];tasks.push(task);
   attempts.push(...database.prepare('SELECT id,task_id,provider,mode,status FROM provider_attempts WHERE task_id=? LIMIT 3').all(task.id));
   usage.push(...database.prepare('SELECT attempt_id,task_id,provider,cost_cents,monetary_cost_state FROM provider_usage WHERE task_id=? LIMIT 3').all(task.id));
   if(attempts.at(-1)?.mode!==capability)reject();
  }
  const current=fs.lstatSync(databasePath);if(current.dev!==stat.dev||current.ino!==stat.ino)reject();
  return{tasks,attempts,usage,databaseIdentity:{device:stat.dev,inode:stat.ino}};
 }catch(error){if(error?.message==='Fixed production zero-proof operation rejected')throw error;return null;}
 finally{try{database?.exec('ROLLBACK');}catch{}try{database?.close();}catch{}}
}

function validateCollector(binding,source){
 const events=source?.events,read=heldReadEvidence(binding);
 if(!Array.isArray(events)||source.reportDigest!==read.collectorDigest)reject();
 const run=events.filter(row=>row?.type==='run'),reports=events.filter(row=>row?.type==='report');
 if(run.length!==1||run[0].releaseSha!==binding.releaseSha||reports.length!==1||reports[0].digest!==source.reportDigest
  ||reports[0].status!=='PASS_LIVE_ACCEPTANCE')reject();
 const intents=events.filter(row=>row?.type==='intent'),collected=events.filter(row=>row?.type==='collected');
 if(intents.length!==6||collected.length!==6||new Set(intents.map(row=>row.index)).size!==6||new Set(collected.map(row=>row.index)).size!==6
  ||intents.some((row,index)=>row.index!==index||row.key!==`zola-six:${binding.epochRunId}:${index}`)
  ||collected.some((row,index)=>row.index!==index||!id(row.taskId)||!digest(row.evidenceDigest)))reject();
 return source.reportDigest;
}

function paidEvidence(binding,source,command){
 const reportDigest=validateCollector(binding,source);
 if(!command||!Array.isArray(command.tasks)||!Array.isArray(command.attempts)||!Array.isArray(command.usage)
  ||command.tasks.length!==6||command.attempts.length!==6||!Number.isSafeInteger(command.databaseIdentity?.device)
  ||!Number.isSafeInteger(command.databaseIdentity?.inode))reject();
 for(const [index,capability] of HELD_ACCEPTANCE_CAPABILITIES.entries()){
  const task=command.tasks[index],attempts=command.attempts.filter(item=>item.task_id===task.id),usage=command.usage.filter(item=>item.task_id===task.id);
  if(task.workspace_id!==binding.workspace||task.actor_id!==binding.principal||task.status!=='completed'
   ||task.idempotency_key!==`unified:jarvis:zola-six:${binding.epochRunId}:${index}`||attempts.length!==1
   ||task.id!==source.events.find(item=>item?.type==='collected'&&item.index===index)?.taskId
   ||attempts[0].provider!=='blackspire-capability'||attempts[0].mode!==capability||attempts[0].status!=='completed'
   ||usage.some(item=>item.attempt_id!==attempts[0].id||item.provider!=='blackspire-capability'||!Number.isSafeInteger(item.cost_cents)||item.cost_cents<0))reject();
 }
 const paidProviderCalls=command.usage.filter(row=>row.cost_cents>0).length;if(paidProviderCalls!==0)reject();
 const core={releaseSha:binding.releaseSha,operationId:binding.operationId,stageAttemptId:binding.stageAttemptId,
  epochRunId:binding.epochRunId,workspace:binding.workspace,principal:binding.principal,apiGeneration:binding.apiGeneration,
  workerGeneration:binding.workerGeneration,paidProviderCalls,taskCount:6,attemptCount:6,collectorDigest:reportDigest,
  commandEvidenceDigest:hash(command)};
 return Object.freeze({status:'PASS',evidence:Object.freeze({...core,usageDigest:hash(core)})});
}

function mutationEvidence(context,binding,source){
 const reportDigest=validateCollector(binding,source),before=source.events.filter(row=>row?.type==='database_before'),after=source.events.filter(row=>row?.type==='database_after');
 if(before.length!==1||after.length!==1)reject();
 const config={releaseSha:binding.releaseSha,runId:before[0].observation?.snapshot?.runId};
 validateOwnerWitness(before[0].observation?.owner,config,'before');validateOwnerWitness(after[0].observation?.owner,config,'after');
 if(before[0].observation.owner.witness!==after[0].observation.owner.witness)reject();
 const compared=compareDivisionSnapshots(before[0].observation.snapshot,after[0].observation.snapshot,config);
 if(compared.netMutationDelta!==0||compared.tupleVersionDelta!==0||!after[0].evidence
  ||Object.entries(compared).some(([key,value])=>JSON.stringify(after[0].evidence[key])!==JSON.stringify(value))
  ||typeof after[0].evidence.ownerDenial!=='string'||typeof after[0].evidence.ownerScope!=='string')reject();
 const sequence=inspectReleaseSequence(context.journal.stream('release').events()),writer=sequence.outputs.bounded_writer_e2e;
 if(sequence.context.operationId!==binding.operationId||writer?.boundedWriterAcceptance!==true||writer.businessRowsChanged!==0
  ||writer.compensationComplete!==true||!digest(writer.receiptDigest)||!sequence.outputs.production_migrations||!sequence.outputs.migration_postconditions)reject();
 const allowedChanges={migrationDigest:hash({apply:sequence.outputs.production_migrations,postconditions:sequence.outputs.migration_postconditions}),
  writerReceiptDigest:writer.receiptDigest,releaseJournalDigest:hash({operationId:binding.operationId,nextOrdinal:sequence.nextOrdinal})};
 const core={releaseSha:binding.releaseSha,operationId:binding.operationId,stageAttemptId:binding.stageAttemptId,
  epochRunId:binding.epochRunId,workspace:binding.workspace,principal:binding.principal,apiGeneration:binding.apiGeneration,
  workerGeneration:binding.workerGeneration,mutationDelta:0,unexpectedBusinessRows:0,crossOwnerChanges:0,enrichmentChanges:0,
  additionalWrites:0,unknownDelta:false,tableCount:compared.tableCount,rowCount:compared.rowCount,
  preSnapshotDigest:collectorDigest(before[0].observation.snapshot),postSnapshotDigest:collectorDigest(after[0].observation.snapshot),
  allowedChangesDigest:hash(allowedChanges),collectorDigest:reportDigest};
 return Object.freeze({status:'PASS',evidence:Object.freeze({...core,mutationDigest:hash(core)})});
}

function operation(context,name,observer){
 return Object.freeze({
  check(call){const bound=invocation(context,call,name,{attempt:false});return{status:'PASS',evidence:{releaseSha:bound.releaseSha,
   operationId:bound.operationId,workspace:bound.workspace,principal:bound.principal,epochRunId:bound.epochRunId,stage:name,readOnlyProof:true}};},
  execute(call){invocation(context,call,name);},
  observe:call=>observer(invocation(context,call,name),call),
  reconcile:call=>observer(invocation(context,call,name),call),
 });
}

export function createZeroProofProductionOperations(context,{readCollector=readFixedCollectorEvidence,readUsage=readFixedCommandUsage}={}){
 if(typeof readCollector!=='function'||typeof readUsage!=='function')reject();
 const collect=async binding=>{try{return await readCollector(binding);}catch(error){if(error?.message=== 'Fixed production zero-proof operation rejected')throw error;return null;}};
 return Object.freeze({
  zero_paid_nexus:operation(context,'zero_paid_nexus',async binding=>{
   const source=await collect(binding);if(!source)return blocked();validateCollector(binding,source);
   let command;try{command=await readUsage(binding);}catch(error){if(error?.message==='Fixed production zero-proof operation rejected')throw error;return blocked();}
   return command?paidEvidence(binding,source,command):blocked();
  }),
  zero_unintended_mutation:operation(context,'zero_unintended_mutation',async binding=>{
   const source=await collect(binding);return source?mutationEvidence(context,binding,source):blocked();
  }),
 });
}
