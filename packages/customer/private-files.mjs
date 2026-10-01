import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const fail=code=>{throw new Error(code);};
export function privateDirectory(dir){const s=fs.lstatSync(dir);if(!s.isDirectory()||(s.mode&0o077)||s.uid!==process.getuid())fail('PRIVATE_DIRECTORY_REQUIRED');}
export function readPrivate(file,max=131072){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||(s.mode&0o077)||s.uid!==process.getuid()||s.size>max)fail('PRIVATE_FILE_REQUIRED');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
export function atomicPrivate(file,content){const temp=file+'.'+randomUUID()+'.tmp';try{const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fs.existsSync(file))readPrivate(file);fs.renameSync(temp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
export function exclusive(root,fn){const lock=path.join(root,'.configuration-lock');fs.mkdirSync(lock,{mode:0o700});try{return fn();}finally{fs.rmdirSync(lock);}}

export async function exclusiveAsync(root,fn){privateDirectory(root);const lock=path.join(root,'.configuration-lock');fs.mkdirSync(lock,{mode:0o700});try{return await fn();}finally{fs.rmdirSync(lock);}}
export function assertNoRecoveryHold(root){try{fs.lstatSync(path.join(root,'recovery-hold.json'));}catch(e){if(e.code==='ENOENT')return;throw e;}fail('RECOVERY_RECONCILIATION_REQUIRED');}
