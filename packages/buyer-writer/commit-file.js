import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {createBuyerWriterCommitRecord,matchesBuyerWriterCommitRecord} from './commit-record.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// A .pending file here is protected deployment state, NOT disposable temporary
// data. After an uncertain link/unlink, removing it could activate a two-link
// marker. Preserve both names for explicit reconciliation with fresh proof.
export async function commitBuyerWriterBinding({filename,credentialGroupId,expectedBinding,beforeCommit=()=>{},uid=process.getuid(),io=fs,readSnapshot=readRootOwnedJsonSnapshot}){
  const marker=typeof filename==='string'?`${filename}.commit.json`:null;
  let pending,identity,fd,directoryFd;
  const same=stat=>identity&&stat.dev===identity.dev&&stat.ino===identity.ino;
  const unknown=()=>new Error('Buyer writer activation outcome unknown');
  try{
    if(typeof beforeCommit!=='function'||uid!==0||typeof filename!=='string'||marker.length>4096||!path.isAbsolute(filename)||path.resolve(filename)!==filename
      ||!Number.isInteger(credentialGroupId)||credentialGroupId<=0||credentialGroupId>4294967294
      ||expectedBinding?.path!==filename||!/^[a-f0-9]{64}$/.test(expectedBinding.sha256??''))throw new Error();
    const options={groupId:credentialGroupId,maxBytes:4096};
    const binding=readSnapshot(filename,options);
    if(binding.identity.dev!==expectedBinding.identity?.dev||binding.identity.ino!==expectedBinding.identity?.ino
      ||hash(Buffer.from(JSON.stringify(binding.value)+'\n'))!==expectedBinding.sha256)throw new Error();
    const fingerprint=JSON.stringify(binding),record=createBuyerWriterCommitRecord(binding),bytes=Buffer.from(JSON.stringify(record)+'\n');
    try{io.lstatSync(marker);throw new Error();}catch(error){if(error.code!=='ENOENT')throw error;}
    pending=path.join(path.dirname(filename),`.buyer-commit-${randomUUID()}.pending`);
    fd=io.openSync(pending,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    identity=io.fstatSync(fd);io.fchownSync(fd,0,credentialGroupId);io.fchmodSync(fd,0o640);
    io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
    const candidate=readSnapshot(pending,options);
    if(!same(candidate.identity)||!matchesBuyerWriterCommitRecord(candidate.value,binding))throw new Error();
    if(beforeCommit()!==undefined||JSON.stringify(readSnapshot(filename,options))!==fingerprint)throw new Error();
    io.linkSync(pending,marker);
    // Before this unlink, nlink=2 and the API rejects the marker. After it,
    // commitment is complete. No later failure is allowed to roll it back.
    io.unlinkSync(pending);pending=undefined;
    directoryFd=io.openSync(path.dirname(filename),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    io.fsyncSync(directoryFd);io.closeSync(directoryFd);directoryFd=undefined;
    return Object.freeze({path:marker,sha256:hash(bytes),bindingPath:filename,bindingSha256:expectedBinding.sha256});
  }catch{
    if(identity){
      try{if(same(io.lstatSync(marker)))throw unknown();}
      catch(error){if(error.message==='Buyer writer activation outcome unknown'||error.code!=='ENOENT')throw unknown();}
      if(pending){
        let stat;
        try{stat=io.lstatSync(pending);}catch(error){if(error.code!=='ENOENT')throw unknown();}
        if(stat){
          if(!same(stat)||stat.nlink!==1)throw unknown();
          try{io.unlinkSync(pending);}catch{throw new Error('Buyer writer commit cleanup incomplete');}
        }
      }
    }
    throw new Error('Buyer writer commit rejected');
  }finally{
    try{if(fd!==undefined)io.closeSync(fd);if(directoryFd!==undefined)io.closeSync(directoryFd);}
    catch{throw unknown();}
  }
}
