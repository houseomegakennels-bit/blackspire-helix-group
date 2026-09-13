import fs from 'node:fs';
import path from 'node:path';
import {createBuyerWriterGatewayPostgres} from './local-gateway-postgres.js';
import {createBuyerWriterLocalGateway} from './local-gateway-server.js';
import {BUYER_WRITER_DEFAULT_SOCKET} from './local-gateway-protocol.js';

const fail=()=>{throw new Error('Buyer writer gateway startup rejected');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function readSecret(filename,io=fs,uid=process.getuid()){
  let fd;
  try{
    if(uid===0||!path.isAbsolute(filename)||path.resolve(filename)!==filename||filename==='/')fail();
    for(let current=path.dirname(filename);current!=='/';current=path.dirname(current)){const s=io.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)fail();}
    fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const before=io.fstatSync(fd);
    if(!before.isFile()||before.uid!==uid||before.nlink!==1||(before.mode&0o777)!==0o600||before.size<2||before.size>65_536)fail();
    const bytes=Buffer.alloc(before.size);if(io.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();const after=io.fstatSync(fd);
    for(const key of ['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'])if(before[key]!==after[key])fail();
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{fail();}finally{if(fd!==undefined)io.closeSync(fd);}
}
function validateConfig(value){
  if(!exact(value,['version','workspace','releaseSha','socketPath','gatewayCapability','runtime','issuer'])||value.version!==1
    ||value.socketPath!==BUYER_WRITER_DEFAULT_SOCKET||typeof value.workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.workspace)
    ||!/^[a-f0-9]{40}$/.test(value.releaseSha??'')||!/^[A-Za-z0-9_-]{43}$/.test(value.gatewayCapability??''))fail();
  return value;
}

export async function startBuyerWriterGateway({configurationFile,read=readSecret,createPostgres=createBuyerWriterGatewayPostgres,
  createGateway=createBuyerWriterLocalGateway,log=record=>process.stdout.write(`${JSON.stringify(record)}\n`)}={}){
  let database,gateway;
  try{
    const config=validateConfig(read(configurationFile));database=await createPostgres({runtime:config.runtime,issuer:config.issuer});
    gateway=createGateway({socketPath:config.socketPath,capability:config.gatewayCapability,workspace:config.workspace,releaseSha:config.releaseSha,
      runtimeQuery:database.runtimeQuery,issuerQuery:database.issuerQuery,log});
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
