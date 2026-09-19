import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {BUYER_WRITER_DEFAULT_SOCKET} from './local-gateway-protocol.js';

const fail=()=>{throw new Error('Buyer writer gateway socket cleanup rejected');};
const lookupOptions=Object.freeze({encoding:'utf8',timeout:1000,maxBuffer:4096,
  stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const same=(left,right)=>['dev','ino','uid','gid','mode','nlink'].every(key=>left[key]===right[key]);
const sameNode=(left,right)=>left?.dev===right?.dev&&left?.ino===right?.ino;

export function resolveBuyerWriterSocketIdentity({lookup=execFileSync}={}){
  try{
    const passwd=lookup('/usr/bin/getent',['passwd','blackspire-writer'],lookupOptions).trim().split(':');
    const group=lookup('/usr/bin/getent',['group','blackspire-api'],lookupOptions).trim().split(':');
    if(passwd.length!==7||passwd[0]!=='blackspire-writer'||group.length!==4||group[0]!=='blackspire-api'
      ||!/^[1-9][0-9]{0,9}$/.test(passwd[2])||!/^[1-9][0-9]{0,9}$/.test(group[2]))fail();
    return Object.freeze({uid:Number(passwd[2]),gid:Number(group[2])});
  }catch{fail();}
}

function listenerPaths(socketPath,observed,io){
  const parent='/run/blackspire',paths=[socketPath];
  for(const name of io.readdirSync(parent)){
    if(!/^\.bw-[a-f0-9]{24}\.sock$/.test(name))continue;
    const candidate=`${parent}/${name}`;let stat;
    try{stat=io.lstatSync(candidate);}catch(error){if(error?.code==='ENOENT')continue;throw error;}
    if(stat.isSocket()&&!stat.isSymbolicLink()&&sameNode(observed,stat))paths.push(candidate);
  }
  return paths;
}

function pathIsActive(socketPaths,io){
  const table=io.readFileSync('/proc/net/unix','utf8');
  if(typeof table!=='string'||!table.startsWith('Num'))fail();
  const expected=new Set(socketPaths);
  return table.split('\n').slice(1).some(line=>{
    const fields=line.trim().split(/\s+/);
    return fields.length>=8&&expected.has(fields.slice(7).join(' '));
  });
}

export function cleanupBuyerWriterGatewaySocket({
  socketPath=BUYER_WRITER_DEFAULT_SOCKET,io=fs,getuid=process.getuid,
  identity=resolveBuyerWriterSocketIdentity(),
}={}){
  try{
    if(process.platform!=='linux'||getuid?.()!==0||socketPath!==BUYER_WRITER_DEFAULT_SOCKET
      ||!exact(identity,['uid','gid'])||!Number.isInteger(identity.uid)||identity.uid<1
      ||!Number.isInteger(identity.gid)||identity.gid<1)fail();
    const parent=io.lstatSync('/run/blackspire');
    if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==identity.uid
      ||parent.gid!==identity.gid||(parent.mode&0o7777)!==0o750)fail();
    let observed;
    try{observed=io.lstatSync(socketPath);}
    catch(error){
      if(error?.code==='ENOENT')return Object.freeze({status:'ABSENT'});
      throw error;
    }
    if(!observed.isSocket()||observed.isSymbolicLink()||observed.uid!==identity.uid
      ||observed.gid!==identity.gid||(observed.mode&0o7777)!==0o660)fail();
    if(pathIsActive(listenerPaths(socketPath,observed,io),io))fail();
    const confirmed=io.lstatSync(socketPath);
    if(!same(observed,confirmed)||!confirmed.isSocket()
      ||pathIsActive(listenerPaths(socketPath,confirmed,io),io))fail();
    io.unlinkSync(socketPath);
    try{io.lstatSync(socketPath);fail();}
    catch(error){if(error?.code!=='ENOENT')throw error;}
    return Object.freeze({status:'STALE_SOCKET_REMOVED'});
  }catch{fail();}
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(process.argv.length!==2)fail();
  const result=cleanupBuyerWriterGatewaySocket();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
