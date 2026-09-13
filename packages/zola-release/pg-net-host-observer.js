import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateBuyerWriterClientConfiguration,validateBuyerWriterGatewayProvisioningConfiguration} from '../buyer-writer/configuration.js';
import {decodeLocalGatewayJson} from '../buyer-writer/local-gateway-protocol.js';
import {validateApplicationDatabaseIsolation} from '../shared/security.js';

const SOCKET='/run/blackspire/buyer-writer.sock',DIRECTORY='/run/blackspire';
const UNITS=Object.freeze(['blackspire-command.service','blackspire-command-worker.service']);
const GATEWAY_UNIT='blackspire-buyer-writer-gateway.service';
const commandOptions=Object.freeze({encoding:'utf8',timeout:2000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
 env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
const hash=value=>createHash('sha256').update(value).digest('hex');

function identity(kind,name,run){
 const value=run('/usr/bin/getent',[kind,name],commandOptions).trim().split(':');
 const number=kind==='group'?value[2]:value[2];
 if(value.length!==(kind==='group'?4:7)||value[0]!==name||!/^[1-9][0-9]{0,9}$/.test(number))throw new Error();
 return Number(number);
}
function show(unit,run){
 const output=run('/usr/bin/systemctl',['show','--no-pager','--property=ActiveState,SubState,MainPID,User,Group','--',unit],commandOptions);
 const rows=output.trim().split('\n').map(line=>line.split('='));
 if(rows.length!==5||rows.some(row=>row.length!==2)||new Set(rows.map(row=>row[0])).size!==5)throw new Error();
 return Object.fromEntries(rows);
}
function processEnvironment(pid,io){
 if(!/^[1-9][0-9]*$/.test(pid))throw new Error();
 const bytes=io.readFileSync(`/proc/${pid}/environ`);
 if(bytes.length>1024*1024)throw new Error();
 const env={};
 for(const item of bytes.toString('utf8').split('\0').filter(Boolean)){
  const split=item.indexOf('=');if(split<1)throw new Error();const key=item.slice(0,split);
  if(Object.hasOwn(env,key))throw new Error();env[key]=item.slice(split+1);
 }
 return env;
}
function exactNode(io,name,{type,uid,gid,mode}){
 const stat=io.lstatSync(name);
 if(stat.isSymbolicLink()||stat.uid!==uid||stat.gid!==gid||(stat.mode&0o7777)!==mode
  ||(type==='socket'?!stat.isSocket():!stat.isDirectory()))throw new Error();
}
function readPrivateServiceJson(io,name,{uid,gid,maxBytes=65536}){
 let fd;
 try{
  for(const ancestor of ['/etc','/etc/blackspire']){const stat=io.lstatSync(ancestor);
   if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw new Error();}
  fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const before=io.fstatSync(fd);
  if(!before.isFile()||before.uid!==uid||before.gid!==gid||before.nlink!==1||(before.mode&0o7777)!==0o600
   ||before.size<1||before.size>maxBytes)throw new Error();
  const bytes=Buffer.alloc(before.size+1);let used=0;
  while(used<bytes.length){const count=io.readSync(fd,bytes,used,bytes.length-used,null);if(count===0)break;used+=count;}
  const after=io.fstatSync(fd);
  if(used!==before.size||['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'].some(key=>before[key]!==after[key]))throw new Error();
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used)));
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;
 }finally{if(fd!==undefined)io.closeSync(fd);}
}
function protocolDenies(key){
 try{decodeLocalGatewayJson(Buffer.from(JSON.stringify({[key]:'forbidden'})));return false;}catch{return true;}
}

// Fixed, read-only host observation. It never emits environment values,
// credentials, config contents, process arguments, or listener addresses.
export function observeBuyerWriterRuntimeIsolation({releaseSha,provisioningConfigurationFile},{io=fs,run=execFileSync,
 readSnapshot=readRootOwnedJsonSnapshot}={}){
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||typeof provisioningConfigurationFile!=='string')throw new Error();
  const apiGid=identity('group','blackspire-api',run),writerGid=identity('group','blackspire-writer',run),writerUid=identity('passwd','blackspire-writer',run);
  const provision=validateBuyerWriterGatewayProvisioningConfiguration(
   readSnapshot(provisioningConfigurationFile,{groupId:apiGid,maxBytes:65536}).value,{workspace:'blackspire-command'});
  const client={version:2,workspace:provision.workspace,socketPath:SOCKET,gatewayCapability:provision.gatewayCapability};
  const clientBytes=Buffer.from(JSON.stringify(client)+'\n');
  const clientPath=path.join('/etc/blackspire','buyer-writer-client-'+hash(clientBytes)+'.json');
  const gatewayValue={version:1,workspace:provision.workspace,releaseSha,socketPath:SOCKET,gatewayCapability:provision.gatewayCapability,
   runtime:provision.runtime,issuer:provision.issuer};
  const gatewayBytes=Buffer.from(JSON.stringify(gatewayValue)+'\n');
  const gatewayPath=path.join('/etc/blackspire','buyer-writer-gateway-'+hash(gatewayBytes)+'.json');
  const installed=readSnapshot(clientPath,{groupId:apiGid,maxBytes:65536});
  validateBuyerWriterClientConfiguration(installed.value,{workspace:'blackspire-command',environment:'production'});
  if(!installed.identity||installed.identity.uid!==0||installed.identity.gid!==apiGid||(installed.identity.mode&0o7777)!==0o640
   ||JSON.stringify(installed.value)!==JSON.stringify(client))throw new Error();
  if(JSON.stringify(readPrivateServiceJson(io,gatewayPath,{uid:writerUid,gid:writerGid}))!==JSON.stringify(gatewayValue))throw new Error();
  exactNode(io,DIRECTORY,{type:'directory',uid:writerUid,gid:apiGid,mode:0o750});
  exactNode(io,SOCKET,{type:'socket',uid:writerUid,gid:apiGid,mode:0o660});
  const environments=[];
  for(const [index,unit] of UNITS.entries()){
   const state=show(unit,run);
   if(state.ActiveState!=='active'||state.SubState!=='running'||state.MainPID==='0'
    ||state.User!==(index===0?'blackspire-api':'blackspire-worker')||state.Group!=='blackspire')throw new Error();
   const env=processEnvironment(state.MainPID,io);
   if(env.NODE_ENV!=='production'||env.BLACKSPIRE_RUNTIME_MODE!=='production'
    ||(index===0?env.BLACKSPIRE_BUYER_WRITER_CLIENT_CONFIG!==clientPath:Object.hasOwn(env,'BLACKSPIRE_BUYER_WRITER_CLIENT_CONFIG'))
    ||Object.hasOwn(env,'BLACKSPIRE_BUYER_WRITER_GATEWAY_CONFIG'))throw new Error();
   environments.push(env);
  }
  const service=show(GATEWAY_UNIT,run);
  if(service.ActiveState!=='active'||service.SubState!=='running'||service.User!=='blackspire-writer'||service.Group!=='blackspire-api'||service.MainPID==='0')throw new Error();
  const gatewayEnv=processEnvironment(service.MainPID,io);
  if(gatewayEnv.BLACKSPIRE_BUYER_WRITER_GATEWAY_CONFIG!==gatewayPath||Object.hasOwn(gatewayEnv,'BLACKSPIRE_BUYER_WRITER_CLIENT_CONFIG'))throw new Error();
  const listeners=run('/usr/bin/ss',['-H','-ltnp'],commandOptions);
  const tcpListeners=listeners.split('\n').filter(line=>line.includes(`pid=${service.MainPID},`)).length;
  const applicationDbCredentialsAbsent=environments.every(env=>validateApplicationDatabaseIsolation(env).ok);
  return Object.freeze({applicationDbCredentialsAbsent,gatewayTransportVerified:tcpListeners===0,
   arbitrarySqlDenied:protocolDenies('sql')&&protocolDenies('query'),
   arbitraryFunctionDenied:protocolDenies('function')&&protocolDenies('procedure')&&protocolDenies('rpc'),
   arbitraryUrlDenied:protocolDenies('url')&&protocolDenies('endpoint')&&protocolDenies('host')&&protocolDenies('port')});
 }catch{return Object.freeze({applicationDbCredentialsAbsent:false,gatewayTransportVerified:false,arbitrarySqlDenied:false,
  arbitraryFunctionDenied:false,arbitraryUrlDenied:false});}
}
