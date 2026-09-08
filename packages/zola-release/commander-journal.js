import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const RELEASE_OPERATION_ROOT='/var/lib/blackspire-operator/release-operations';
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const reject=()=>{throw new Error('Zola release journal rejected; retain evidence and reconcile');};
function directorySync(root){const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
// One host-wide lock, including different release SHAs. Crashes retain the lock;
// no PID-only stale-lock deletion, and no new run ID can bypass an old intent.
export function openReleaseJournal({root=RELEASE_OPERATION_ROOT,owner=0}={}){
 let fd,lockFd;
 const lock=path.join(root,'commander.lock'),filename=path.join(root,'n8n.jsonl');
 try{
  if(!path.isAbsolute(root)||path.resolve(root)!==root)reject();
  for(let p=root;;p=path.dirname(p)){
   const s=fs.lstatSync(p);
   if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==owner||(s.mode&0o022))reject();
   if(p==='/')break;
  }
  if((fs.statSync(root).mode&0o777)!==0o700)reject();
  lockFd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),
   startTime:fs.readFileSync(`/proc/${process.pid}/stat`,'utf8').split(')').at(-1).trim().split(/\s+/)[19]})+'\n');
  fs.fsyncSync(lockFd);directorySync(root);
  fd=fs.openSync(filename,fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==owner||stat.nlink!==1||(stat.mode&0o7777)!==0o600||stat.size>1024*1024)reject();
  directorySync(root);
  const bytes=fs.readFileSync(fd,'utf8');if(bytes&&!bytes.endsWith('\n'))reject();
  const events=[];let previous='0'.repeat(64),closed=false;
  for(const line of bytes.split('\n').filter(Boolean)){
   const row=JSON.parse(line),body={sequence:events.length,previous,event:row.event};
   if(Object.keys(row).sort().join(',')!=='digest,event,previous,sequence'||row.sequence!==events.length||row.previous!==previous||row.digest!==hash(body))reject();
   previous=row.digest;events.push(row.event);
  }
  return{
   events:()=>structuredClone(events),
   append(event){
    if(closed)reject();
    const body={sequence:events.length,previous,event};const row={...body,digest:hash(body)},bytes=Buffer.from(JSON.stringify(row)+'\n');
    if(bytes.length>16384||fs.fstatSync(fd).size+bytes.length>1024*1024)reject();
    let offset=0;while(offset<bytes.length){const count=fs.writeSync(fd,bytes,offset,bytes.length-offset);if(count<1)reject();offset+=count;}
    fs.fsyncSync(fd);previous=row.digest;events.push(structuredClone(event));
   },
   close(){if(!closed){closed=true;fs.closeSync(fd);fd=undefined;fs.closeSync(lockFd);lockFd=undefined;fs.unlinkSync(lock);directorySync(root);}},
  };
 }catch{
  if(fd!==undefined)try{fs.closeSync(fd);}catch{/* preserve fail-closed state */}
  if(lockFd!==undefined)try{fs.closeSync(lockFd);}catch{/* retain lock even if open failed */}
  reject();
 }
}

// GET-only reconciliation may recover a demonstrably dead owner. Preserve the
// original lock as immutable evidence before unlinking its active name. The CLI
// never invokes recovery for a mutation mode; live/unknown owner always blocks.
export function recoverReleaseJournalLock({root=RELEASE_OPERATION_ROOT}={}){
 let fd;
 try{
  if(!path.isAbsolute(root)||path.resolve(root)!==root)reject();
  for(let p=root;;p=path.dirname(p)){
   const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))reject();if(p==='/')break;
  }
  if((fs.statSync(root).mode&0o777)!==0o700)reject();
  const lock=path.join(root,'commander.lock');
  try{fd=fs.openSync(lock,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(error){if(error.code==='ENOENT')return{recovered:false};throw error;}
  // Linux flock follows this shared open-file description. The helper exits,
  // but the parent fd retains the lock through verification/unlink/fsync. This
  // serializes competing recoverers before either can replace the active name.
  const locked=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','3'],{
   stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:1000,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(locked.status!==0||locked.error||locked.stdout!==''||locked.stderr!=='')reject();
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==0||![1,2].includes(stat.nlink)||![0o600,0o400].includes(stat.mode&0o7777)||stat.size<1||stat.size>512)reject();
  const bytes=fs.readFileSync(fd,'utf8');if(Buffer.byteLength(bytes)!==stat.size)reject();
  const owner=JSON.parse(bytes);
  if(Object.keys(owner).sort().join(',')!=='bootId,pid,startTime'||!Number.isSafeInteger(owner.pid)||owner.pid<1||owner.pid>4294967294
   ||typeof owner.bootId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(owner.bootId)
   ||typeof owner.startTime!=='string'||!(/^[0-9]{1,24}$/).test(owner.startTime))reject();
  const bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  if(bootId===owner.bootId){
   try{
    const current=fs.readFileSync(`/proc/${owner.pid}/stat`,'utf8').split(')').at(-1).trim().split(/\s+/);
    if(current.length<20||!(/^[0-9]+$/).test(current[19])||current[19]===owner.startTime)reject();
   }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const unchanged=()=>{
   const current=fs.lstatSync(lock),open=fs.fstatSync(fd);
   if(current.dev!==stat.dev||current.ino!==stat.ino||open.size!==stat.size||open.uid!==0||fs.readFileSync(lock,'utf8')!==bytes)reject();
  };
  unchanged();
  const retained=path.join(root,`commander.lock.retained-${hash(bytes)}`);
  if(stat.nlink===2){
   // Resume only our exact interrupted retain operation, never an arbitrary
   // hard link. The same protected inode and bytes must occupy the hash name.
   const saved=fs.lstatSync(retained);
   if(!saved.isFile()||saved.isSymbolicLink()||saved.uid!==0||saved.dev!==stat.dev||saved.ino!==stat.ino
    ||saved.nlink!==2||saved.mode!==stat.mode||fs.readFileSync(retained,'utf8')!==bytes)reject();
  }else{
   if((stat.mode&0o7777)!==0o600)reject();
   fs.linkSync(lock,retained); // EXCL, no overwrite
  }
  directorySync(root);
  unchanged();
  fs.fchmodSync(fd,0o400);fs.fsyncSync(fd);
  fs.unlinkSync(lock);directorySync(root);
  return{recovered:true,retainedDigest:hash(bytes)};
 }catch{reject();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
