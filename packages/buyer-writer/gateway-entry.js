import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createBuyerWriterGatewayPostgres} from './local-gateway-postgres.js';
import {createBuyerWriterLocalGateway} from './local-gateway-server.js';
import {BUYER_WRITER_DEFAULT_SOCKET} from './local-gateway-protocol.js';
import {validateBuyerWriterGatewayAuthority} from './configuration.js';

const fail=()=>{throw new Error('Buyer writer gateway startup rejected');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const lookupOptions=Object.freeze({encoding:'utf8',timeout:1000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});

export function resolveBuyerWriterGatewayIdentity({userInfo=os.userInfo,getuid=process.getuid,getgid=process.getgid,getgroups=process.getgroups,
  lookup=execFileSync}={}){
  try{
    const current=userInfo(),uid=getuid(),gid=getgid(),groups=[...new Set(getgroups())];
    const passwd=lookup('/usr/bin/getent',['passwd','blackspire-writer'],lookupOptions).trim().split(':');
    const privateGroup=lookup('/usr/bin/getent',['group','blackspire-writer'],lookupOptions).trim().split(':');
    const apiGroup=lookup('/usr/bin/getent',['group','blackspire-api'],lookupOptions).trim().split(':');
    const broadGroup=lookup('/usr/bin/getent',['group','blackspire'],lookupOptions).trim().split(':');
    if(current.username!=='blackspire-writer'||current.uid!==uid||uid===0||passwd.length!==7||passwd[0]!=='blackspire-writer'
      ||![passwd[2],passwd[3],privateGroup[2],apiGroup[2],broadGroup[2]].every(value=>/^[1-9][0-9]{0,9}$/.test(value))
      ||Number(passwd[2])!==uid||passwd[5]!=='/nonexistent'||passwd[6]!=='/usr/sbin/nologin'
      ||privateGroup.length!==4||privateGroup[0]!=='blackspire-writer'||Number(privateGroup[2])!==Number(passwd[3])
      ||apiGroup.length!==4||apiGroup[0]!=='blackspire-api'||Number(apiGroup[2])!==gid
      ||broadGroup.length!==4||broadGroup[0]!=='blackspire'||groups.includes(Number(broadGroup[2]))
      ||groups.length!==2||!groups.includes(gid)||!groups.includes(Number(privateGroup[2])))fail();
    return Object.freeze({verified:true,uid,primaryGid:gid,privateGid:Number(privateGroup[2])});
  }catch{fail();}
}

export function readBuyerWriterGatewayConfiguration(filename,{io=fs,identity}={}){
  let fd;
  try{
    if(identity?.verified!==true||filename!=='/etc/blackspire-buyer-writer-gateway/gateway.json'||!path.isAbsolute(filename)
      ||path.resolve(filename)!==filename)fail();
    const parent=path.dirname(filename);
    for(let current=parent;current!=='/';current=path.dirname(current)){const s=io.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)fail();}
    const parentStat=io.lstatSync(parent);if(parentStat.gid!==identity.privateGid||(parentStat.mode&0o7777)!==0o750)fail();
    fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const before=io.fstatSync(fd);
    if(!before.isFile()||before.uid!==0||before.gid!==identity.privateGid||before.nlink!==1||(before.mode&0o7777)!==0o640||before.size<2||before.size>65_536)fail();
    const bytes=Buffer.alloc(before.size);if(io.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();const after=io.fstatSync(fd);
    for(const key of ['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'])if(before[key]!==after[key])fail();
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{fail();}finally{if(fd!==undefined)io.closeSync(fd);}
}
export function validateBuyerWriterGatewayServiceConfiguration(value){
  if(!exact(value,['version','workspace','socketPath','gatewayCapability','authority','runtime','issuer'])||value.version!==2
    ||value.socketPath!==BUYER_WRITER_DEFAULT_SOCKET||typeof value.workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.workspace)
    ||!/^[A-Za-z0-9_-]{43}$/.test(value.gatewayCapability??''))fail();
  let authority;try{authority=validateBuyerWriterGatewayAuthority(value.authority,{workspace:value.workspace});}catch{fail();}
  return Object.freeze({...value,authority});
}

export async function startBuyerWriterGateway({configurationFile,read=readBuyerWriterGatewayConfiguration,createPostgres=createBuyerWriterGatewayPostgres,
  createGateway=createBuyerWriterLocalGateway,resolveIdentity=resolveBuyerWriterGatewayIdentity,
  log=record=>process.stdout.write(`${JSON.stringify(record)}\n`)}={}){
  let database,gateway;
  try{
    const identity=resolveIdentity(),config=validateBuyerWriterGatewayServiceConfiguration(read(configurationFile,{identity}));
    database=await createPostgres({runtime:config.runtime,issuer:config.issuer});
    gateway=createGateway({socketPath:config.socketPath,capability:config.gatewayCapability,authority:config.authority,
      gatewayIdentityVerified:identity.verified===true,runtimeQuery:database.runtimeQuery,issuerQuery:database.issuerQuery,log});
    await gateway.listen();
    const close=async()=>{await gateway.close();await database.close();};
    return Object.freeze({gateway,database,close});
  }catch{try{await gateway?.close();}catch{}try{await database?.close();}catch{}fail();}
}

if(import.meta.url===`file://${process.argv[1]}`){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--configuration')fail();
  const runtime=await startBuyerWriterGateway({configurationFile:args[1]});let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;runtime.close().then(()=>process.exit(0),()=>process.exit(1));};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
