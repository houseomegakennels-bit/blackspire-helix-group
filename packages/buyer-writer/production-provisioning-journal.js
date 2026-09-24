import fs from 'node:fs';
import path from 'node:path';

export const BUYER_WRITER_PROVISIONING_JOURNAL_ROOT='/var/lib/blackspire-operator/buyer-writer-provisioning';
export const OWNED_BUYER_WRITER_PROVISIONING_JOURNAL_ROOT='/var/lib/blackspire-operator/owned-buyer-writer-provisioning';
export const BUYER_WRITER_PROVISIONING_JOURNAL_FILE=`${BUYER_WRITER_PROVISIONING_JOURNAL_ROOT}/state.json`;

const SHA=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const modes=new Set(['apply','rollback','reconcile','verify']);
const phases=new Set(['started','roles-disabled','installer-committed','credential-transaction-started',
  'verified-committed','fail-closed','rollback-complete','failed']);
const statuses=new Set(['IN_PROGRESS','COMPLETED','FAILED','FAIL_CLOSED']);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const fail=()=>{throw new Error('Buyer writer provisioning journal rejected');};

// This intentionally accepts no diagnostic/error field: driver errors and SQL
// text can contain protected parameters. Catalog truth, not this journal, is
// authoritative when reconciling an interrupted attempt.
export function encodeBuyerWriterProvisioningJournal(value){
 try{
  const fields=[2,3].includes(value?.version)
    ?['version','kind','releaseSha','operationId','attemptId','installerSha256','mode','phase','status','updatedAt',...(value.version===3?['backendProfile','profileDigest']:[])]
    :['version','kind','operationId','installerSha256','mode','phase','status','updatedAt'];
  if(!exact(value,fields)||![1,2,3].includes(value.version)||value.kind!=='buyer_writer_production_provisioning'
   ||!UUID.test(value.operationId??'')||([2,3].includes(value.version)&&(!SHA.test(value.releaseSha??'')
    ||!UUID.test(value.attemptId??'')||value.attemptId===value.operationId))
   ||(value.version===3&&(value.backendProfile!=='owned-postgres-v1'||!SHA256.test(value.profileDigest??'')))
   ||!SHA256.test(value.installerSha256??'')||!modes.has(value.mode)||!phases.has(value.phase)
   ||!statuses.has(value.status)||typeof value.updatedAt!=='string'||new Date(value.updatedAt).toISOString()!==value.updatedAt)fail();
  if(value.status==='IN_PROGRESS'&&!['started','roles-disabled','installer-committed','credential-transaction-started'].includes(value.phase)
   ||value.status==='COMPLETED'&&!['verified-committed','rollback-complete'].includes(value.phase)
   ||value.status==='FAIL_CLOSED'&&value.phase!=='fail-closed'
   ||value.status==='FAILED'&&value.phase!=='failed')fail();
  return `${JSON.stringify(value)}\n`;
 }catch(error){if(error?.message==='Buyer writer provisioning journal rejected')throw error;fail();}
}

function safeDirectory(directory,io){
 const stat=io.lstatSync(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||stat.gid!==0||(stat.mode&0o7777)!==0o700)fail();
}
function syncDirectory(directory,io){
 const fd=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}
function ensureRoot(root,io){
 if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root||root==='/')fail();
 const parent=path.dirname(root),parentStat=io.lstatSync(parent);
 if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||parentStat.uid!==0||(parentStat.mode&0o022)!==0)fail();
 try{safeDirectory(root,io);return;}catch(error){
  try{io.lstatSync(root);throw error;}catch(missing){if(missing?.code!=='ENOENT')throw error;}
 }
 io.mkdirSync(root,{mode:0o700});io.chownSync(root,0,0);io.chmodSync(root,0o700);
 safeDirectory(root,io);syncDirectory(parent,io);
}
function safeExisting(filename,io){
 try{
  const stat=io.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||stat.gid!==0||stat.nlink!==1||(stat.mode&0o7777)!==0o600)fail();
 }catch(error){if(error?.code!=='ENOENT')throw error;}
}

export function writeBuyerWriterProvisioningJournal(value,{root=value?.version===3?OWNED_BUYER_WRITER_PROVISIONING_JOURNAL_ROOT:BUYER_WRITER_PROVISIONING_JOURNAL_ROOT,io=fs,uid=process.getuid?.()}={}){
 if(uid!==0)fail();
 const bytes=Buffer.from(encodeBuyerWriterProvisioningJournal(value));
 let fd,identity,renamed=false,temp;
 try{
  ensureRoot(root,io);const filename=path.join(root,'state.json');safeExisting(filename,io);
  temp=path.join(root,`.state-${process.pid}.new`);safeExisting(temp,io);
  try{io.lstatSync(temp);fail();}catch(error){if(error?.code!=='ENOENT')throw error;}
  fd=io.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  identity=io.fstatSync(fd);io.fchownSync(fd,0,0);io.fchmodSync(fd,0o600);
  io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
  io.renameSync(temp,filename);renamed=true;syncDirectory(root,io);
  safeExisting(filename,io);return Object.freeze({...value});
 }catch(error){if(error?.message==='Buyer writer provisioning journal rejected')throw error;fail();}
 finally{
  bytes.fill(0);if(fd!==undefined)try{io.closeSync(fd);}catch{}
  if(temp&&!renamed&&identity)try{const stat=io.lstatSync(temp);if(stat.dev===identity.dev&&stat.ino===identity.ino)io.unlinkSync(temp);}catch{}
 }
}
