import fs from 'node:fs';
import path from 'node:path';
import {verifyReleaseEvidence} from '../shared/release-evidence.js';
const fields=['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'];
const identity=stat=>fields.map(key=>stat[key]);

// Run in the root publisher's bounded verifier child. Reuse the canonical tree
// digest and independently require a completed, root-controlled release. No
// module or script from the inspected artifact is executed by this verifier.
export function verifyBuyerWriterArtifact({artifactRoot,releaseSha,environment,uid=process.getuid(),io=fs,verifyEvidence=verifyReleaseEvidence}){
  try{
    const started=performance.now();
    if(uid!==0||typeof artifactRoot!=='string'||artifactRoot.length>4096||!/^\/[A-Za-z0-9_./-]+$/.test(artifactRoot)
      ||path.resolve(artifactRoot)!==artifactRoot||!/^[a-f0-9]{40}$/.test(releaseSha??'')
      ||path.basename(artifactRoot)!==releaseSha||path.basename(path.dirname(artifactRoot))!=='releases'
      ||!['production','staging','disposable-staging'].includes(environment))throw new Error();
    const snapshot=()=>{
      let count=0,bytes=0,current='/';const entries=[];
      const directory=name=>{const s=io.lstatSync(name);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o7022)!==0)throw new Error();return s;};
      for(const name of ['/',...artifactRoot.split('/').slice(1).map(part=>{current=path.join(current,part);return current;})])entries.push([name,identity(directory(name))]);
      const walk=(name,depth)=>{
        if(depth>32||performance.now()-started>8000)throw new Error();
        for(const entry of io.readdirSync(name).sort()){
          if(++count>20000||entry==='.git'||entry==='.'||entry==='..'||entry.includes('/'))throw new Error();
          const absolute=path.join(name,entry);if(absolute.length>4096)throw new Error();
          const s=io.lstatSync(absolute);
          if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o7022)!==0||(!s.isFile()&&!s.isDirectory()))throw new Error();
          entries.push([absolute,identity(s)]);
          if(s.isDirectory())walk(absolute,depth+1);
          else{
            if(s.nlink!==1||!Number.isSafeInteger(s.size)||s.size<0||s.size>33554432)throw new Error();
            bytes+=s.size;if(bytes>268435456)throw new Error();
          }
        }
      };
      walk(artifactRoot,0);return JSON.stringify(entries);
    };
    const before=snapshot();
    const read=(name,limit)=>{
      const filename=path.join(artifactRoot,name);let fd;
      try{
        fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
        const stat=io.fstatSync(fd);
        if(!stat.isFile()||stat.nlink!==1||stat.size>limit)throw new Error();
        const buffer=Buffer.alloc(limit+1);let used=0;
        while(used<buffer.length){const n=io.readSync(fd,buffer,used,buffer.length-used,null);if(!n)break;used+=n;}
        if(used>limit||used!==stat.size||JSON.stringify(identity(stat))!==JSON.stringify(identity(io.fstatSync(fd))))throw new Error();
        return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used));
      }finally{if(fd!==undefined)io.closeSync(fd);}
    };
    if(!io.lstatSync(path.join(artifactRoot,'.release-complete')).isFile()||read('COMMIT_SHA',128).trim()!==releaseSha)throw new Error();
    const record=JSON.parse(read('.deployment-record.json',4096));
    if(!record||record.schema!=='blackspire-deployment-record'||record.version!==1
      ||typeof record.recordedAt!=='string'||new Date(record.recordedAt).toISOString()!==record.recordedAt)throw new Error();
    const result=verifyEvidence({artifactRoot,packagedCommitSha:releaseSha,expectedCommitSha:releaseSha,expectedEnvironment:environment,deploymentRecord:record});
    if(result?.state!=='VERIFIED'||!/^[a-f0-9]{64}$/.test(result.actualDigest??'')||snapshot()!==before||performance.now()-started>8000)throw new Error();
    return Object.freeze({releaseSha,environment,artifactDigest:result.actualDigest});
  }catch{throw new Error('Buyer writer artifact verification rejected');}
}
