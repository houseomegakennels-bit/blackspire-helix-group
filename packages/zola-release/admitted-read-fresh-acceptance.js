import {readPriorReadRecovery} from './admitted-read-prior-recovery.js';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash,readRecoveryJournal} from './admitted-read-recovery.js';
import {inspectReadRecoveryTransition,validateReadRecoveryPlan} from './admitted-read-transition.js';
import {READ_RECOVERY_ROOT as R,READ_RECOVERY_ADMISSION as A} from './admitted-read-transition-preparation.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readOwnedConfigurationBytes as read} from './owned-buyer-configuration-host.js';
import {openReleaseJournal} from './commander-journal.js';
import {readCases,validateCollectorConfig} from '../zola-six-reads/collector.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState,validatePremergeReadClaims,validatePremergeReadActive} from '../shared/release-admission.js';
import {successorEvidence} from '../zola-six-reads/owned-collector-successor.js';
const canonical='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921';
const fail=()=>{throw Error('ADMITTED_READ_FRESH_ACCEPTANCE_REFUSED');};
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
export function readCompletedReadRecovery(){
 const plan=validateReadRecoveryPlan(value('plan')),snapshot=value('snapshot'),inspection=value('inspection');
 if(hash(snapshot)!==plan.snapshotDigest||hash(inspection)!==plan.inspectionDigest)fail();
 const raw=Buffer.from(required(R+'/events/release.jsonl',{gid:0,mode:0o600,maxBytes:1048576}));
 const events=readRecoveryJournal(raw,hash(raw)),state=inspectReadRecoveryTransition(plan,events);
 if(!state.completed)fail();
 return {plan,snapshot,inspection,transitionDigest:hash(raw),state};
}
export async function fenceFreshReadRecovery(context,call){
 await readPriorReadRecovery();
 const h=readCompletedReadRecovery(),plan=h.plan,config=validateCollectorConfig(value('collector-config'));
 const {inspectReleaseSequenceHistory}=await import(canonical+'/packages/zola-release/commander-sequence.js');
 const state=inspectReleaseSequenceHistory(context.journal.stream('release').events());
 if(state.context?.operationId!==P.operationId||state.context.releaseSha!==P.releaseSha
 ||state.pending?.attemptId!==P.attemptId||state.pending.stage!=='six_reads'||state.nextOrdinal!==13
 ||call.attemptId!==P.attemptId||call.inputDigest!==state.pending.inputDigest||call.checkOutputDigest!==state.pending.checkOutputDigest
 ||hash(JSON.parse(required('/var/lib/blackspire-operator/preparation/six-read-premerge-config.json',{gid:0,mode:0o600})))!==hash(config)
 ||config.runId!==plan.newRunId||config.frontendOrigin!==P.newOrigin)fail();
 const gid=fs.lstatSync(A+'/state.json').gid;
 const admission=validateReleaseAdmissionState(JSON.parse(required(A+'/state.json',{gid,mode:0o640})));
 if(admission.mode!=='held'||admission.releaseSha!==P.releaseSha||admission.runId!==plan.newRunId
 ||admission.apiGeneration!==null||admission.workerGeneration!==null)fail();
 const lifecycle=await observeHeldLifecycle({releaseSha:P.releaseSha,runId:plan.newRunId});
 if(!same(lifecycle,value('lifecycle'))||lifecycle.api.pid!==config.apiPid||lifecycle.worker.pid!==config.workerPid)fail();
 return {plan,config,lifecycle,gid,transitionDigest:h.transitionDigest};
}
export function inspectFreshReadHistory(events){
 if(!Array.isArray(events)||events.length>6)fail();const order=['denial_intent','denial_result','permit_intent','permit_active','collector_result','permit_retired'];
 let next=0,intent=null,result=null,retired=false;
 for(const e of events){
  if(e?.version!==1||retired)fail();
  if(e.type==='permit_retired'){
   if(!intent||!['PASS','UNKNOWN'].includes(e.outcome)||e.outcome!==(result?'PASS':'UNKNOWN')||e.claimsDigest!==intent.claimsDigest)fail();
   retired=true;continue;
  }
  if(e.type!==order[next])fail();
  if(e.type==='permit_intent'){
   const claims=validatePremergeReadClaims(e.claims);
   if(hash(claims)!==e.claimsDigest||claims.commanderRunId!==P.operationId||claims.candidateSha!==P.releaseSha||claims.epochRunId===P.runId)fail();
   intent=e;
  }
  if(e.type==='permit_active'&&e.claimsDigest!==intent.claimsDigest)fail();
  if(e.type==='collector_result'){if(e.claimsDigest!==intent.claimsDigest||hash(e.evidence)!==e.evidenceDigest)fail();successorEvidence(e.evidence);result=e;}
  next++;
 }
 return {next,intent,result,retired};
}
export async function collectFreshRecoveryReads(context,call){
 let journal,lease,activated=false,claims;
 const b=await fenceFreshReadRecovery(context,call);
 const root=R+'/acceptance';records.directory(root,{create:true});
 journal=openReleaseJournal({root});
 const stream=journal.stream('release'),append=e=>{inspectFreshReadHistory([...stream.events(),e]);stream.append(e);};
 const fence=async()=>{const now=await fenceFreshReadRecovery(context,call);if(!same(now,b))fail();};
 const publish=(name,v,gid,mode)=>{
  if(fs.existsSync(A+'/'+name))fail();
  records.publish(A+'/'+name,Buffer.from(JSON.stringify(v)+'\n'),{gid,mode});
 };
 const retire=outcome=>{
  lease?.close();lease=acquireReleaseAdmissionLock({root:A,exclusive:true,owner:0,groupId:b.gid});
  if(hash(validatePremergeReadClaims(JSON.parse(required(A+'/premerge-reads.json',{gid:b.gid,mode:0o640}))))!==hash(claims))fail();
  const active=JSON.parse(required(A+'/premerge-reads-active.json',{gid:b.gid,mode:0o640}));
  if(validatePremergeReadActive(active,claims).attemptId!==P.attemptId)fail();
  fs.unlinkSync(A+'/premerge-reads-active.json');const fd=fs.openSync(A,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  append({version:1,type:'permit_retired',claimsDigest:hash(claims),outcome});activated=false;lease.close();lease=null;
 };
 try{
  const prior=inspectFreshReadHistory(stream.events());
  if(prior.intent&&(prior.intent.configDigest!==hash(b.config)||prior.intent.transitionDigest!==b.transitionDigest
   ||prior.intent.claims.epochRunId!==b.plan.newRunId||prior.intent.claims.apiGeneration!==b.lifecycle.api.generation
   ||prior.intent.claims.workerGeneration!==b.lifecycle.worker.generation))fail();
  if(prior.result){
   claims=prior.intent.claims;
   const verified=freshCollectorEvidence(value('collector-report'),claims);
   if(!same(verified,prior.result.evidence))fail();
   if(prior.retired){if(fs.existsSync(A+'/premerge-reads-active.json'))fail();}
   else if(fs.existsSync(A+'/premerge-reads-active.json'))retire('PASS');
   else{
    lease=acquireReleaseAdmissionLock({root:A,exclusive:true,owner:0,groupId:b.gid});
    if(hash(validatePremergeReadClaims(JSON.parse(required(A+'/premerge-reads.json',{gid:b.gid,mode:0o640}))))!==hash(claims))fail();
    append({version:1,type:'permit_retired',claimsDigest:hash(claims),outcome:'PASS'});lease.close();lease=null;
   }
   return verified;
  }
  // Any earlier intent without a complete successful result is retained UNKNOWN.
  if(stream.events().length)fail();
  await fence();append({version:1,type:'denial_intent',runId:b.plan.newRunId,transitionDigest:b.transitionDigest});
  const denial=run('scripts/zola-denial-session.js',['--issue',R+'/denial-input.json'],30000);
  if(denial.status!=='DELEGATED_DENIAL_ISSUED')fail();
  append({version:1,type:'denial_result',runId:b.plan.newRunId,receiptDigest:hash(required(R+'/denial-receipt.json',{gid:0,mode:0o600}))});
  await fence();lease=acquireReleaseAdmissionLock({root:A,exclusive:true,owner:0,groupId:b.gid});lease.assertIdentity();
  for(const name of ['premerge-reads.json','premerge-reads-secret.json','premerge-reads-active.json'])if(fs.existsSync(A+'/'+name))fail();
  const token=randomBytes(32).toString('base64url'),issuedAt=Date.now(),reads=readCases(b.config.dealId).map((row,index)=>{
   const idempotencyKey='zola-six:'+b.plan.newRunId+':'+index;
   return{index,idempotencyKey,capability:row.capability,permission:row.permissions[0],request:row.text,requestDigest:hash({channel:'jarvis',workspaceId:b.config.workspace,text:row.text,idempotencyKey,executionIntent:'read_only'})};
  });
  claims=validatePremergeReadClaims({schema:1,kind:'held-premerge-reads',permitId:randomUUID(),commanderRunId:P.operationId,candidateSha:P.releaseSha,
   expectedDeploymentSha:P.releaseSha,epochRunId:b.plan.newRunId,workspace:b.config.workspace,principal:b.config.principal,
   apiGeneration:b.lifecycle.api.generation,workerGeneration:b.lifecycle.worker.generation,issuedAt,expiresAt:issuedAt+900000,operations:['six_reads'],reads,tokenDigest:hash(token)});
  append({version:1,type:'permit_intent',claims,claimsDigest:hash(claims),configDigest:hash(b.config),transitionDigest:b.transitionDigest});
  publish('premerge-reads-secret.json',{schema:1,permitId:claims.permitId,token},0,0o600);
  publish('premerge-reads.json',claims,b.gid,0o640);
  publish('premerge-reads-active.json',{schema:1,kind:'held-premerge-reads-active',permitId:claims.permitId,claimsDigest:hash(claims),operation:'six_reads',attemptId:P.attemptId,expiresAt:claims.expiresAt},b.gid,0o640);
  activated=true;append({version:1,type:'permit_active',claimsDigest:hash(claims)});lease.close();lease=null;
  const report=run('scripts/zola-six-read-collect.js',['--premerge-held','/var/lib/blackspire-operator/preparation/six-read-premerge-config.json']);
  const proof=freshCollectorEvidence(report,claims);
  records.record(R+'/collector-report.json',report);
  append({version:1,type:'collector_result',claimsDigest:hash(claims),evidence:proof,evidenceDigest:hash(proof)});
  retire('PASS');await fence();return proof;
 }catch(e){
  if(activated){try{retire(inspectFreshReadHistory(stream.events()).result?'PASS':'UNKNOWN');}catch{}}
  throw e;
 }finally{lease?.close();journal?.close();}
}
export function freshCollectorEvidence(report,claims){
 validatePremergeReadClaims(claims);
 if(report?.releaseSha!==P.releaseSha||report.livePass!==false||!report.databaseEvidence||report.results?.length!==6
  ||report.premergeAcceptance?.permitId!==claims.permitId||report.premergeAcceptance?.claimsDigest!==hash(claims)
  ||report.results.some((r,i)=>r.capability!==claims.reads[i].capability||!r.crossOwnerDenial?.startsWith('PASS:')
    ||r.mutationDelta!==0||r.capability==='nexus.enrichment.status'&&r.paidProviderCalls!==0))fail();
 return successorEvidence({readCount:6,crossOwnerDenials:6,paidProviderCalls:0,mutationDelta:0,collectorDigest:hash(report)});
}
export function wrapReadRecoveryOperations(context,operations){
 const six={
  check(){return {status:'PASS',evidence:{stage:'six_reads',fixedCollector:true}};},
  execute(){fail();},
  async reconcile(call){return {status:'PASS',evidence:{stage:'six_reads',...await collectFreshRecoveryReads(context,call)}};},
  observe(){fail();}
 };
 return {...operations,six_reads:six};
}
