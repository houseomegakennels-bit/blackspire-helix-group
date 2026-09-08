import fs from 'node:fs';
import path from 'node:path';

export const MIGRATION_OPERATION_ROOT='/var/lib/blackspire-operator/migration-operations';

function trustedDirectory(directory){
 if(!path.isAbsolute(directory)||path.resolve(directory)!==directory||directory==='/')throw new Error();
 for(let p=directory;;p=path.dirname(p)){
  const s=fs.lstatSync(p);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw new Error();
  if(p==='/')break;
 }
}
function syncDirectory(directory){
 const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
// The production CLI always uses the fixed root. The optional root enables
// isolated filesystem tests; it is never a user-controlled CLI configuration.
export function claimBuyerMigrationIntent(plan,{root=MIGRATION_OPERATION_ROOT}={}){
 try{
  if(!/^[a-f0-9]{40}$/.test(plan?.releaseSha??'')||!/^\d{14}$/.test(plan?.migrationVersion??'')
   ||!(/^[a-f0-9]{64}$/).test(plan?.bodySha256??'')||!(/^[a-f0-9]{64}$/).test(plan?.manifestSha256??''))throw new Error();
  trustedDirectory(path.dirname(root));
  try{fs.mkdirSync(root,{mode:0o700});syncDirectory(path.dirname(root));}catch(e){if(e.code!=='EEXIST')throw e;}
  trustedDirectory(root);
  const filename=path.join(root,`${plan.releaseSha}-${plan.bodySha256}.json`);
  const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify({version:1,...plan,status:'apply-intent-reconcile-before-any-retry',timestamp:new Date().toISOString()})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  syncDirectory(root);
  return filename;
 }catch{throw new Error('Buyer migration durable intent unavailable or already exists; reconcile only');}
}

export function openBuyerMigrationEvidence(filename){
 let fd;
 try{
  if(!path.isAbsolute(filename)||path.resolve(filename)!==filename||filename==='/')throw new Error();
  trustedDirectory(path.dirname(filename));
  fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  syncDirectory(path.dirname(filename));
  return fd;
 }catch{if(fd!==undefined)try{fs.closeSync(fd);}catch{/* preserve original sanitized error */}throw new Error('Buyer migration evidence unavailable');}
}
export function appendBuyerMigrationEvidence(fd,record){
 const bytes=Buffer.from(JSON.stringify(record)+'\n');let offset=0;
 while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,bytes.length-offset);if(n<1)throw new Error('Buyer migration evidence write failed');offset+=n;}
 fs.fsyncSync(fd);
}
