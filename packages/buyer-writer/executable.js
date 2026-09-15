import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Reviewed supervisor exits when its only child exits and never respawns within
// an invocation. Current release and mandated recovery SHA have identical bytes.
export const SUPERVISOR_CONTRACT_SHA256='e54b67db51e6dbc0dc744029d76e835758aa5bc6969393e1e02f0a54dd3c02b9';
const NODE='/opt/nodejs/node-v22.23.1-linux-x64/bin/node';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=()=>new Error('Buyer writer executable identity rejected');
const injectionControls=new Set(['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH','LD_AUDIT',
  'OPENSSL_CONF','OPENSSL_CONF_INCLUDE','OPENSSL_MODULES','OPENSSL_ENGINES','NODE_EXTRA_CA_CERTS','SSLKEYLOGFILE']);

// Environment bytes remain process-local and never enter the returned evidence.
// This is a necessary startup check, not proof against an already compromised
// process rewriting its own environment. Root-controlled startup and immutable
// release verification remain required by the activation composition.
function validateEnvironment(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>131072||bytes.at(-1)!==0)throw failure();
  const names=new Set();
  for(const entry of new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,-1)).split('\0')){
    const split=entry.indexOf('='),key=entry.slice(0,split),value=entry.slice(split+1);
    if(split<1||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||names.has(key))throw failure();
    names.add(key);
    if((injectionControls.has(key)&&value!=='')||(key==='NODE_TLS_REJECT_UNAUTHORIZED'&&!['','1'].includes(value)))throw failure();
  }
}

function readBounded(filename,limit){
  let fd;
  try {
    fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const bytes=Buffer.alloc(limit+1);let used=0;
    while(used<bytes.length){const count=fs.readSync(fd,bytes,used,bytes.length-used,null);if(!count)break;used+=count;}
    if(used>limit)throw failure();return bytes.subarray(0,used);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}

function inspectRootFile(filename,hash){
  let current='/',fd;
  try {
    for(const ancestor of ['/',...filename.split('/').slice(1,-1).map(part=>{current=path.join(current,part);return current;})]){
      const stat=fs.lstatSync(ancestor);
      if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw failure();
    }
    fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.uid!==0||before.nlink!==1||(before.mode&0o7022)!==0||!Number.isSafeInteger(before.size)||before.size<1
      ||(hash&&before.size>1048576))throw failure();
    let sha256=null;
    if(hash){
      const bytes=Buffer.alloc(before.size+1);let used=0;
      while(used<bytes.length){const count=fs.readSync(fd,bytes,used,bytes.length-used,null);if(!count)break;used+=count;}
      if(used!==before.size)throw failure();sha256=digest(bytes.subarray(0,used));
    }
    const after=fs.fstatSync(fd);
    for(const key of ['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'])if(before[key]!==after[key])throw failure();
    return{dev:after.dev,ino:after.ino,sha256};
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}

export function captureBuyerWriterExecutable({pid,role,kind,artifactRoot,uid=process.getuid(),readLink=fs.readlinkSync,
  readCommand=pid=>readBounded(`/proc/${pid}/cmdline`,16384),readEnvironment=pid=>readBounded(`/proc/${pid}/environ`,131072),inspectFile=inspectRootFile}) {
  try {
    const started=performance.now();
    if(uid!==0||!Number.isInteger(pid)||pid<=0||pid>4294967294||!['api','worker'].includes(role)||!['supervisor','child'].includes(kind)
      ||typeof artifactRoot!=='string'||artifactRoot.length>4096||!/^\/[A-Za-z0-9_./-]+$/.test(artifactRoot)||path.resolve(artifactRoot)!==artifactRoot
      ||[readLink,readCommand,readEnvironment,inspectFile].some(value=>typeof value!=='function'))throw failure();
    const environment=readEnvironment(pid);validateEnvironment(environment);
    const script=kind==='supervisor'?'scripts/production-supervisor.js':role==='api'?'apps/api/server.js':'apps/worker/worker.js';
    const command=readCommand(pid);
    if(!Buffer.isBuffer(command)||command.length>16384||command.at(-1)!==0)throw failure();
    const args=new TextDecoder('utf-8',{fatal:true}).decode(command.subarray(0,-1)).split('\0');
    if(args.length!==(kind==='supervisor'?3:2)||args[0]!==NODE||![script,path.join(artifactRoot,script)].includes(args[1])
      ||(kind==='supervisor'&&args[2]!==`--${role}-only`))throw failure();
    const links=()=>({exe:readLink(`/proc/${pid}/exe`),cwd:readLink(`/proc/${pid}/cwd`)});
    const before=links();if(before.exe!==NODE||before.cwd!==artifactRoot)throw failure();
    const node=inspectFile(NODE,false),source=inspectFile(path.join(artifactRoot,script),true);
    if(!/^[a-f0-9]{64}$/.test(source.sha256??'')||(kind==='supervisor'&&source.sha256!==SUPERVISOR_CONTRACT_SHA256))throw failure();
    const after=links(),lastCommand=readCommand(pid),lastNode=inspectFile(NODE,false),lastSource=inspectFile(path.join(artifactRoot,script),true);
    const lastEnvironment=readEnvironment(pid);validateEnvironment(lastEnvironment);
    if(!environment.equals(lastEnvironment)||JSON.stringify(before)!==JSON.stringify(after)||!Buffer.isBuffer(lastCommand)||!command.equals(lastCommand)
      ||JSON.stringify(node)!==JSON.stringify(lastNode)||JSON.stringify(source)!==JSON.stringify(lastSource)||performance.now()-started>1000)throw failure();
    return Object.freeze({scriptSha256:source.sha256,nodeDevice:node.dev,nodeInode:node.ino});
  }catch{throw failure();}
}
