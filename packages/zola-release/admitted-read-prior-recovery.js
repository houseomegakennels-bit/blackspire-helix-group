import {readRetainedTerminalProof} from '../zola-six-reads/owned-collector-successor-host.js';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash,readRecoveryJournal} from './admitted-read-recovery.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {readOwnedConfigurationBytes as read} from './owned-buyer-configuration-host.js';
const oldSource='/mnt/blackspire-builds/development-cache/0/workspaces/zola-admitted-read-recovery-20260924';
export const PRIOR_READ_ROOT='/var/lib/blackspire-operator/preparation/admitted-read-recovery-20260924';
export const PRIOR_READ_PINS=Object.freeze({
 sourceSha:'093c0983d5c180ceb3c42564f1f36f7830c344ca',
 planDigest:'71aed40a7668bd835bde6aebc9973c57418b18adbc5c7d52be875f6a7bd90e64',
 transitionDigest:'9566b94735dbc411c4fe1e10f4dc6868873886e0641dd738d3b721038ea67a23',
 acceptanceDigest:'3e5571b827c1aab279087aa37d24d9db4cb919c4c4463a9686c7fe7eefcbb34d',
 collectorDigest:'009ee43f3d9ed7f68274653db2177faea754ca08415089ec0706205b09df3994',
 configDigest:'d249c5d60d366ebf4768aa3ade9f2eac7e9b52019a1b588b1d94b205b6e14ae1',
 runId:'2cc33dc9-486b-4f59-ab79-386f81c6b2f5',
 claimsDigest:'3dc5bea81888cc1aeb41e1dad4724ca898eb6b6213b089514503c4ff25e175f7'
});
const fail=()=>{throw Error('PRIOR_READ_RECOVERY_REFUSED');};
export function validatePriorReadSummary(s){
 if(!s||Object.entries(PRIOR_READ_PINS).some(([k,v])=>s[k]!==v)
  ||s.completed!==true||s.retired!==true||s.outcome!=='UNKNOWN'||s.hasResult!==false
  ||s.priorRowsUnchanged!==true||s.archiveUnchanged!==true||s.historyLength!==5
  ||s.claimsExpired!==true||s.configBound!==true||s.collectorBound!==true)fail();
 return {version:1,status:'PRIOR_RECOVERY_PRESERVED_UNKNOWN',pins:PRIOR_READ_PINS,
  automaticReplayAllowed:false,acceptancePassed:false};
}
export async function readPriorReadRecovery(){
 const git=args=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',oldSource,...args],{
  encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();
 if(git(['rev-parse','HEAD'])!==PRIOR_READ_PINS.sourceSha||git(['status','--porcelain','--untracked-files=all']))fail();
 const {readCompletedReadRecovery,inspectFreshReadHistory}=await import(oldSource+'/packages/zola-release/admitted-read-fresh-acceptance.js');
 const {ADMITTED_READ_RECOVERY:original}=await import(oldSource+'/packages/zola-release/admitted-read-recovery.js');
 const h=readCompletedReadRecovery(),files=createBuyerStoreProtectedFiles();
 const originalArchive=readRetainedTerminalProof(JSON.parse(h.snapshot.files.config.bytes));
 if(originalArchive.terminalProofDigest!=='f773d1d179841c5d598879deaa4b72514fee379686d700405f1fb34ee82c48e6')fail();

 const required=(file,gid=0,mode=0o600)=>{const b=read(file,{gid,mode,maxBytes:2097152});if(b===null)fail();return Buffer.from(b);};
 const raw=required(PRIOR_READ_ROOT+'/acceptance/release.jsonl');
 const events=readRecoveryJournal(raw,PRIOR_READ_PINS.acceptanceDigest),history=inspectFreshReadHistory(events);
 const c=files.value(PRIOR_READ_ROOT+'/collector-config.json'),l=files.value(PRIOR_READ_ROOT+'/lifecycle.json');
 const collector=readRecoveryJournal(required(PRIOR_READ_ROOT+'/collector/'+PRIOR_READ_PINS.runId+'.jsonl'),PRIOR_READ_PINS.collectorDigest);
 if(events[0].transitionDigest!==h.transitionDigest||events[1].receiptDigest!==hash(required(PRIOR_READ_ROOT+'/denial-receipt.json'))
  ||history.intent?.transitionDigest!==h.transitionDigest||history.intent.configDigest!==hash(c)
  ||history.intent.claims.apiGeneration!==l.api.generation||history.intent.claims.workerGeneration!==l.worker.generation
  ||c.apiPid!==l.api.pid||c.workerPid!==l.worker.pid||c.runId!==h.plan.newRunId
  ||collector.filter(e=>e.type==='admitted').length!==1
  ||collector.find(e=>e.type==='admitted').taskId!=='task_c5c8d9bca504952a'
  ||collector.some(e=>e.type==='collected'))fail();
 const identity=files.value(PRIOR_READ_ROOT+'/denial-receipt.json').databaseIdentity;
 const dbFence=()=>{const s=fs.lstatSync(c.databasePath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o007)
  ||['dev','ino','uid'].some(k=>s[k]!==identity[k]))fail();};
 dbFence();const db=new DatabaseSync(c.databasePath,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
  const t=db.prepare('SELECT * FROM tasks WHERE id=?').get(original.taskId);
  const a=db.prepare('SELECT * FROM provider_attempts WHERE task_id=? ORDER BY id').all(original.taskId);
  const i=db.prepare('SELECT * FROM unified_inputs WHERE id=?').get(t?.input_id);
  if(hash(t)!==original.taskDigest||a.length!==1||hash(a[0])!==original.providerAttemptDigest||hash(i)!==original.inputDigest)fail();
  const latest=db.prepare('SELECT * FROM tasks WHERE id=?').get(P.taskId);
  const latestAttempts=db.prepare('SELECT * FROM provider_attempts WHERE task_id=? ORDER BY id').all(P.taskId);
  const latestInput=db.prepare('SELECT * FROM unified_inputs WHERE id=?').get(latest?.input_id);
  if(hash(latest)!==P.taskDigest||latestAttempts.length!==1||hash(latestAttempts[0])!==P.providerAttemptDigest||hash(latestInput)!==P.inputDigest)fail();
  for(const epoch of [original.runId,P.runId])for(let index=1;index<6;index++){
   const key='zola-six:'+epoch+':'+index;
   if(db.prepare('SELECT count(*) n FROM tasks WHERE idempotency_key=?').get('unified:jarvis:'+key).n
    ||db.prepare('SELECT count(*) n FROM unified_inputs WHERE idempotency_key=?').get(key).n)fail();
  }

 }finally{try{db.exec('ROLLBACK');}finally{db.close();}}dbFence();
 for(const name of ['claims','secret']){
  const f=h.snapshot.files[name],p=PRIOR_READ_ROOT+'/archive/'+name,b=required(p,f.gid,f.mode),s=fs.lstatSync(p);
  if(hash(b)!==f.digest||s.dev!==f.identity.dev||s.ino!==f.identity.ino)fail();
 }
 const originalCollector='/var/lib/blackspire-operator/preparation/owned-collector-successor-20260923/collector/'+original.runId+'.jsonl';
 readRecoveryJournal(required(originalCollector),original.collectorDigest);
 const summary={...PRIOR_READ_PINS,planDigest:hash(h.plan),transitionDigest:h.transitionDigest,
  acceptanceDigest:hash(raw),configDigest:hash(c),runId:h.plan.newRunId,claimsDigest:history.intent?.claimsDigest,
  completed:h.state.completed,retired:history.retired,outcome:events.at(-1).outcome,hasResult:!!history.result,
  priorRowsUnchanged:true,archiveUnchanged:true,historyLength:events.length,
  claimsExpired:history.intent.claims.expiresAt<Date.now(),
  configBound:history.intent.configDigest===hash(c),collectorBound:true};
 return {proof:validatePriorReadSummary(summary),claims:history.intent.claims,history};
}
