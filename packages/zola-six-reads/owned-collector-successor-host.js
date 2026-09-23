import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {RENEWAL,renewalHash as hash,assertRenewalConfig} from './owned-denial-renewal.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {RELEASE_ADMISSION_ROOT,acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {observeHeldLifecycle,validateHeldLifecycleProof} from '../zola-release/held-lifecycle.js';
import {openReleaseJournal} from '../zola-release/commander-journal.js';
import {writeZolaActivationProfile} from '../zola-release/activation-profile.js';
export const SUCCESSOR=Object.freeze({root:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-collector-successor-20260923',baseSha:'30fcdaa81c8f6fb070cc0f5ec67e597ecd17330a',
 archive:'/var/lib/blackspire-operator/preparation/owned-collector-successor-20260923',releasePath:'/var/lib/blackspire-operator/release-operations/release.jsonl',
 prefixLength:156008,prefixDigest:'788062d4011049aac0c1766ff364934315b1580bfafefc6f58b0f3ca52996855',
 collectorDigest:'c5ec95649f3cf7849869a9973331ca543b11cfb570d9d59cb577dd66d37062fd',
 claimsDigest:'7858b38cee35a4b83c881b7e600e93fee28c0a48fe5f3b8efe25675b746bf65f',
 logDigest:'85eac952505bdeef42f108b9f0c778d31dc4622e65f3121f2c17f1947ef2e151'});
const files=Object.freeze([
 {name:'premerge-reads.json',dev:2049,ino:1164069,size:2312,mode:0o640,gid:986,digest:'1dc51010800f43f8e7c950c72873f208de606446bbe545ddfc091412f962f174'},
 {name:'premerge-reads-secret.json',dev:2049,ino:1164062,size:117,mode:0o600,gid:0,digest:'c967134f471a840052ed0c4153c9e4bcfc002cdcde9311383dc72b8c8d6d2161'}]);
export const successorFail=()=>{throw Error('OWNED_COLLECTOR_SUCCESSOR_REJECTED');};
const rawHash=b=>createHash('sha256').update(b).digest('hex');
const absent=p=>{try{fs.lstatSync(p);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
const json=p=>readRootOwnedJson(p,{groupId:0,maxBytes:65536});
const sync=p=>{const f=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(f);}finally{fs.closeSync(f);}};
function protectedBytes(p,max=1048576){
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);
 if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o022)||s.size>max)successorFail();
 const b=fs.readFileSync(fd),t=fs.lstatSync(p);if(b.length!==s.size||t.dev!==s.dev||t.ino!==s.ino)successorFail();return b;
 }finally{fs.closeSync(fd);}
}
export function checkSuccessorSource(){
 const run=(root,args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_NO_REPLACE_OBJECTS:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
 for(const [root,expected] of [[RENEWAL.root,SUCCESSOR.baseSha],[RENEWAL.canonicalRoot,RENEWAL.releaseSha]]){
  if(fs.realpathSync(root)!==root||run(root,['rev-parse','HEAD'])!==expected||run(root,['status','--porcelain','--untracked-files=all']))successorFail();
 }
 if(fs.realpathSync(SUCCESSOR.root)!==SUCCESSOR.root||run(SUCCESSOR.root,['status','--porcelain','--untracked-files=all']))successorFail();
 run(SUCCESSOR.root,['merge-base','--is-ancestor',SUCCESSOR.baseSha,'HEAD']);const sha=run(SUCCESSOR.root,['rev-parse','HEAD']);if(sha===SUCCESSOR.baseSha)successorFail();return sha;
}
function envelopes(bytes){
 if(!bytes.length||bytes.at(-1)!==10)successorFail();let previous='0'.repeat(64);return bytes.toString().trimEnd().split('\n').map((line,i)=>{
 const r=JSON.parse(line);if(Object.keys(r).sort().join(',')!=='digest,event,previous,sequence'||r.sequence!==i||r.previous!==previous||r.digest!==hash({sequence:i,previous,event:r.event}))successorFail();previous=r.digest;return r.event;});
}
function originals(){
 const config=json(RENEWAL.configPath);assertRenewalConfig(config);
 const rb=protectedBytes(SUCCESSOR.releasePath);if(rb.length<SUCCESSOR.prefixLength||rawHash(rb.subarray(0,SUCCESSOR.prefixLength))!==SUCCESSOR.prefixDigest)successorFail();
 const events=envelopes(rb),cb=protectedBytes(config.journalDirectory+'/'+config.runId+'.jsonl');
 if(rawHash(cb)!==SUCCESSOR.collectorDigest)successorFail();
 const ce=envelopes(cb),last=ce.at(-1);
 if(ce.length!==10||ce[0].type!=='run'||ce[0].binding!==RENEWAL.configDigest||last.type!=='database_query_intent'||last.binding.kind!=='owner'||last.binding.phase!=='before'||last.startedAt!==1790140208314)successorFail();
 if(!absent(config.journalDirectory+'/'+config.runId+'.lock'))successorFail();
 const old=events.filter(e=>String(e.type).startsWith('premerge_reads_'));
 if(old.length!==3||old[0].type!=='premerge_reads_intent'||old[1].type!=='premerge_reads_active'||old[2].type!=='premerge_reads_retired'||old[2].outcome!=='UNKNOWN'||old.some(e=>e.claimsDigest!==SUCCESSOR.claimsDigest||e.attemptId!==RENEWAL.attemptId)||hash(old[0].claims)!==SUCCESSOR.claimsDigest||old[0].claims.expiresAt>Date.now())successorFail();
 return {config,events,claims:old[0].claims,collectorIntentDigest:hash(last)};
}
export function exactFile(p,expected){
 const b=protectedBytes(p,65536),s=fs.lstatSync(p);
 if(s.dev!==expected.dev||s.ino!==expected.ino||s.size!==expected.size||s.gid!==expected.gid||(s.mode&0o7777)!==expected.mode||rawHash(b)!==expected.digest)successorFail();
}
export function classifyArchivePresence(sourceAbsent,destinationAbsent){
 if(sourceAbsent===destinationAbsent)successorFail();return sourceAbsent?'archived':'source';
}
function archiveState(){
 return files.map(f=>{const src=RELEASE_ADMISSION_ROOT+'/'+f.name,dst=SUCCESSOR.archive+'/'+f.name,a=absent(src),b=absent(dst);
 const position=classifyArchivePresence(a,b);exactFile(a?dst:src,f);return position;});
}
function noCollector(){
 for(const pid of fs.readdirSync('/proc').filter(n=>/^[0-9]+$/.test(n)&&Number(n)!==process.pid)){
  try{const args=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0');
   const executable=fs.readlinkSync('/proc/'+pid+'/exe'),cwd=fs.readlinkSync('/proc/'+pid+'/cwd');
   if(path.basename(executable).startsWith('node')&&cwd.includes('zola-owned-collector-successor')&&args.some(a=>path.basename(a)==='zola-six-read-collect.js'))successorFail();
   if(args.some(a=>/^zola-(?:six-read-collect|release-owned.*operator|release-owned-collector-successor)\.js$/.test(path.basename(a))))successorFail();
  }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
 }
}
function zeroAdmissions(config){
 const identity=json(config.denialReceiptPath).databaseIdentity;
 const fence=()=>{const st=fs.lstatSync(config.databasePath);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||(st.mode&0o007)||['dev','ino','uid'].some(k=>st[k]!==identity[k]))successorFail();
 if(!fs.readdirSync('/proc/'+config.apiPid+'/fd').some(n=>{try{const f=fs.statSync('/proc/'+config.apiPid+'/fd/'+n);return f.dev===identity.dev&&f.ino===identity.ino;}catch{return false;}}))successorFail();};
 fence();const db=new DatabaseSync(config.databasePath,{readOnly:true});db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
 try{const keys=Array.from({length:6},(_,i)=>'zola-six:'+config.runId+':'+i).concat('zola-denial:'+config.runId);
 for(const key of keys)if(db.prepare('SELECT count(*) n FROM tasks WHERE idempotency_key=?').get('unified:jarvis:'+key).n!==0||db.prepare('SELECT count(*) n FROM unified_inputs WHERE idempotency_key=?').get(key).n!==0)successorFail();
 }finally{db.exec('ROLLBACK');db.close();fence();}
}
function logProof(){
 const out=execFileSync('/usr/bin/journalctl',['-u','blackspire-owned-postgres.service','--since','2026-09-23T05:10:08Z','--until','2026-09-23T05:10:10Z','--output=json','--no-pager'],{encoding:'utf8',timeout:10000,maxBuffer:262144,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 const rows=out.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)).filter(r=>r.__REALTIME_TIMESTAMP==='1790140208365124'&&rawHash(Buffer.from(r.MESSAGE??''))===SUCCESSOR.logDigest);
 if(rows.length!==1||rows[0]._SYSTEMD_UNIT!=='blackspire-owned-postgres.service'||!rows[0].MESSAGE.includes('ERROR:')||!rows[0].MESSAGE.includes('permission denied to set role "authenticated"'))successorFail();
 return {unit:'blackspire-owned-postgres.service',timestamp:'1790140208365124',messageDigest:SUCCESSOR.logDigest,classification:'SET_ROLE_AUTHENTICATED_PERMISSION_DENIED'};
}
async function liveFence(config,claims){
 noCollector();zeroAdmissions(config);
 const gid=fs.lstatSync(RELEASE_ADMISSION_ROOT+'/state.json').gid;
 const state=validateReleaseAdmissionState(readRootOwnedJson(RELEASE_ADMISSION_ROOT+'/state.json',{groupId:gid,maxBytes:4096}));
 if(state.mode!=='held'||state.releaseSha!==RENEWAL.releaseSha||state.runId!==RENEWAL.runId||state.apiGeneration!==null||state.workerGeneration!==null||!absent(RELEASE_ADMISSION_ROOT+'/premerge-reads-active.json')||!absent(RELEASE_ADMISSION_ROOT+'/acceptance-active.json'))successorFail();
 const runtime=await observeHeldLifecycle({releaseSha:RENEWAL.releaseSha,runId:RENEWAL.runId});
 if(runtime.api.pid!==config.apiPid||runtime.worker.pid!==config.workerPid||runtime.api.generation!==claims.apiGeneration||runtime.worker.generation!==claims.workerGeneration)successorFail();
 noCollector();zeroAdmissions(config);return runtime;
}
export function readTerminalProof(){
 checkSuccessorSource();const o=originals(),intent=json(SUCCESSOR.archive+'/intent.json'),completion=json(SUCCESSOR.archive+'/completion.json'),terminal=json(SUCCESSOR.archive+'/terminal.json');
 const expectedLog={unit:'blackspire-owned-postgres.service',timestamp:'1790140208365124',messageDigest:SUCCESSOR.logDigest,classification:'SET_ROLE_AUTHENTICATED_PERMISSION_DENIED'};
 const expectedIntent={version:1,kind:'owned-collector-archive-intent',operatorSha:checkSuccessorSource(),releaseSha:RENEWAL.releaseSha,operationId:RENEWAL.operationId,attemptId:RENEWAL.attemptId,runId:RENEWAL.runId,configDigest:RENEWAL.configDigest,originalReleasePrefixDigest:SUCCESSOR.prefixDigest,collectorDigest:SUCCESSOR.collectorDigest,originalClaimsDigest:SUCCESSOR.claimsDigest,collectorIntentDigest:o.collectorIntentDigest,files,runtime:intent.runtime,logProof:expectedLog};
 validateHeldLifecycleProof(intent.runtime,{releaseSha:RENEWAL.releaseSha,runId:RENEWAL.runId});
 if(intent.runtime.api.pid!==o.config.apiPid||intent.runtime.worker.pid!==o.config.workerPid||intent.runtime.api.generation!==o.claims.apiGeneration||intent.runtime.worker.generation!==o.claims.workerGeneration)successorFail();
 const expectedCompletion={version:1,status:'BOTH_ARCHIVED',intentDigest:hash(intent),filesDigest:hash(files)};
 const expectedTerminal={version:1,status:'FAILED_BEFORE_ADMISSION',intentDigest:hash(intent),archiveProofDigest:hash(completion),logProof:expectedLog};
 if(hash(intent)!==hash(expectedIntent)||hash(completion)!==hash(expectedCompletion)||hash(terminal)!==hash(expectedTerminal))successorFail();
 for(const [i,f] of files.entries()){
  exactFile(SUCCESSOR.archive+'/'+f.name,f);
  const mi={version:1,kind:'archive-rename-intent',archiveIntentDigest:hash(intent),file:f};
  const mr={version:1,kind:'archive-rename-result',moveIntentDigest:hash(mi),status:'EXACT_INODE_ARCHIVED'};
  if(hash(json(SUCCESSOR.archive+'/move-'+i+'-intent.json'))!==hash(mi)||hash(json(SUCCESSOR.archive+'/move-'+i+'-result.json'))!==hash(mr))successorFail();
 }
 return {terminalProofDigest:hash(terminal),archiveProofDigest:hash(completion),collectorDigest:SUCCESSOR.collectorDigest,originalClaimsDigest:SUCCESSOR.claimsDigest,originalReleasePrefixDigest:'0ed573b0739b69fa90d76d76d04037e8e86c7f07b40898761098ad404c5a28c8',segmentDirectory:SUCCESSOR.archive+'/collector'};
}
export async function assertSuccessorReady(config,events){
 assertRenewalConfig(config);const proof=readTerminalProof(),matches=events.filter(e=>e.type==='premerge_observation_failure');
 if(matches.length!==1||hash(matches[0])!==hash({schema:2,type:'premerge_observation_failure',attemptId:RENEWAL.attemptId,...Object.fromEntries(Object.entries(proof).filter(([k])=>k!=='segmentDirectory'))}))successorFail();const o=originals();if(files.some(f=>!absent(RELEASE_ADMISSION_ROOT+'/'+f.name)))successorFail();await liveFence(config,o.claims);return proof;
}
export async function validateRecoveryBeforeIssuance(){
 const o=originals(),gid=fs.lstatSync(RELEASE_ADMISSION_ROOT+'/state.json').gid;
 const lease=acquireReleaseAdmissionLock({exclusive:false,allowPending:true,owner:0,groupId:gid});
 try{const proof=await assertSuccessorReady(o.config,o.events);lease.assertIdentity();if(files.some(f=>!absent(RELEASE_ADMISSION_ROOT+'/'+f.name)))successorFail();await liveFence(o.config,o.claims);lease.assertIdentity();return {config:o.config,terminalProof:proof};}finally{lease.close();}
}
export function classifyArchiveMove({position,hasIntent,hasResult,intentMatches=false,resultMatches=false}){
 if(position==='source'){if(hasIntent||hasResult)successorFail();return 'dispatch';}
 if(position!=='archived'||!hasIntent||!intentMatches||hasResult&&!resultMatches)successorFail();
 return hasResult?'complete':'observe';
}
export function renameNoReplace(source,destination){
 const code='import ctypes,os,sys\nl=ctypes.CDLL(None,use_errno=True)\nr=l.renameat2(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1)\nif r: raise OSError(ctypes.get_errno(), "no-clobber rename failed")\n';
 execFileSync('/usr/bin/python3',['-c',code,source,destination],{timeout:10000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 sync(path.dirname(source));sync(path.dirname(destination));
}
export async function archiveOldObservation({mutate=false,reconcile=false}={}){
 const operatorSha=checkSuccessorSource();let journal,lease;
 try{
  if(mutate)journal=openReleaseJournal();
  const o=originals(),gid=fs.lstatSync(RELEASE_ADMISSION_ROOT+'/state.json').gid;
  lease=acquireReleaseAdmissionLock({exclusive:mutate,allowPending:true,owner:0,groupId:gid});
  const runtime=await liveFence(o.config,o.claims),proof=logProof();
  const prefixRows=envelopes(protectedBytes(SUCCESSOR.releasePath).subarray(0,SUCCESSOR.prefixLength));
  const trailing=o.events.slice(prefixRows.length);
  if(trailing.length>1||trailing.some(e=>e.type!=='premerge_observation_failure'))successorFail();
  if(!mutate){archiveState();return {status:'ARCHIVE_PREFLIGHT_VERIFIED'};}
  if(absent(SUCCESSOR.archive)){fs.mkdirSync(SUCCESSOR.archive,{mode:0o700});sync(path.dirname(SUCCESSOR.archive));}
  const ds=fs.lstatSync(SUCCESSOR.archive);if(!ds.isDirectory()||ds.isSymbolicLink()||ds.uid!==0||(ds.mode&0o7777)!==0o700)successorFail();
  const intentPath=SUCCESSOR.archive+'/intent.json';
  const binding={version:1,kind:'owned-collector-archive-intent',operatorSha,releaseSha:RENEWAL.releaseSha,operationId:RENEWAL.operationId,attemptId:RENEWAL.attemptId,runId:RENEWAL.runId,configDigest:RENEWAL.configDigest,originalReleasePrefixDigest:SUCCESSOR.prefixDigest,collectorDigest:SUCCESSOR.collectorDigest,originalClaimsDigest:SUCCESSOR.claimsDigest,collectorIntentDigest:o.collectorIntentDigest,files,runtime,logProof:proof};
  if(absent(intentPath)){if(reconcile)successorFail();writeZolaActivationProfile(intentPath,binding);}else if(!reconcile||hash(json(intentPath))!==hash(binding))successorFail();
  originals();lease.assertIdentity();if(hash(await liveFence(o.config,o.claims))!==hash(runtime))successorFail();
  const positions=archiveState();
  for(let i=0;i<files.length;i++){
   const f=files[i],moveIntent=SUCCESSOR.archive+'/move-'+i+'-intent.json',moveResult=SUCCESSOR.archive+'/move-'+i+'-result.json';
   const mi={version:1,kind:'archive-rename-intent',archiveIntentDigest:hash(binding),file:f};
   const mr={version:1,kind:'archive-rename-result',moveIntentDigest:hash(mi),status:'EXACT_INODE_ARCHIVED'};
   const hasIntent=!absent(moveIntent),hasResult=!absent(moveResult);
   const action=classifyArchiveMove({position:positions[i],hasIntent,hasResult,intentMatches:hasIntent&&hash(json(moveIntent))===hash(mi),resultMatches:hasResult&&hash(json(moveResult))===hash(mr)});
   if(action==='dispatch'){
    // A retained dispatch intent with a source still present is never replayed.
    if(!absent(moveIntent)||!absent(moveResult))successorFail();
    originals();lease.assertIdentity();if(hash(await liveFence(o.config,o.claims))!==hash(runtime))successorFail();exactFile(RELEASE_ADMISSION_ROOT+'/'+f.name,f);
    if(checkSuccessorSource()!==operatorSha)successorFail();lease.assertIdentity();writeZolaActivationProfile(moveIntent,mi);
    if(checkSuccessorSource()!==operatorSha)successorFail();lease.assertIdentity();renameNoReplace(RELEASE_ADMISSION_ROOT+'/'+f.name,SUCCESSOR.archive+'/'+f.name);exactFile(SUCCESSOR.archive+'/'+f.name,f);
   }else if(absent(moveIntent)||hash(json(moveIntent))!==hash(mi))successorFail();
   if(absent(moveResult))writeZolaActivationProfile(moveResult,mr);else if(hash(json(moveResult))!==hash(mr))successorFail();
  }
  if(archiveState().some(s=>s!=='archived'))successorFail();
  const completion={version:1,status:'BOTH_ARCHIVED',intentDigest:hash(binding),filesDigest:hash(files)};
  const terminal={version:1,status:'FAILED_BEFORE_ADMISSION',intentDigest:hash(binding),archiveProofDigest:hash(completion),logProof:proof};
  for(const [name,value] of [['completion.json',completion],['terminal.json',terminal]]){const p=SUCCESSOR.archive+'/'+name;if(absent(p))writeZolaActivationProfile(p,value);else if(hash(json(p))!==hash(value))successorFail();}
  const segment=SUCCESSOR.archive+'/collector';if(absent(segment)){fs.mkdirSync(segment,{mode:0o700});sync(SUCCESSOR.archive);}
  const result=readTerminalProof(),event={schema:2,type:'premerge_observation_failure',attemptId:RENEWAL.attemptId,...Object.fromEntries(Object.entries(result).filter(([k])=>k!=='segmentDirectory'))};
  const existing=journal.stream('release').events().filter(e=>e.type===event.type);
  if(checkSuccessorSource()!==operatorSha)successorFail();lease.assertIdentity();
  if(!existing.length)journal.stream('release').append(event);else if(existing.length!==1||hash(existing[0])!==hash(event))successorFail();
  return {status:'FAILED_OBSERVATION_ARCHIVED',...result};
 }finally{lease?.close();journal?.close();}
}
