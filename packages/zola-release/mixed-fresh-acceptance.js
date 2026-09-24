import {DatabaseSync} from 'node:sqlite';
import {MIXED_READ_ROWS} from './mixed-read-failure.js';
import {partitionRetiredReleaseHistory} from './retired-release-history.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {createMixedAuthorityArchiveStore} from './mixed-authority-archive-host.js';
import {createMixedAuthorityArchiveFiles,verifyMixedAuthorityArchive} from './mixed-authority-archive.js';
import {MIXED_PREVIEW} from './mixed-preview-adoption.js';
import {verifyHeldCanonicalWriter} from './held-writer-binding.js';

import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {recoveryDigest as hash,readRecoveryJournal} from './admitted-read-recovery.js';
import {MIXED_RETIREMENT as M,validateMixedRetirementEvent} from './mixed-retirement-history.js';
const P={...M,releaseSha:M.successorReleaseSha,operationId:M.successorOperationId};

const R='/var/lib/blackspire-operator/preparation/mixed-successor-acceptance-'+P.operationId,A='/etc/blackspire/release-admission';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readOwnedConfigurationBytes as read,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
import {openReleaseJournal} from './commander-journal.js';
import {readCases,validateCollectorConfig} from '../zola-six-reads/collector.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState,validatePremergeReadClaims,validatePremergeReadActive} from '../shared/release-admission.js';
import {successorEvidence} from '../zola-six-reads/owned-collector-successor.js';

const fail=()=>{throw Error('MIXED_SUCCESSOR_FRESH_ACCEPTANCE_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const records=createBuyerStoreProtectedFiles();
const value=name=>records.value(R+'/'+name+'.json');
const required=(file,options)=>{const bytes=read(file,options);if(bytes===null)fail();return bytes;};
const run=(script,args,timeout=180000)=>{
 const out=execFileSync('/opt/nodejs/node-v22.23.1-linux-x64/bin/node',['/opt/blackspire-command/releases/'+P.releaseSha+'/'+script,...args],{
 cwd:'/opt/blackspire-command/releases/'+P.releaseSha,encoding:'utf8',timeout,maxBuffer:1024*1024,
 stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 return JSON.parse(out);
};

const SOURCE_CONFIG='/var/lib/blackspire-operator/preparation/credential-recovery-20260924/collector-config.json';
const fixedConfig='/var/lib/blackspire-operator/preparation/six-read-premerge-config.json';

function verifyRetainedReadRows(){
 const base='/var/lib/blackspire-operator/preparation/credential-recovery-20260924';
 for(const [file,digest]of [[base+'/acceptance/release.jsonl',M.acceptanceDigest],[base+'/collector/'+M.runId+'.jsonl',M.collectorDigest]]){
  const bytes=Buffer.from(required(file,{gid:0,mode:0o600,maxBytes:1048576}));
  readRecoveryJournal(bytes,digest);
 }
 const config=records.value(SOURCE_CONFIG),identity=records.value(base+'/denial-receipt.json').databaseIdentity;
 if(hash(config)!==M.configDigest)fail();
 const check=()=>{const s=fs.lstatSync(config.databasePath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o007)||['dev','ino','uid'].some(k=>s[k]!==identity[k]))fail();};
 check();const db=new DatabaseSync(config.databasePath,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
  for(const row of MIXED_READ_ROWS){
   const tasks=db.prepare('SELECT * FROM tasks WHERE idempotency_key=?').all('unified:jarvis:zola-six:'+M.runId+':'+row.index);
   const attempts=db.prepare('SELECT * FROM provider_attempts WHERE task_id=?').all(row.id);
   if(tasks.length!==1||attempts.length!==1||hash(tasks[0])!==row.taskDigest||hash(attempts[0])!==row.attemptDigest
    ||hash(db.prepare('SELECT * FROM unified_inputs WHERE id=?').get(tasks[0].input_id))!==row.inputDigest)fail();
  }
  for(let i=2;i<6;i++)if(db.prepare('SELECT count(*) n FROM tasks WHERE idempotency_key=?').get('unified:jarvis:zola-six:'+M.runId+':'+i).n
   ||db.prepare('SELECT count(*) n FROM unified_inputs WHERE idempotency_key=?').get('zola-six:'+M.runId+':'+i).n)fail();
 }finally{try{db.exec('ROLLBACK');}finally{db.close();}}
 check();
}

async function mixedAcceptanceBinding(context){
 verifyRetainedReadRows();
 if(context.release?.schema!==3||hash(context.release)!==M.successorInputDigest
  ||context.input.releaseSha!==M.successorReleaseSha)fail();
 const events=context.journal.stream('release').events(),partition=partitionRetiredReleaseHistory(events);
 const retired=events[M.eventCount];validateMixedRetirementEvent(retired);
 const state=inspectReleaseSequenceHistory(events);
 if(state.context?.operationId!==M.successorOperationId||state.context.releaseSha!==M.successorReleaseSha
  ||state.nextOrdinal!==13||state.pending&&state.pending.stage!=='six_reads')fail();
 const archiveStore=createMixedAuthorityArchiveStore();
 const archive=verifyMixedAuthorityArchive(archiveStore.read('plan'),{store:archiveStore,files:createMixedAuthorityArchiveFiles(),retired});
 const hold=partition.current.find(e=>e.type==='release_hold_result');
 const gid=fs.lstatSync(A+'/state.json').gid,admission=validateReleaseAdmissionState(JSON.parse(required(A+'/state.json',{gid,mode:0o640})));
 if(!hold||admission.mode!=='held'||admission.releaseSha!==M.successorReleaseSha||admission.runId!==hold.runId
  ||admission.runId===M.runId||admission.apiGeneration!==null||admission.workerGeneration!==null)fail();
 const lifecycle=await observeHeldLifecycle({releaseSha:M.successorReleaseSha,runId:admission.runId});
 const writer=await verifyHeldCanonicalWriter({releaseSha:M.successorReleaseSha,journal:context.journal});
 if(writer.runId!==admission.runId)fail();
 const b={version:1,releaseSha:M.successorReleaseSha,operationId:M.successorOperationId,runId:admission.runId,
  lifecycleDigest:hash(lifecycle),writerDigest:hash(writer),archiveDigest:hash(archive),retirementDigest:hash(retired)};
 return {binding:b,lifecycle,gid,state};
}
export async function prepareMixedReadAcceptance(context){
 const b=await mixedAcceptanceBinding(context);
 const old=validateCollectorConfig(records.value(SOURCE_CONFIG));
 if(old.releaseSha!==M.releaseSha||old.runId!==M.runId||hash(old)!==M.configDigest)fail();
 records.directory(R,{create:true});records.directory(R+'/collector',{create:true});
 const config=validateCollectorConfig({...old,releaseSha:M.successorReleaseSha,runId:b.binding.runId,
  frontendOrigin:MIXED_PREVIEW.frontendOrigin,apiPid:b.lifecycle.api.pid,workerPid:b.lifecycle.worker.pid,
  journalDirectory:R+'/collector',denialReceiptPath:R+'/denial-receipt.json'});
 records.record(R+'/authority.json',b.binding);records.record(R+'/collector-config.json',config);
 records.record(R+'/lifecycle.json',b.lifecycle);
 records.record(R+'/denial-input.json',{deniedPrincipal:config.deniedPrincipal,outputPath:config.denialReceiptPath,
  releaseSha:M.successorReleaseSha,runId:config.runId,workspace:config.workspace});
 const prior=required(fixedConfig,{gid:0,mode:0o600});
 if(!same(JSON.parse(prior),old)&&!same(JSON.parse(prior),config))fail();
 if(!same((await mixedAcceptanceBinding(context)).binding,b.binding))fail();
 publishOwnedConfigurationBytes(fixedConfig,JSON.stringify(old)+'\n',JSON.stringify(config)+'\n');
 return {status:'MIXED_READ_ACCEPTANCE_PREPARED',configDigest:hash(config),authorityDigest:hash(b.binding)};
}
export async function fenceMixedReadAcceptance(context,call){
 const b=await mixedAcceptanceBinding(context),config=validateCollectorConfig(value('collector-config'));
 const pending=b.state.pending;
 if(!pending||pending.stage!=='six_reads'||pending.attemptId!==call.attemptId
  ||pending.inputDigest!==call.inputDigest||pending.checkOutputDigest!==call.checkOutputDigest
  ||!same(b.binding,value('authority'))||!same(b.lifecycle,value('lifecycle'))
  ||config.version!==6||config.releaseSha!==M.successorReleaseSha||config.runId!==b.binding.runId
  ||config.frontendOrigin!==MIXED_PREVIEW.frontendOrigin
  ||config.apiPid!==b.lifecycle.api.pid||config.workerPid!==b.lifecycle.worker.pid
  ||hash(JSON.parse(required(fixedConfig,{gid:0,mode:0o600})))!==hash(config))fail();
 return {plan:{newRunId:b.binding.runId},config,lifecycle:b.lifecycle,gid:b.gid,authorityDigest:hash(b.binding)};
}

export function inspectMixedReadHistory(events){
 if(!Array.isArray(events)||events.length>6)fail();
 const order=['denial_intent','denial_result','permit_intent','permit_active','collector_result','permit_retired'];
 const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
 const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 let next=0,intent=null,result=null,retired=false,denial=null;
 for(const e of events){
  if(e?.version!==1||retired)fail();
  if(e.type==='permit_retired'){
   if(!exact(e,'version,type,claimsDigest,outcome')||!intent||e.outcome!==(result?'PASS':'UNKNOWN')||e.claimsDigest!==intent.claimsDigest)fail();
   retired=true;continue;
  }
  if(e.type!==order[next])fail();
  if(e.type==='denial_intent'){
   if(!exact(e,'version,type,runId,authorityDigest')||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(e.runId??'')
    ||e.runId===M.runId||!digest(e.authorityDigest))fail();denial=e;
  }else if(e.type==='denial_result'){
   if(!exact(e,'version,type,runId,receiptDigest')||e.runId!==denial.runId||!digest(e.receiptDigest))fail();
  }else if(e.type==='permit_intent'){
   if(!exact(e,'version,type,claims,claimsDigest,configDigest,authorityDigest')||e.authorityDigest!==denial.authorityDigest||!digest(e.configDigest))fail();
   const claims=validatePremergeReadClaims(e.claims);
   if(hash(claims)!==e.claimsDigest||claims.commanderRunId!==P.operationId||claims.candidateSha!==P.releaseSha
    ||claims.expectedDeploymentSha!==P.releaseSha||claims.epochRunId!==denial.runId)fail();intent=e;
  }else if(e.type==='permit_active'){
   if(!exact(e,'version,type,claimsDigest')||e.claimsDigest!==intent.claimsDigest)fail();
  }else if(e.type==='collector_result'){
   if(!exact(e,'version,type,claimsDigest,evidence,evidenceDigest')||e.claimsDigest!==intent.claimsDigest
    ||hash(e.evidence)!==e.evidenceDigest)fail();successorEvidence(e.evidence);result=e;
  }
  next++;
 }
 return {next,intent,result,retired};
}
export async function collectMixedSuccessorReads(context,call){
 let journal,lease,activated=false,claims;
 const b=await fenceMixedReadAcceptance(context,call);
 const root=R+'/acceptance';records.directory(root,{create:true});
 journal=openReleaseJournal({root});
 const stream=journal.stream('release'),append=e=>{inspectMixedReadHistory([...stream.events(),e]);stream.append(e);};
 const fence=async()=>{const now=await fenceMixedReadAcceptance(context,call);if(!same(now,b))fail();};
 const publish=(name,v,gid,mode)=>{
  if(fs.existsSync(A+'/'+name))fail();
  records.publish(A+'/'+name,Buffer.from(JSON.stringify(v)+'\n'),{gid,mode});
 };
 const retire=outcome=>{
  lease?.close();lease=acquireReleaseAdmissionLock({root:A,exclusive:true,allowPending:true,owner:0,groupId:b.gid});
  if(hash(validatePremergeReadClaims(JSON.parse(required(A+'/premerge-reads.json',{gid:b.gid,mode:0o640}))))!==hash(claims))fail();
  const active=JSON.parse(required(A+'/premerge-reads-active.json',{gid:b.gid,mode:0o640}));
  if(validatePremergeReadActive(active,claims).attemptId!==call.attemptId)fail();
  fs.unlinkSync(A+'/premerge-reads-active.json');const fd=fs.openSync(A,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  append({version:1,type:'permit_retired',claimsDigest:hash(claims),outcome});activated=false;lease.close();lease=null;
 };
 try{
  const prior=inspectMixedReadHistory(stream.events());
  if(prior.intent&&(prior.intent.configDigest!==hash(b.config)||prior.intent.authorityDigest!==b.authorityDigest
   ||prior.intent.claims.epochRunId!==b.plan.newRunId||prior.intent.claims.apiGeneration!==b.lifecycle.api.generation
   ||prior.intent.claims.workerGeneration!==b.lifecycle.worker.generation))fail();
  if(prior.result){
   claims=prior.intent.claims;
   const verified=mixedCollectorEvidence(value('collector-report'),claims);
   if(!same(verified,prior.result.evidence))fail();
   if(prior.retired){if(fs.existsSync(A+'/premerge-reads-active.json'))fail();}
   else if(fs.existsSync(A+'/premerge-reads-active.json'))retire('PASS');
   else{
    lease=acquireReleaseAdmissionLock({root:A,exclusive:true,allowPending:true,owner:0,groupId:b.gid});
    if(hash(validatePremergeReadClaims(JSON.parse(required(A+'/premerge-reads.json',{gid:b.gid,mode:0o640}))))!==hash(claims))fail();
    append({version:1,type:'permit_retired',claimsDigest:hash(claims),outcome:'PASS'});lease.close();lease=null;
   }
   return verified;
  }
  // Any earlier intent without a complete successful result is retained UNKNOWN.
  if(stream.events().length)fail();
  await fence();append({version:1,type:'denial_intent',runId:b.plan.newRunId,authorityDigest:b.authorityDigest});
  const denial=run('scripts/zola-denial-session.js',['--issue',R+'/denial-input.json'],30000);
  if(denial.status!=='DELEGATED_DENIAL_ISSUED')fail();
  append({version:1,type:'denial_result',runId:b.plan.newRunId,receiptDigest:hash(required(R+'/denial-receipt.json',{gid:0,mode:0o600}))});
  await fence();lease=acquireReleaseAdmissionLock({root:A,exclusive:true,allowPending:true,owner:0,groupId:b.gid});lease.assertIdentity();
  for(const name of ['premerge-reads.json','premerge-reads-secret.json','premerge-reads-active.json'])if(fs.existsSync(A+'/'+name))fail();
  const token=randomBytes(32).toString('base64url'),issuedAt=Date.now(),reads=readCases(b.config.dealId).map((row,index)=>{
   const idempotencyKey='zola-six:'+b.plan.newRunId+':'+index;
   return{index,idempotencyKey,capability:row.capability,permission:row.permissions[0],request:row.text,requestDigest:hash({channel:'jarvis',workspaceId:b.config.workspace,text:row.text,idempotencyKey,executionIntent:'read_only'})};
  });
  claims=validatePremergeReadClaims({schema:1,kind:'held-premerge-reads',permitId:randomUUID(),commanderRunId:P.operationId,candidateSha:P.releaseSha,
   expectedDeploymentSha:P.releaseSha,epochRunId:b.plan.newRunId,workspace:b.config.workspace,principal:b.config.principal,
   apiGeneration:b.lifecycle.api.generation,workerGeneration:b.lifecycle.worker.generation,issuedAt,expiresAt:issuedAt+900000,operations:['six_reads'],reads,tokenDigest:hash(token)});
  append({version:1,type:'permit_intent',claims,claimsDigest:hash(claims),configDigest:hash(b.config),authorityDigest:b.authorityDigest});
  publish('premerge-reads-secret.json',{schema:1,permitId:claims.permitId,token},0,0o600);
  publish('premerge-reads.json',claims,b.gid,0o640);
  publish('premerge-reads-active.json',{schema:1,kind:'held-premerge-reads-active',permitId:claims.permitId,claimsDigest:hash(claims),operation:'six_reads',attemptId:call.attemptId,expiresAt:claims.expiresAt},b.gid,0o640);
  activated=true;append({version:1,type:'permit_active',claimsDigest:hash(claims)});lease.close();lease=null;
  const report=run('scripts/zola-six-read-collect.js',['--premerge-held','/var/lib/blackspire-operator/preparation/six-read-premerge-config.json']);
  const proof=mixedCollectorEvidence(report,claims);
  records.record(R+'/collector-report.json',report);
  append({version:1,type:'collector_result',claimsDigest:hash(claims),evidence:proof,evidenceDigest:hash(proof)});
  retire('PASS');await fence();return proof;
 }catch(e){
  if(activated){try{retire(inspectMixedReadHistory(stream.events()).result?'PASS':'UNKNOWN');}catch{}}
  throw e;
 }finally{lease?.close();journal?.close();}
}
export function mixedCollectorEvidence(report,claims){
 validatePremergeReadClaims(claims);
 if(claims.commanderRunId!==P.operationId||claims.candidateSha!==P.releaseSha||claims.expectedDeploymentSha!==P.releaseSha||claims.epochRunId===M.runId
  ||report?.releaseSha!==P.releaseSha||report.livePass!==false||!report.databaseEvidence||report.results?.length!==6
  ||report.premergeAcceptance?.permitId!==claims.permitId||report.premergeAcceptance?.claimsDigest!==hash(claims)
  ||report.results.some((r,i)=>r.capability!==claims.reads[i].capability||!r.crossOwnerDenial?.startsWith('PASS:')
    ||r.mutationDelta!==0||r.capability==='nexus.enrichment.status'&&r.paidProviderCalls!==0))fail();
 return successorEvidence({readCount:6,crossOwnerDenials:6,paidProviderCalls:0,mutationDelta:0,collectorDigest:hash(report)});
}

export function wrapMixedReadAcceptanceOperations(context,operations){
 const run=async call=>({status:'PASS',evidence:{stage:'six_reads',...await collectMixedSuccessorReads(context,call)}});
 return {...operations,six_reads:{
  async check(){await prepareMixedReadAcceptance(context);return {status:'PASS',evidence:{stage:'six_reads',fixedCollector:true}};},
  execute:run,reconcile:run,observe:run,
 }};
}
