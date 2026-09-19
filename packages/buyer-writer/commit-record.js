import {createHash} from 'node:crypto';
const keys=['version','workspace','releaseSha','apiGeneration','workerGeneration','bindingDevice','bindingInode','bindingDigest','committedAt'];
function fields(snapshot){
  const value=snapshot?.value,identity=snapshot?.identity;
  if(!value||value.version!==1||typeof value.workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.workspace)
    ||!/^[a-f0-9]{40}$/.test(value.releaseSha??'')||[value.apiGeneration,value.workerGeneration].some(v=>!/^[a-f0-9]{32}$/.test(v??''))
    ||!Number.isSafeInteger(identity?.dev)||identity.dev<0||!Number.isSafeInteger(identity?.ino)||identity.ino<1)throw new Error();
  const content=JSON.stringify(value);if(Buffer.byteLength(content)>4096)throw new Error();
  return{version:1,workspace:value.workspace,releaseSha:value.releaseSha,apiGeneration:value.apiGeneration,workerGeneration:value.workerGeneration,
    bindingDevice:identity.dev,bindingInode:identity.ino,bindingDigest:createHash('sha256').update(content).digest('hex')};
}

// The digest covers the exact parsed JSON serialization, including the worker
// attestation; the protected reader independently enforces file identity/mode.
export function createBuyerWriterCommitRecord(snapshot){
  try{return Object.freeze({...fields(snapshot),committedAt:new Date().toISOString()});}
  catch{throw new Error('Buyer writer commit record rejected');}
}
export function matchesBuyerWriterCommitRecord(record,snapshot){
  try{
    if(!record||Array.isArray(record)||Object.keys(record).length!==keys.length||Object.keys(record).some(key=>!keys.includes(key))
      ||typeof record.committedAt!=='string'||new Date(record.committedAt).toISOString()!==record.committedAt||Date.parse(record.committedAt)>Date.now()+5000)return false;
    return Object.entries(fields(snapshot)).every(([key,value])=>record[key]===value);
  }catch{return false;}
}
