import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
// Artifact/process checks, parallel binding/readiness, final identities, and
// protected configuration snapshots. The CLI requires a 60-second root unit.
const VERIFICATION_TIMEOUT_MS=20000;

// Root-only publication primitive. The caller's verifier must observe actual
// prerequisites and identities, and is read-only. Production CLI composition
// must not expose a way to replace it with a caller-supplied approval boolean.
export async function publishBuyerWriterBinding({filename,credentialGroupId,value,verify,io=fs,readSnapshot=readRootOwnedJsonSnapshot,uid=process.getuid()}) {
  let temporary,identity,published=false,fd,directoryFd;
  const same=stat=>identity&&stat.dev===identity.dev&&stat.ino===identity.ino;
  const removeOwned=name=>{
    try {if(!same(io.lstatSync(name)))throw new Error();io.unlinkSync(name);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  };
  const synchronize=()=>{
    directoryFd=io.openSync(path.dirname(filename),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{io.fsyncSync(directoryFd);}finally{io.closeSync(directoryFd);directoryFd=undefined;}
  };
  try {
    if(uid!==0||typeof filename!=='string'||filename.length>4096||!path.isAbsolute(filename)||path.resolve(filename)!==filename||filename==='/'
      ||!Number.isInteger(credentialGroupId)||credentialGroupId<=0||credentialGroupId>4294967294||typeof verify!=='function')throw new Error();
    let current='/';
    for(const ancestor of ['/',...filename.split('/').slice(1,-1).map(part=>{current=path.join(current,part);return current;})]){
      const stat=io.lstatSync(ancestor);
      if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw new Error();
    }
    try{io.lstatSync(filename);throw new Error();}catch(error){if(error.code!=='ENOENT')throw error;}
    const serialized=JSON.stringify(value),bytes=Buffer.from(serialized+'\n');
    if(bytes.length>4096)throw new Error();
    const check=async target=>{
      const snapshot=readSnapshot(target,{groupId:credentialGroupId,maxBytes:4096});
      if(!same(snapshot.identity)||JSON.stringify(snapshot.value)!==serialized)throw new Error();
      let timer;const started=performance.now();
      try {
        const proof=await Promise.race([Promise.resolve().then(()=>verify(target)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),VERIFICATION_TIMEOUT_MS);})]);
        const keys=['approved','credentialsSeparated','workspace','releaseSha','apiGeneration','workerGeneration'];
        if(performance.now()-started>VERIFICATION_TIMEOUT_MS||!proof||Object.keys(proof).length!==keys.length||Object.keys(proof).some(key=>!keys.includes(key))
          ||proof.approved!==true||proof.credentialsSeparated!==true||['workspace','releaseSha','apiGeneration','workerGeneration'].some(key=>proof[key]!==value[key]))throw new Error();
      }finally{clearTimeout(timer);}
      const after=readSnapshot(target,{groupId:credentialGroupId,maxBytes:4096});
      if(!same(after.identity)||JSON.stringify(after.value)!==serialized)throw new Error();
    };
    temporary=path.join(path.dirname(filename),`.buyer-binding-${randomUUID()}.tmp`);
    fd=io.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    identity=io.fstatSync(fd);
    io.fchownSync(fd,0,credentialGroupId);io.fchmodSync(fd,0o640);
    io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
    await check(temporary);
    // link is an atomic no-replace publication. The brief two-link state fails
    // the reader's nlink===1 check until the temporary name is removed.
    io.linkSync(temporary,filename);published=true;
    removeOwned(temporary);temporary=undefined;synchronize();
    await check(filename);
    return Object.freeze({path:filename,sha256:createHash('sha256').update(bytes).digest('hex'),identity:Object.freeze({dev:identity.dev,ino:identity.ino})});
  }catch{
    let cleanupFailed=false;
    try{if(published)removeOwned(filename);}catch{cleanupFailed=true;}
    try{if(temporary&&identity)removeOwned(temporary);}catch{cleanupFailed=true;}
    try{if(published)synchronize();}catch{cleanupFailed=true;}
    throw new Error(cleanupFailed?'Buyer writer binding publication cleanup incomplete':'Buyer writer binding publication rejected');
  }finally{
    let failed=false;
    try{if(fd!==undefined)io.closeSync(fd);}catch{failed=true;}
    try{if(directoryFd!==undefined)io.closeSync(directoryFd);}catch{failed=true;}
    if(failed)throw new Error('Buyer writer binding publication cleanup incomplete');
  }
}
