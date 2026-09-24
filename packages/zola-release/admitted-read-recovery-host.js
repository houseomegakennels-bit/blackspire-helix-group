import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash,readRecoveryJournal,classifyAdmittedReadRecovery} from './admitted-read-recovery.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
import {inspectReleaseSequence} from './commander-sequence.js';
import {readTerminalProof} from '../zola-six-reads/owned-collector-successor-host.js';
const fail=()=>{throw Error('ADMITTED_READ_RECOVERY_OBSERVATION_REFUSED');};
const root='/etc/blackspire/release-admission';
const releasePath='/var/lib/blackspire-operator/release-operations/release.jsonl';
const collectorPath='/var/lib/blackspire-operator/preparation/owned-collector-successor-20260923/collector/'+P.runId+'.jsonl';
function protectedBytes(file,max=2097152){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try {const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o022)||s.size>max)fail();
 const b=fs.readFileSync(fd),t=fs.lstatSync(file);
 if(b.length!==s.size||['dev','ino','size','mtimeMs','ctimeMs','uid','gid','mode'].some(k=>s[k]!==t[k]))fail();return b;
 }finally{fs.closeSync(fd);}
}
function absent(file){try{fs.lstatSync(file);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
function noCollector(){
 for(const name of fs.readdirSync('/proc').filter(s=>/^[0-9]+$/.test(s)&&Number(s)!==process.pid)){
  try{const args=fs.readFileSync('/proc/'+name+'/cmdline','utf8').split('\0');
   if(args.some(a=>/(?:^|\/)zola-(?:six-read-collect|release-owned[^/]*)\.js$/.test(a)))fail();
  }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
 }
}
export async function observeAdmittedReadRecovery(){
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1')fail();
 const config=readRootOwnedJson('/var/lib/blackspire-operator/preparation/six-read-premerge-config.json',{groupId:0});
 if(hash(config)!==P.configDigest||config.databasePath!=='/opt/blackspire-command/shared/database/command.sqlite')fail();
 const gid=fs.lstatSync(root+'/state.json').gid;
 const lock=acquireReleaseAdmissionLock({exclusive:false,allowPending:true,owner:0,groupId:gid});let db;
 try{
  noCollector();const rb=protectedBytes(releasePath),cb=protectedBytes(collectorPath);
  const events=readRecoveryJournal(rb,P.releaseDigest),collector=readRecoveryJournal(cb,P.collectorDigest);
  const starts=events.flatMap((e,i)=>e.type==='sequence_started'&&e.operationId===P.operationId?[i]:[]);
  if(starts.length!==1)fail();
  // The complete historical prefix is pinned by its raw hash and validated hash chain.
  const sequence=inspectReleaseSequence(events.slice(starts[0])),pending=sequence.pending;
  const state=validateReleaseAdmissionState(readRootOwnedJson(root+'/state.json',{groupId:gid}));
  if(state.releaseSha!==P.releaseSha||state.runId!==P.runId||state.apiGeneration!==null||state.workerGeneration!==null)fail();
  const originalArchive=readTerminalProof();
  if(originalArchive.terminalProofDigest!=='f773d1d179841c5d598879deaa4b72514fee379686d700405f1fb34ee82c48e6')fail();
  const permit=events.filter(e=>e.type==='premerge_successor_reads_intent');
  const retired=events.filter(e=>e.type==='premerge_successor_reads_retired');
  if(permit.length!==1||retired.length!==1||retired[0].outcome!=='UNKNOWN'||retired[0].claimsDigest!==permit[0].claimsDigest
   ||hash(permit[0].claims)!==permit[0].claimsDigest)fail();
  const runtime=await observeHeldLifecycle({releaseSha:P.releaseSha,runId:P.runId});
  if(runtime.api.pid!==config.apiPid||runtime.worker.pid!==config.workerPid
   ||runtime.api.generation!==permit[0].claims.apiGeneration||runtime.worker.generation!==permit[0].claims.workerGeneration)fail();
  const identity=readRootOwnedJson(config.denialReceiptPath,{groupId:0}).databaseIdentity;
  const fenceDb=()=>{const s=fs.lstatSync(config.databasePath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o007)
   ||['dev','ino','uid'].some(k=>s[k]!==identity[k]))fail();};
  fenceDb();db=new DatabaseSync(config.databasePath,{readOnly:true});db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
  const taskRows=db.prepare('SELECT * FROM tasks WHERE idempotency_key=?').all('unified:jarvis:zola-six:'+P.runId+':0');
  if(taskRows.length!==1)fail();const task=taskRows[0];
  const attempts=db.prepare('SELECT * FROM provider_attempts WHERE task_id=? ORDER BY id').all(task.id);
  if(attempts.length!==1)fail();const attempt=attempts[0];
  const input=db.prepare('SELECT * FROM unified_inputs WHERE id=?').get(task.input_id);if(!input)fail();
  let otherReadTasks=0,otherReadInputs=0;
  for(let i=1;i<6;i++){const key='zola-six:'+P.runId+':'+i;
   otherReadTasks+=db.prepare('SELECT count(*) n FROM tasks WHERE idempotency_key=?').get('unified:jarvis:'+key).n;
   otherReadInputs+=db.prepare('SELECT count(*) n FROM unified_inputs WHERE idempotency_key=?').get(key).n;}
  const receiver=protectedBytes('/etc/blackspire/receiver-origin.env',4096);
  const wanted=['SELLER','BUYER','DEAL','NEXUS'].map(d=>'BLACKSPIRE_'+d+'_CAPABILITY_URL='+P.oldOrigin+'\n').join('');
  if(receiver.toString()!==wanted)fail();
  await observeReceiverDeployment({releaseSha:P.releaseSha,mode:'preview',origin:P.newOrigin,deploymentId:P.newDeploymentId});
  const activePermit=!absent(root+'/premerge-reads-active.json')||!absent(root+'/acceptance-active.json');
  const proof=classifyAdmittedReadRecovery({
   releaseDigest:hash(rb),collectorDigest:hash(cb),configDigest:hash(config),taskDigest:hash(task),providerAttemptDigest:hash(attempt),inputDigest:hash(input),
   releaseSha:sequence.context?.releaseSha,operationId:sequence.context?.operationId,runId:state.runId,stageAttemptId:pending?.attemptId,stage:pending?.stage,ordinal:sequence.nextOrdinal,
   admissionMode:state.mode,activePermit,collectorRunning:false,permitExpired:permit[0].claims.expiresAt<Date.now(),
   taskId:task.id,providerAttemptId:attempt.id,taskStatus:task.status,providerAttemptStatus:attempt.status,executionIntent:task.execution_intent,
   capability:attempt.mode,provider:attempt.provider,taskCount:taskRows.length,attemptCount:attempts.length,otherReadTasks,otherReadInputs,
   collectedCount:collector.filter(e=>e.type==='collected').length,admittedCount:collector.filter(e=>e.type==='admitted').length,
   baselineComplete:collector.filter(e=>e.type==='database_query_result').length===5&&collector.filter(e=>e.type==='database_before').length===1,
   denialConfirmed:collector.filter(e=>e.type==='denial_confirmed').length===1,
   oldOrigin:P.oldOrigin,newOrigin:P.newOrigin,newDeploymentId:P.newDeploymentId,newDeploymentVerified:true,retainedOldArchiveVerified:true
  });
  db.exec('ROLLBACK');db.close();db=null;fenceDb();noCollector();lock.assertIdentity();
  if(hash(protectedBytes(releasePath))!==P.releaseDigest||hash(protectedBytes(collectorPath))!==P.collectorDigest
   ||hash(protectedBytes('/etc/blackspire/receiver-origin.env',4096))!==hash(receiver)
   ||hash(await observeHeldLifecycle({releaseSha:P.releaseSha,runId:P.runId}))!==hash(runtime)
   ||hash(readRootOwnedJson(root+'/state.json',{groupId:gid}))!==hash(state))fail();
  return proof;
 }finally{if(db){try{db.exec('ROLLBACK');}finally{db.close();}}lock.close();}
}
