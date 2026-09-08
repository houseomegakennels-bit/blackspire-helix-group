import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {findMissingSchemaObjects} from '../shared/schema-validation.js';
import {readReleaseProtectedBytes} from './commander-host.js';

export const RELEASE_BACKUP_ROOT='/var/lib/blackspire-operator/preparation/zola-backups';
export const RELEASE_DATABASE='/opt/blackspire-command/shared/database/command.sqlite';
const reject=()=>{throw new Error('Protected release backup rejected');};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&value!=='/';
const identity=stat=>({device:stat.dev,inode:stat.ino});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function syncDirectory(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function protectDirectory(directory){
 if(!absolute(directory))reject();
 for(let current=directory;;current=path.dirname(current)){
  const s=fs.lstatSync(current);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))reject();
  const acl=spawnSync('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',current],{encoding:'utf8',timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});
  if(acl.status!==0||acl.error||acl.stdout!==''||acl.stderr!=='')reject();
  if(current==='/')break;
 }
 if((fs.lstatSync(directory).mode&0o7777)!==0o700)reject();
}
function sourceIdentity(sourcePath){
 if(!absolute(sourcePath)||fs.realpathSync(sourcePath)!==sourcePath)reject();
 const s=fs.lstatSync(sourcePath);if(!s.isFile()||s.nlink!==1||s.size<1)reject();
 return identity(s);
}
export function measureProtectedBackupEnvelope(sourcePath,root,{io=fs}={}){
 try{
  let sourceBytes=0;
  for(const suffix of ['', '-wal', '-shm']){
   let stat;try{stat=io.lstatSync(sourcePath+suffix);}catch(error){if(suffix&&error.code==='ENOENT')continue;throw error;}
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)reject();
   sourceBytes+=Math.max(stat.size,stat.blocks*512);
  }
  if(!Number.isSafeInteger(sourceBytes)||sourceBytes<1||sourceBytes>1024*1024*1024)reject();
  const capacity=io.statfsSync(root,{bigint:true}),available=capacity.bavail*capacity.bsize;
  // Two source-sized allocations cover VACUUM output and its transient work;
  // retain 64MiB for journal/log growth. This command performs no build/install.
  const reserveBytes=64*1024*1024,requiredBytes=sourceBytes*2+reserveBytes;
  if(available<BigInt(requiredBytes)||available>BigInt(Number.MAX_SAFE_INTEGER))reject();
  return{sourceBytes,reserveBytes,requiredBytes,freeBytes:Number(available),copyTimeoutMs:30000};
 }catch{reject();}
}
export function copyProtectedBackup(sourceFd,snapshotFile,{run=spawnSync,maxBytes=1024*1024*1024}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<4096||maxBytes>1024*1024*1024)reject();
 const result=run('/usr/bin/prlimit',[`--fsize=${maxBytes}:${maxBytes}`,'--','/opt/nodejs/node-v22.23.1-linux-x64/bin/node',
  '--disable-warning=ExperimentalWarning',fileURLToPath(new URL('./commander-backup-worker.js',import.meta.url)),snapshotFile],{
  encoding:'utf8',stdio:['ignore','pipe','pipe',sourceFd],timeout:30000,killSignal:'SIGKILL',maxBuffer:4096,
  env:{PATH:'/usr/bin:/bin',LC_ALL:'C',SQLITE_TMPDIR:path.dirname(snapshotFile)},
 });
 if(result.status!==0||result.error||result.signal||result.stdout!==''||result.stderr!=='')reject();
}
function snapshotProof(filename){
 let fd,db;
 try{
  fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.uid!==0||before.nlink!==1||(before.mode&0o7777)!==0o600||before.size<1||before.size>1024*1024*1024)reject();
  const acl=spawnSync('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{encoding:'utf8',stdio:['ignore','pipe','pipe',fd],timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});
  if(acl.status!==0||acl.error||acl.stdout!==''||acl.stderr!=='')reject();
  const header=Buffer.alloc(100);if(fs.readSync(fd,header,0,100,0)!==100||header.toString('utf8',0,16)!=='SQLite format 3\u0000'||header[18]!==1||header[19]!==1)reject();
  for(const suffix of ['-wal','-shm','-journal'])if(fs.existsSync(filename+suffix))reject();
  const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let position=0,count;
  while((count=fs.readSync(fd,buffer,0,buffer.length,position))){digest.update(buffer.subarray(0,count));position+=count;}
  db=new DatabaseSync(`/proc/self/fd/${fd}`,{readOnly:true});
  if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||findMissingSchemaObjects(db).length)reject();
  db.close();db=undefined;
  const after=fs.fstatSync(fd),current=fs.lstatSync(filename);
  if(['dev','ino','size','mtimeMs','ctimeMs','mode','uid','nlink'].some(k=>before[k]!==after[k])||!equal(identity(current),identity(before))||current.isSymbolicLink())reject();
  return{sha256:digest.digest('hex'),sizeBytes:before.size,...identity(before),integrity:'ok',schemaCompatible:true};
 }finally{db?.close();if(fd!==undefined)fs.closeSync(fd);}
}

// The CLI supplies neither sourcePath nor root. Overrides permit disposable
// tests; production always captures the fixed canonical database into the fixed
// protected operator namespace. A failed capture is retained, never promoted.
export function captureProtectedReleaseBackup(releaseSha,{sourcePath=RELEASE_DATABASE,root=RELEASE_BACKUP_ROOT}={}){
 let fd;
 try{
  if(process.getuid?.()!==0||!sha(releaseSha)||!absolute(root))reject();
  protectDirectory(path.dirname(root));
  try{fs.mkdirSync(root,{mode:0o700});syncDirectory(path.dirname(root));}catch(error){if(error.code!=='EEXIST')throw error;}
  protectDirectory(root);
  const envelope=measureProtectedBackupEnvelope(sourcePath,root);
  const source=sourceIdentity(sourcePath),startedAt=new Date().toISOString();
  const directory=path.join(root,`${releaseSha}-${randomUUID()}`);
  fs.mkdirSync(directory,{mode:0o700});syncDirectory(root);protectDirectory(directory);
  const snapshotFile=path.join(directory,'snapshot.sqlite');
  fd=fs.openSync(sourcePath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  if(!equal(identity(fs.fstatSync(fd)),source))reject();
  copyProtectedBackup(fd,snapshotFile,{maxBytes:Math.ceil(envelope.sourceBytes/4096)*4096});
  if(!equal(sourceIdentity(sourcePath),source)||!equal(identity(fs.fstatSync(fd)),source))reject();
  fs.closeSync(fd);fd=undefined;
  fs.chmodSync(snapshotFile,0o600);
  fd=fs.openSync(snapshotFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  const snapshot=snapshotProof(snapshotFile),completedAt=new Date().toISOString();
  if(!equal(sourceIdentity(sourcePath),source))reject();
  const manifest={version:1,kind:'zola-protected-backup',releaseSha,sourcePath,source,startedAt,completedAt,envelope,snapshot};
  const manifestFile=path.join(directory,'manifest.json');
  fd=fs.openSync(manifestFile,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  fs.writeFileSync(fd,JSON.stringify(manifest)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;syncDirectory(directory);
  return{status:'PROTECTED_BACKUP_CAPTURED',manifestFile,releaseSha,snapshotSha256:snapshot.sha256,productionAccepted:false};
 }catch{reject();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function verifyProtectedReleaseBackup({releaseSha,manifestFile},{sourcePath=RELEASE_DATABASE,root=RELEASE_BACKUP_ROOT,now=Date.now()}={}){
 try{
  if(process.getuid?.()!==0||!sha(releaseSha)||!absolute(manifestFile)||path.basename(manifestFile)!=='manifest.json'
   ||path.dirname(path.dirname(manifestFile))!==root||!new RegExp('^'+releaseSha+'-[a-f0-9-]{36}$').test(path.basename(path.dirname(manifestFile))))reject();
  protectDirectory(path.dirname(manifestFile));
  const bytes=readReleaseProtectedBytes(manifestFile,16384),m=JSON.parse(bytes);
  if(!m||Object.keys(m).sort().join(',')!=='completedAt,envelope,kind,releaseSha,snapshot,source,sourcePath,startedAt,version'
   ||m.version!==1||m.kind!=='zola-protected-backup'||m.releaseSha!==releaseSha||m.sourcePath!==sourcePath
   ||!equal(m.source,sourceIdentity(sourcePath)))reject();
  const e=m.envelope;
  if(!e||Object.keys(e).sort().join(',')!=='copyTimeoutMs,freeBytes,requiredBytes,reserveBytes,sourceBytes'
   ||![e.sourceBytes,e.freeBytes,e.requiredBytes].every(Number.isSafeInteger)||e.sourceBytes<1||e.sourceBytes>1024*1024*1024
   ||e.reserveBytes!==64*1024*1024||e.requiredBytes!==e.sourceBytes*2+e.reserveBytes||e.freeBytes<e.requiredBytes||e.copyTimeoutMs!==30000)reject();
  const start=Date.parse(m.startedAt),end=Date.parse(m.completedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(now)||end<start||end>now||now-start>3600000)reject();
  const snapshot=snapshotProof(path.join(path.dirname(manifestFile),'snapshot.sqlite'));
  if(!equal(snapshot,m.snapshot)||readReleaseProtectedBytes(manifestFile,16384)!==bytes||!equal(m.source,sourceIdentity(sourcePath)))reject();
  return{status:'PROTECTED_BACKUP_VERIFIED',releaseSha,snapshotSha256:snapshot.sha256,manifestSha256:createHash('sha256').update(bytes).digest('hex'),
   sizeBytes:snapshot.sizeBytes,startedAt:m.startedAt,completedAt:m.completedAt,sourceIdentityBound:true,productionAccepted:false};
 }catch{reject();}
}
