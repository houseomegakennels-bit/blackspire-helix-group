import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './commander-journal.js';

export const FINAL_RELEASE_RECORD_ROOT='/var/lib/blackspire-operator/release-records';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const reject=()=>{throw new Error('Final release record rejected; preserve HELD and reconcile');};

function directory(root,owner){
 const stat=fs.lstatSync(root);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==owner||(stat.mode&0o7777)!==0o700)reject();
 return root;
}
function syncDirectory(root){const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function bytes(value){return Buffer.from(`${JSON.stringify(value)}\n`);}
function readExact(filename,{links=1,owner=0}={}){
 const stat=fs.lstatSync(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==owner||stat.gid!==owner||stat.nlink!==links||(stat.mode&0o7777)!==0o600||stat.size>16384)reject();
 const raw=fs.readFileSync(filename);let value;try{value=JSON.parse(raw);}catch{reject();}
 if(!raw.equals(bytes(value)))reject();return value;
}
function reconcileLinkedPublication(filename,value,owner){
 const stat=fs.lstatSync(filename);if(stat.nlink===1)return readExact(filename,{owner});
 if(stat.nlink!==2)reject();
 const prefix=`${path.basename(filename)}.`,matches=fs.readdirSync(path.dirname(filename)).filter(name=>name.startsWith(prefix)&&name.endsWith('.pending'))
  .filter(name=>{const candidate=fs.lstatSync(path.join(path.dirname(filename),name));return candidate.dev===stat.dev&&candidate.ino===stat.ino;});
 if(matches.length!==1)reject();const pending=path.join(path.dirname(filename),matches[0]);
 const current=readExact(filename,{links:2,owner}),pendingValue=readExact(pending,{links:2,owner});if(JSON.stringify(current)!==JSON.stringify(value)||JSON.stringify(pendingValue)!==JSON.stringify(value))reject();
 fs.unlinkSync(pending);syncDirectory(path.dirname(filename));return readExact(filename,{owner});
}
function createExact(filename,value,owner){
 const raw=bytes(value),temporary=`${filename}.${process.pid}-${randomUUID()}.pending`;let fd;
 try{
  try{const current=reconcileLinkedPublication(filename,value,owner);if(JSON.stringify(current)!==JSON.stringify(value))reject();return true;}catch(error){if(error.code!=='ENOENT')throw error;}
  fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  fs.fchownSync(fd,owner,owner);fs.fchmodSync(fd,0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;const current=reconcileLinkedPublication(filename,value,owner);if(JSON.stringify(current)!==JSON.stringify(value))reject();try{fs.unlinkSync(temporary);}catch(unlink){if(unlink.code!=='ENOENT')throw unlink;}syncDirectory(path.dirname(filename));return true;}
  syncDirectory(path.dirname(filename));fs.unlinkSync(temporary);syncDirectory(path.dirname(filename));return false;
 }catch(error){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(unlink){if(unlink.code!=='ENOENT')throw unlink;}throw error;}
}

function validateAccepted(value){
 const keys=['schema','kind','releaseSha','previousMainSha','newMainSha','operationId','attemptId','stageInputDigest','checkOutputDigest','sequenceInputDigest','registryDigest','acceptedStagesDigest','epochRunId','permitId','permitDigest','apiGeneration','workerGeneration','rollbackAcceptanceDigest','acceptedAt'];
 if(!exact(value,keys)||value.schema!==1||value.kind!=='zola_release_accepted_held'||![value.releaseSha,value.previousMainSha,value.newMainSha].every(sha)
  ||value.newMainSha===value.previousMainSha||![value.operationId,value.attemptId,value.epochRunId,value.permitId].every(uuid)
  ||!['stageInputDigest','checkOutputDigest','sequenceInputDigest','registryDigest','acceptedStagesDigest','permitDigest','rollbackAcceptanceDigest'].every(key=>digest(value[key]))
  ||!uuid(value.apiGeneration)||!uuid(value.workerGeneration)||value.apiGeneration===value.workerGeneration
  ||typeof value.acceptedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.acceptedAt))reject();
 return structuredClone(value);
}
function validateOpen(value){
 const keys=['schema','kind','releaseSha','newMainSha','operationId','attemptId','stageInputDigest','checkOutputDigest','acceptedRecordDigest','openAdmissionDigest','openedAt'];
 if(!exact(value,keys)||value.schema!==1||value.kind!=='zola_release_open'||![value.releaseSha,value.newMainSha].every(sha)||![value.operationId,value.attemptId].every(uuid)
  ||!['stageInputDigest','checkOutputDigest','acceptedRecordDigest','openAdmissionDigest'].every(key=>digest(value[key]))||typeof value.openedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.openedAt))reject();
 return structuredClone(value);
}
function filename(root,releaseSha,suffix,owner){return path.join(directory(root,owner),`${releaseSha}.${suffix}.json`);}

// Stage 33 records acceptance while admission is still HELD. It deliberately
// cannot claim OPEN; only stage 34 may append the separate OPEN record.
export function writeAcceptedHeldReleaseRecord({record,root=FINAL_RELEASE_RECORD_ROOT,owner=0}){
 const value=validateAccepted(record),file=filename(root,value.releaseSha,'accepted-held',owner);
 const replayed=createExact(file,value,owner);return Object.freeze({status:'PASS',kind:value.kind,file,recordDigest:hash(value),replayed});
}
export function writeOpenReleaseRecord({record,root=FINAL_RELEASE_RECORD_ROOT,owner=0}){
 const value=validateOpen(record),acceptedFile=filename(root,value.releaseSha,'accepted-held',owner),accepted=validateAccepted(readExact(acceptedFile,{owner}));
 if(accepted.newMainSha!==value.newMainSha||accepted.operationId!==value.operationId||hash(accepted)!==value.acceptedRecordDigest)reject();
 const file=filename(root,value.releaseSha,'open',owner),replayed=createExact(file,value,owner);
 return Object.freeze({status:'PASS',kind:value.kind,file,recordDigest:hash(value),replayed});
}
export function inspectFinalReleaseRecord({releaseSha,root=FINAL_RELEASE_RECORD_ROOT,owner=0}){
 if(!sha(releaseSha))reject();let accepted=null,open=null;
 try{accepted=validateAccepted(readExact(filename(root,releaseSha,'accepted-held',owner),{owner}));}catch(error){if(error.code!=='ENOENT')throw error;}
 try{open=validateOpen(readExact(filename(root,releaseSha,'open',owner),{owner}));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(open&&(!accepted||open.newMainSha!==accepted.newMainSha||open.operationId!==accepted.operationId||open.acceptedRecordDigest!==hash(accepted)))reject();
 return Object.freeze({status:'PASS',phase:open?'OPEN':accepted?'ACCEPTED_HELD':'ABSENT',accepted:accepted?Object.freeze(accepted):null,open:open?Object.freeze(open):null});
}
