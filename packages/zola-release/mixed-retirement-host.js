import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {MIXED_RETIREMENT as P,validateMixedRetirementPrefix} from './mixed-retirement-history.js';
import {MIXED_READ_ROWS} from './mixed-read-failure.js';
import {observeMixedReadFailure} from './mixed-read-failure-host.js';
import {hash} from './commander-journal.js';
import {recoveryDigest,readRecoveryJournal} from './admitted-read-recovery.js';
import {verifyReleaseSource,verifyReleaseCi} from './commander-host.js';
import {inspectBuyerWriterArtifact,inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {readOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
import {createBuyerStoreProtectedFiles} from '../buyer-store/protected-files.js';
import {acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {verifyOwnedBuyerMigrationQuiescence} from '../buyer-writer/owned-migration-host.js';
export const MIXED_RETIREMENT_ROOT='/var/lib/blackspire-operator/release-retirements/mixed-a8e-20260924';
const ROOT=MIXED_RETIREMENT_ROOT,A='/etc/blackspire/release-admission';
const R='/var/lib/blackspire-operator/preparation/credential-recovery-20260924';
const SOURCE='/mnt/blackspire-builds/development-cache/0/workspaces/zola-credential-recovery-20260924';
const CANONICAL='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-successor-20260924';
const units=['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service','blackspire-buyer-store.service'];
const users=['blackspire-api','blackspire-worker','blackspire-writer','blackspire-buyer-store'];
const fail=()=>{throw Error('MIXED_RETIREMENT_HOST_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const command=(file,args,timeout=10000)=>execFileSync(file,args,{encoding:'utf8',timeout,maxBuffer:65536,
 stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();
const files=createBuyerStoreProtectedFiles();
const required=(file,gid=0,mode=0o600)=>{const b=readOwnedConfigurationBytes(file,{gid,mode,maxBytes:2097152});if(b===null)fail();return b;};
function noSurvivors(){
 const ids=users.map(user=>{const p=command('/usr/bin/getent',['passwd',user]).split(':');
  if(p.length!==7||p[0]!==user||!(/^[1-9][0-9]*$/).test(p[2]))fail();return p[2];});
 for(const pid of fs.readdirSync('/proc').filter(p=>(/^[0-9]+$/).test(p))){
  let text;try{text=fs.readFileSync('/proc/'+pid+'/status','utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const u=text.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);
  if(!u||u.slice(1).some(id=>ids.includes(id)))fail();
 }
}
export function createMixedRetirementStore(){
 if(process.getuid?.()!==0)fail();files.directory(ROOT,{create:true});
 const path=name=>{if(!['plan','stop-intent','stop-result','retirement'].includes(name))fail();return ROOT+'/'+name+'.json';};
 return {read:name=>files.value(path(name),true),retain:(name,v)=>files.record(path(name),v)};
}
export function createMixedRetirementHost(){
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1')fail();let lease;
 const source=()=>{
  if(command('/usr/bin/git',['--no-replace-objects','-C',SOURCE,'rev-parse','HEAD'])!==P.sourceSha
   ||command('/usr/bin/git',['--no-replace-objects','-C',SOURCE,'status','--porcelain','--untracked-files=all']))fail();
 };
 const history=async()=>{
  source();const old=await import(SOURCE+'/packages/zola-release/admitted-read-fresh-acceptance.js');
  const prior=await import(SOURCE+'/packages/zola-release/admitted-read-prior-recovery.js');
  const h=old.readCompletedReadRecovery();await prior.readPriorReadRecovery();
  if(recoveryDigest(h.plan)!==P.planDigest||h.transitionDigest!==P.transitionDigest)fail();
  validateMixedRetirementPrefix(readRecoveryJournal(Buffer.from(required('/var/lib/blackspire-operator/release-operations/release.jsonl')),P.releaseDigest));
  readRecoveryJournal(Buffer.from(required(R+'/acceptance/release.jsonl')),P.acceptanceDigest);
  readRecoveryJournal(Buffer.from(required(R+'/collector/'+P.runId+'.jsonl')),P.collectorDigest);
  const c=files.value(R+'/collector-config.json'),identity=files.value(R+'/denial-receipt.json').databaseIdentity;
  const fence=()=>{const s=fs.lstatSync(c.databasePath);
   if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o007)||['dev','ino','uid'].some(k=>s[k]!==identity[k]))fail();};
  if(recoveryDigest(c)!==P.configDigest)fail();fence();
  const db=new DatabaseSync(c.databasePath,{readOnly:true});
  try{db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
   for(const p of MIXED_READ_ROWS){
    const ts=db.prepare('SELECT * FROM tasks WHERE idempotency_key=?').all('unified:jarvis:zola-six:'+P.runId+':'+p.index);
    const ats=db.prepare('SELECT * FROM provider_attempts WHERE task_id=?').all(p.id);
    if(ts.length!==1||ats.length!==1||recoveryDigest(ts[0])!==p.taskDigest||recoveryDigest(ats[0])!==p.attemptDigest
     ||recoveryDigest(db.prepare('SELECT * FROM unified_inputs WHERE id=?').get(ts[0].input_id))!==p.inputDigest)fail();
   }
   for(let i=2;i<6;i++){const key='zola-six:'+P.runId+':'+i;
    if(db.prepare('SELECT count(*) n FROM tasks WHERE idempotency_key=?').get('unified:jarvis:'+key).n
     ||db.prepare('SELECT count(*) n FROM unified_inputs WHERE idempotency_key=?').get(key).n)fail();}
  }finally{try{db.exec('ROLLBACK');}finally{db.close();}}fence();source();return h;
 };
 const snapshot=async()=>{
  lease.assertIdentity();const h=await history(),descriptors=Object.values(h.snapshot.files).map(({path,gid,mode})=>({path,gid,mode}));
  for(const name of ['writerBinding','writerCommit']){
   const f=h.snapshot.files[name],base=f.path.split('/').at(-1);
   for(const n of fs.readdirSync('/etc/blackspire').filter(n=>n.startsWith(base+'.retired-')).sort())
    descriptors.push({path:'/etc/blackspire/'+n,gid:f.gid,mode:f.mode});
  }
  for(const name of ['claims','secret']){const f=h.snapshot.files[name];descriptors.push({path:R+'/archive/'+name,gid:f.gid,mode:f.mode});}
  const manifestPath='/etc/blackspire/zola-installed-'+P.releaseSha+'.json';
  const installed=JSON.parse(required(manifestPath));
  if(installed.schema!==1||installed.kind!=='zola_installed_buyer_writer'||installed.releaseSha!==P.releaseSha
   ||installed.artifactDigest!==P.artifactDigest)fail();
  descriptors.push({path:manifestPath,gid:0,mode:0o600});
  for(const kind of ['client','ingress','signer']){
   const item=installed[kind+'Config'],prefix='/etc/blackspire/buyer-writer-'+kind+'-';
   if(!item||typeof item.path!=='string'||!item.path.startsWith(prefix)||!(/^[a-f0-9]{64}\.json$/).test(item.path.slice(prefix.length)))fail();
   const b=required(item.path,h.snapshot.files.writerBinding.gid,0o640);
   if(recoveryDigest(Buffer.from(b))!==item.digest)fail();
   descriptors.push({path:item.path,gid:h.snapshot.files.writerBinding.gid,mode:0o640});
  }
  for(const p of ['/etc/blackspire/owned-postgres/profile.json',
   '/var/lib/blackspire-operator/preparation/owned-gateway-provisioning.json',
   '/var/lib/blackspire-operator/preparation/owned-source-v1.json',
   '/var/lib/blackspire-operator/preparation/owned-buyer-writer-v4-'+P.releaseSha+'.json'])
   descriptors.push({path:p,gid:0,mode:0o600});
  const writerGroup=command('/usr/bin/getent',['group','blackspire-writer']).split(':');
  if(writerGroup.length!==4||writerGroup[0]!=='blackspire-writer'||!(/^[1-9][0-9]*$/).test(writerGroup[2]))fail();
  for(const [key,p,gid,mode] of [
   ['gatewayConfig','/etc/blackspire-buyer-writer-gateway/gateway.json',Number(writerGroup[2]),0o640],
   ['serviceDropin','/etc/systemd/system/blackspire-command.service.d/40-zola-writer.conf',0,0o644]]){
   if(installed[key]?.path!==p||recoveryDigest(Buffer.from(required(p,gid,mode)))!==installed[key].digest)fail();
   descriptors.push({path:p,gid,mode});
  }
  const unitConfig={};
  for(const unit of [...units,'blackspire-command.target']){
   const v=Object.fromEntries(command('/usr/bin/systemctl',['show','--property=FragmentPath,DropInPaths,NeedDaemonReload','--',unit]).split('\n').map(x=>x.split('=')));
   if(v.NeedDaemonReload!=='no'||!v.FragmentPath||typeof v.DropInPaths!=='string')fail();
   unitConfig[unit]=v;
   for(const p of [v.FragmentPath,...v.DropInPaths.split(' ').filter(Boolean)]){
    if(!(/^\/(?:etc|usr\/lib|lib)\/systemd\/system\/[A-Za-z0-9_./@-]+$/).test(p))fail();
    const t=fs.lstatSync(p);
    if(t.uid!==0||![0o600,0o640,0o644].includes(t.mode&0o7777))fail();
    descriptors.push({path:p,gid:t.gid,mode:t.mode&0o7777});
   }
  }
  const result={unitConfig,files:{}};
  for(const f of descriptors){
   const a=fs.lstatSync(f.path),b=required(f.path,f.gid,f.mode),z=fs.lstatSync(f.path);
   const keys=['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'];
   if(keys.some(k=>a[k]!==z[k]))fail();
   result.files[f.path]={digest:recoveryDigest(Buffer.from(b)),identity:Object.fromEntries(keys.map(k=>[k,z[k]]))};
  }
  const gid=h.snapshot.files.state.gid,s=validateReleaseAdmissionState(JSON.parse(required(A+'/state.json',gid,0o640)));
  if(s.mode!=='held'||s.releaseSha!==P.releaseSha||s.runId!==P.runId||s.apiGeneration!==null||s.workerGeneration!==null
   ||fs.realpathSync('/opt/blackspire-command/current')!=='/opt/blackspire-command/releases/'+P.releaseSha)fail();
  for(const n of ['premerge-reads-active.json','acceptance-active.json'])if(fs.existsSync(A+'/'+n))fail();
  lease.assertIdentity();return result;
 };
 const deployed=()=>inspectBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+P.releaseSha,releaseSha:P.releaseSha,environment:'production'});
 return {
  async verifySuccessor(input){
   if(input.successorReleaseSha!==P.successorReleaseSha)fail();
   verifyReleaseSource(P.successorReleaseSha,{root:CANONICAL,requireRemote:true});
   command('/usr/bin/git',['--no-replace-objects','-C',CANONICAL,'merge-base','--is-ancestor',P.releaseSha,P.successorReleaseSha]);
   const ci=verifyReleaseCi(P.successorReleaseSha);if(ci.mainSha!==P.previousMainSha)fail();
   const artifact=await inspectSealedBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+P.successorReleaseSha,releaseSha:P.successorReleaseSha,environment:'production'});
   if(artifact.artifactDigest!==P.successorArtifactDigest)fail();
   await observeReceiverDeployment({releaseSha:P.successorReleaseSha,mode:'preview',
    origin:'https://frontend-4rrto278r-houseomegakennels-4825s-projects.vercel.app',deploymentId:'dpl_F91bkRA33kQw1X7RsxigNUg9MdJv'});
  },
  async lease(){
   lease=acquireReleaseAdmissionLock({exclusive:true,allowPending:true,owner:0,groupId:fs.lstatSync(A+'/state.json').gid});
   lease.assertIdentity();return lease;
  },
  async observeRunning(){
   lease.assertIdentity();const before=await snapshot(),proof=await observeMixedReadFailure({lease});
   const lifecycle=await observeHeldLifecycle({releaseSha:P.releaseSha,runId:P.runId}),artifact=await deployed();
   if(!same(before,await snapshot())||proof.retainedEvidenceDigest!==P.retainedEvidenceDigest)fail();
   return {version:1,retainedEvidenceDigest:proof.retainedEvidenceDigest,protectedStateDigest:hash(before),
    lifecycleDigest:hash(lifecycle),artifactDigest:artifact.artifactDigest,bindingRetained:true,authorityInactive:true};
  },
  async stop(){
   lease.assertIdentity();command('/usr/bin/systemctl',['stop','--','blackspire-command.target',...units],45000);
  },
  async observeStopped(before){
   lease.assertIdentity();verifyOwnedBuyerMigrationQuiescence();noSurvivors();
   const s=await snapshot(),artifact=await deployed();
   if(hash(s)!==before.protectedStateDigest||artifact.artifactDigest!==before.artifactDigest)fail();
   verifyOwnedBuyerMigrationQuiescence();noSurvivors();lease.assertIdentity();
   return {version:1,hostStopped:true,noDetachedSurvivors:true,bindingRetained:true,authorityInactive:true,
    currentSha:P.releaseSha,protectedStateDigest:hash(s),artifactDigest:artifact.artifactDigest,retainedEvidenceDigest:P.retainedEvidenceDigest};
  },
 };
}
