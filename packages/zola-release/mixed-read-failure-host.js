import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {MIXED_READ_FAILURE as P,MIXED_READ_ROWS,classifyMixedReadFailure} from './mixed-read-failure.js';
import {recoveryDigest as hash,readRecoveryJournal} from './admitted-read-recovery.js';
import {readOwnedConfigurationBytes as read} from './owned-buyer-configuration-host.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
import {inspectReleaseSequence} from './commander-sequence.js';
const source='/mnt/blackspire-builds/development-cache/0/workspaces/zola-credential-recovery-20260924';
const R='/var/lib/blackspire-operator/preparation/credential-recovery-20260924',A='/etc/blackspire/release-admission';
const fail=()=>{throw Error('MIXED_READ_FAILURE_HOST_REFUSED');};
const records=createBuyerStoreProtectedFiles(),value=n=>records.value(R+'/'+n+'.json');
const required=(file,gid=0,mode=0o600,maxBytes=2097152)=>{const s=read(file,{gid,mode,maxBytes});if(s===null)fail();return Buffer.from(s);};
const command=(file,args)=>execFileSync(file,args,{encoding:'utf8',timeout:10000,maxBuffer:65536,
 stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();
const checkSource=()=>{if(command('/usr/bin/git',['--no-replace-objects','-C',source,'rev-parse','HEAD'])!==P.sourceSha
 ||command('/usr/bin/git',['--no-replace-objects','-C',source,'status','--porcelain','--untracked-files=all']))fail();};
const noCollector=()=>{for(const n of fs.readdirSync('/proc').filter(n=>/^[0-9]+$/.test(n)&&Number(n)!==process.pid)){
 try{const args=fs.readFileSync('/proc/'+n+'/cmdline','utf8').split('\0');
  if(args.some(a=>/(?:^|\/)zola-(?:six-read-collect|release-owned[^/]*)\.js$/.test(a)))fail();
 }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
}};
export async function observeMixedReadFailure({lease:borrowedLease}={}){
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1')fail();
 checkSource();noCollector();
 const old=await import(source+'/packages/zola-release/admitted-read-fresh-acceptance.js');
 const prior=await import(source+'/packages/zola-release/admitted-read-prior-recovery.js');
 const h=old.readCompletedReadRecovery();await prior.readPriorReadRecovery();
 if(hash(h.plan)!==P.planDigest||h.transitionDigest!==P.transitionDigest||!h.state.completed||h.plan.newRunId!==P.runId)fail();
 const gid=fs.lstatSync(A+'/state.json').gid,lease=borrowedLease??acquireReleaseAdmissionLock({exclusive:false,allowPending:true,owner:0,groupId:gid});
 lease.assertIdentity();
 try{
  const state=()=>validateReleaseAdmissionState(JSON.parse(required(A+'/state.json',gid,0o640)));
  const before=state(),config=value('collector-config'),lifecycle=value('lifecycle');
  if(before.mode!=='held'||before.runId!==P.runId||before.releaseSha!==P.releaseSha||before.apiGeneration!==null||before.workerGeneration!==null
   ||hash(config)!==P.configDigest||hash(JSON.parse(required('/var/lib/blackspire-operator/preparation/six-read-premerge-config.json')))!==P.configDigest)fail();
  const files={release:'/var/lib/blackspire-operator/release-operations/release.jsonl',
   acceptance:R+'/acceptance/release.jsonl',collector:R+'/collector/'+P.runId+'.jsonl'};
  const events=Object.fromEntries(Object.entries(files).map(([k,f])=>[k,readRecoveryJournal(required(f),P[k+'Digest'])]));
  const starts=events.release.flatMap((e,i)=>e.type==='sequence_started'&&e.operationId===P.operationId?[i]:[]);
  if(starts.length!==1)fail();const sequence=inspectReleaseSequence(events.release.slice(starts[0]));
  const history=old.inspectFreshReadHistory(events.acceptance),claims=history.intent?.claims;
  if(events.acceptance.length!==5||!history.retired||history.result||events.acceptance.at(-1).outcome!=='UNKNOWN'
   ||history.intent.transitionDigest!==P.transitionDigest||history.intent.configDigest!==P.configDigest
   ||history.intent.claimsDigest!==P.claimsDigest||hash(claims)!==P.claimsDigest||claims.epochRunId!==P.runId
   ||claims.apiGeneration!==lifecycle.api.generation||claims.workerGeneration!==lifecycle.worker.generation
   ||hash(JSON.parse(required(A+'/premerge-reads.json',gid,0o640)))!==P.claimsDigest)fail();
  const secret=JSON.parse(required(A+'/premerge-reads-secret.json'));
  if(secret.permitId!==claims.permitId||hash(secret.token)!==claims.tokenDigest)fail();
  for(const name of ['premerge-reads-active.json','acceptance-active.json'])if(fs.existsSync(A+'/'+name))fail();
  for(const name of ['claims','secret']){
   const f=h.snapshot.files[name],file=R+'/archive/'+name,s=fs.lstatSync(file);
   if(hash(required(file,f.gid,f.mode))!==f.digest||s.dev!==f.identity.dev||s.ino!==f.identity.ino)fail();
  }
  const admitted=events.collector.filter(e=>e.type==='admitted'),collected=events.collector.filter(e=>e.type==='collected');
  if(admitted.length!==2||admitted.some((e,i)=>e.index!==i||e.taskId!==MIXED_READ_ROWS[i].id)
   ||collected.length!==1||collected[0].index!==0)fail();
  const identity=records.value(config.denialReceiptPath).databaseIdentity;
  const dbFence=()=>{const s=fs.lstatSync(config.databasePath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o007)
   ||['dev','ino','uid'].some(k=>s[k]!==identity[k]))fail();};
  const rows=()=>{
   dbFence();const db=new DatabaseSync(config.databasePath,{readOnly:true});
   try{db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
    for(const p of MIXED_READ_ROWS){
     const ts=db.prepare('SELECT * FROM tasks WHERE idempotency_key=?').all('unified:jarvis:zola-six:'+P.runId+':'+p.index);
     const t=ts[0];if(ts.length!==1||t.id!==p.id||t.status!==p.status||t.execution_intent!=='read_only'||hash(t)!==p.taskDigest)fail();
     const ats=db.prepare('SELECT * FROM provider_attempts WHERE task_id=?').all(p.id),at=ats[0];
     if(ats.length!==1||at.id!==p.attemptId||at.status!==p.status||at.mode!==p.capability||hash(at)!==p.attemptDigest
      ||hash(db.prepare('SELECT * FROM unified_inputs WHERE id=?').get(t.input_id))!==p.inputDigest)fail();
    }
    for(let i=2;i<6;i++){const key='zola-six:'+P.runId+':'+i;
     if(db.prepare('SELECT count(*) n FROM tasks WHERE idempotency_key=?').get('unified:jarvis:'+key).n
      ||db.prepare('SELECT count(*) n FROM unified_inputs WHERE idempotency_key=?').get(key).n)fail();}
   }finally{try{db.exec('ROLLBACK');}finally{db.close();}}dbFence();
  };rows();
  if(hash(await observeHeldLifecycle({releaseSha:P.releaseSha,runId:P.runId}))!==hash(lifecycle))fail();
  const result=value('writer-result');
  for(const [name,key] of [['writerBinding','bindingDigest'],['writerCommit','commitDigest']]){
   const f=h.snapshot.files[name];if(hash(required(f.path,f.gid,f.mode))!==result[key])fail();
  }
  const wanted=['SELLER','BUYER','DEAL','NEXUS'].map(d=>'BLACKSPIRE_'+d+'_CAPABILITY_URL='+P.origin+'\n').join('');
  if(required('/etc/blackspire/receiver-origin.env',gid,0o640).toString()!==wanted
   ||records.value('/var/lib/blackspire-operator/preparation/receiver-origin.json').deploymentId!==P.deploymentId)fail();
  const units=['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-store.service','blackspire-buyer-writer-gateway.service'];
  for(const unit of units){const s=Object.fromEntries(command('/usr/bin/systemctl',['show','--property=ActiveState,SubState,MainPID','--',unit]).split('\n').map(x=>x.split('=')));
   if(s.ActiveState!=='active'||s.SubState!=='running'||!(/^[1-9][0-9]*$/).test(s.MainPID))fail();}
  await observeReceiverDeployment({releaseSha:P.releaseSha,mode:'preview',origin:P.origin,deploymentId:P.deploymentId});
  for(const[k,f]of Object.entries(files))if(hash(required(f))!==P[k+'Digest'])fail();
  rows();await prior.readPriorReadRecovery();checkSource();noCollector();lease.assertIdentity();
  if(hash(state())!==hash(before)||hash(await observeHeldLifecycle({releaseSha:P.releaseSha,runId:P.runId}))!==hash(lifecycle))fail();
  return classifyMixedReadFailure({...P,held:true,priorLineageVerified:true,transitionComplete:true,permitRetired:history.retired,
   permitExpired:claims.expiresAt<Date.now(),activePermit:false,collectorRunning:false,outcome:'UNKNOWN',
   rowsUnchanged:true,archivesUnchanged:true,otherReadTasks:0,otherReadInputs:0,collected:collected.length,admitted:admitted.length,
   serviceCount:units.length,lifecycleBound:true,writerBound:true,deploymentVerified:true,stage:sequence.pending?.stage,
   ordinal:sequence.nextOrdinal,pendingAttemptId:sequence.pending?.attemptId});
 }finally{if(!borrowedLease)lease.close();}
}
