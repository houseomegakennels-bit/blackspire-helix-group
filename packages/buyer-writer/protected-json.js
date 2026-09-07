import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Explicit path only. Never discover or automatically load credentials. Errors
// omit parser/I/O causes because those may contain private paths or JSON bytes.
export function readRootOwnedJson(filename,options) {
  return readRootOwnedJsonSnapshot(filename,options).value;
}

export function readRootOwnedJsonSnapshot(filename,options={}) {
  return readSnapshot(filename,options,65536);
}

// Offline catalog manifests are larger than credentials. Keep the credential
// reader's existing ceiling unchanged; metadata has a separate fixed bound.
export function readRootOwnedMetadataSnapshot(filename,{groupId,io=fs,aclTool=spawnSync}={}) {
  return readSnapshot(filename,{groupId,io,aclTool,maxBytes:2*1024*1024},2*1024*1024);
}

function readSnapshot(filename,{io=fs,groupId,maxBytes=16384,aclTool=spawnSync}={},ceiling) {
  let fd;
  try {
    if(!Number.isInteger(groupId)||groupId<0||groupId>4294967294||typeof filename!=='string'||filename.length>4096||!path.isAbsolute(filename)
      ||path.resolve(filename)!==filename||filename==='/'||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>ceiling)throw new Error();
    let current='/';
    const ancestors=['/',...filename.split('/').slice(1,-1).map(part=>{current=path.join(current,part);return current;})];
    for(const ancestor of ancestors){
      const stat=io.lstatSync(ancestor);
      if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw new Error();
    }
    fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const before=io.fstatSync(fd),mode=before.mode&0o7777;
    if(!before.isFile()||before.uid!==0||before.nlink!==1||![0o600,0o640].includes(mode)
      ||(mode===0o640&&before.gid!==groupId)||!Number.isSafeInteger(before.size)||before.size<1||before.size>maxBytes)throw new Error();
    // A named-user POSIX ACL can grant the worker read access even with 0640
    // and a private owning group. Inspect the same open inode via child fd 3.
    const acl=aclTool('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{
      stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:250,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin'},
    });
    if(acl.status!==0||acl.error||acl.stdout!==''||acl.stderr!=='')throw new Error();
    const bytes=Buffer.alloc(maxBytes+1);let used=0;
    while(used<bytes.length){const count=io.readSync(fd,bytes,used,bytes.length-used,null);if(count===0)break;used+=count;}
    if(used!==before.size||used>maxBytes)throw new Error();
    const after=io.fstatSync(fd);
    for(const key of ['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'])if(before[key]!==after[key])throw new Error();
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used)));
    if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();
    return Object.freeze({value:result,identity:Object.freeze(Object.fromEntries(['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'].map(key=>[key,after[key]])))});
  }catch{throw new Error('Buyer writer protected configuration unavailable');}
  finally{if(fd!==undefined){try{io.closeSync(fd);}catch{throw new Error('Buyer writer protected configuration unavailable');}}}
}
