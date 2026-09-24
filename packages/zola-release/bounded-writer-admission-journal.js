import {partitionRetiredReleaseHistory} from './retired-release-history.js';
import {buyerWriterAdmissionHandleDigest} from '../buyer-writer/admitted-local-client.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';

const reject=()=>{throw new Error('Bounded writer admission journal rejected');};
const keys=['releaseSha','operationId','workspace','principal','attemptId','inputDigest','checkOutputDigest'];
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
const type='bounded_writer_admission_handle';
const operations=['issue','apply','reconcile','receipt'];

// Read-only whole-history inspection validates each handle where it was appended.
// A later stage confirmation must not make a previously valid handle unreadable.
export function inspectBoundedWriterAdmissionHistory(events){
 if(!Array.isArray(events)||events.length>16384)reject();
 inspectReleaseSequenceHistory(events);
 const found=[];
 for(let index=0;index<events.length;index++){
  const row=events[index];if(row?.type!==type)continue;
  const bound=Object.fromEntries(keys.map(key=>[key,row[key]]));
  const prefix=events.slice(0,index+1);
  const journal=createBoundedWriterAdmissionJournal({events:()=>prefix,append:()=>{reject();}},bound);
  const entries=journal.entries(),validated=entries.find(entry=>entry.operation===row.operation);
  if(!validated||JSON.stringify(validated)!==JSON.stringify(row))reject();
  found.push(validated);
 }
 return structuredClone(found);
}

// Only sanitized correlation metadata enters the already fsync-backed release
// stream. The enclosing sequence intent remains the authority for this attempt.
export function createBoundedWriterAdmissionJournal(stream,bound){
 if(!stream||typeof stream.events!=='function'||typeof stream.append!=='function'||!exact(bound,keys))reject();
 bound=Object.freeze({...bound});
 const inspect=()=>{
  const events=stream.events(),sequence=inspectReleaseSequenceHistory(events),pending=sequence.pending;
  if(!pending||pending.stage!=='bounded_writer_e2e'||sequence.context.releaseSha!==bound.releaseSha
   ||sequence.context.operationId!==bound.operationId||sequence.context.workspace!==bound.workspace
   ||sequence.context.principal!==bound.principal
   ||['attemptId','inputDigest','checkOutputDigest'].some(k=>pending[k]!==bound[k]))reject();
  const found=new Map();
  for(const event of partitionRetiredReleaseHistory(events).current.filter(row=>row?.type===type)){
   if(!exact(event,['schema','type',...keys,'operation','handle','handleDigest'])||event.schema!==1)reject();
   // This stream cannot silently adopt another run's unfinished writer intent.
   if(keys.some(k=>event[k]!==bound[k])||!operations.includes(event.operation)||found.has(event.operation))reject();
   if(event.handle.outerAttemptId!==bound.attemptId||event.handle.operation!==event.operation
    ||event.handle.authority.releaseSha!==bound.releaseSha
    ||buyerWriterAdmissionHandleDigest(event.handle)!==event.handleDigest)reject();
   found.set(event.operation,event);
  }
  const ordered=[...found.keys()];
  if(ordered.some((op,i)=>op==='issue'?i!==0:op==='apply'?!found.has('issue')||i!==1
    :op==='receipt'?!found.has('apply')||!found.has('reconcile'):!found.has('issue')))reject();
  return found;
 };
 inspect();
 return Object.freeze({
  entries:()=>[...inspect().values()].map(row=>structuredClone(row)),
  options(operation){
   const existing=inspect();
   if(!operations.includes(operation)||existing.has(operation)
    ||operation==='issue'&&existing.size!==0
    ||operation==='apply'&&(!existing.has('issue')||existing.size!==1)
    ||operation==='reconcile'&&!existing.has('issue')
    ||operation==='receipt'&&(!existing.has('apply')||!existing.has('reconcile')))reject();
   return {outerAttemptId:bound.attemptId,persistHandle:async(handle,handleDigest)=>{
    const rows=inspect();
    if(rows.has(operation)||handle.operation!==operation||handle.outerAttemptId!==bound.attemptId
     ||handle.authority.releaseSha!==bound.releaseSha||buyerWriterAdmissionHandleDigest(handle)!==handleDigest)reject();
    const event={schema:1,type,...bound,operation,handle:structuredClone(handle),handleDigest};
    await stream.append(event);
    const saved=inspect().get(operation);
    if(!saved||JSON.stringify(saved)!==JSON.stringify(event))reject();
   }};
  },
  async recoverAll(database){
   if(typeof database?.recoverHandle!=='function')reject();
   const recovered=new Map();
   for(const row of inspect().values()){
    const value=await database.recoverHandle(row.handle,{outerAttemptId:bound.attemptId,expectedHandleDigest:row.handleDigest});
    if(value?.requestCorrelated!==true||value.handleDigest!==row.handleDigest)reject();
    recovered.set(row.operation,value);
   }
   return recovered;
  },
 });
}
