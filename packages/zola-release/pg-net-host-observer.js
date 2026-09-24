import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateBuyerWriterGatewayServiceConfiguration} from '../buyer-writer/gateway-entry.js';
import {decodeLocalGatewayJson} from '../buyer-writer/local-gateway-protocol.js';
import {DIRECT_DATABASE_ENV_KEYS,validateApplicationDatabaseIsolation} from '../shared/security.js';

export const BUYER_WRITER_GATEWAY_CONFIG='/etc/blackspire-buyer-writer-gateway/gateway.json';
const SOCKET='/run/blackspire/buyer-writer.sock',DIRECTORY='/run/blackspire';
const APPLICATION_UNITS=Object.freeze([
 Object.freeze({unit:'blackspire-command.service',user:'blackspire-api',group:'blackspire'}),
 Object.freeze({unit:'blackspire-command-worker.service',user:'blackspire-worker',group:'blackspire'}),
]);
const GATEWAY_UNIT='blackspire-buyer-writer-gateway.service';
const options=Object.freeze({encoding:'utf8',timeout:2000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
const hash=value=>createHash('sha256').update(value).digest('hex');

function identity(kind,name,run){
 const value=run('/usr/bin/getent',[kind,name],options).trim().split(':');
 if(value.length!==(kind==='group'?4:7)||value[0]!==name||!/^[1-9][0-9]{0,9}$/.test(value[2]))throw new Error();
 return Number(value[2]);
}
function show(unit,run){
 const output=run('/usr/bin/systemctl',['show','--no-pager','--property=ActiveState,SubState,MainPID,User,Group','--',unit],options);
 const rows=output.trim().split('\n').map(line=>{const at=line.indexOf('=');return at<1?[]:[line.slice(0,at),line.slice(at+1)];});
 if(rows.length!==5||rows.some(row=>row.length!==2)||new Set(rows.map(row=>row[0])).size!==5)throw new Error();
 return Object.fromEntries(rows);
}
function unitDefinition(unit,run){
 const text=run('/usr/bin/systemctl',['cat','--no-pager','--',unit],options);
 if(typeof text!=='string'||text.length<1||Buffer.byteLength(text)>1024*1024)throw new Error();
 return Object.freeze({text,state:show(unit,run)});
}
function processEnvironment(pid,io){
 if(!/^[1-9][0-9]*$/.test(pid))throw new Error();
 const bytes=io.readFileSync(`/proc/${pid}/environ`);if(bytes.length>1024*1024)throw new Error();
 const env={};for(const item of bytes.toString('utf8').split('\0').filter(Boolean)){
  const split=item.indexOf('=');if(split<1)throw new Error();const key=item.slice(0,split);
  if(Object.hasOwn(env,key))throw new Error();env[key]=item.slice(split+1);
 }return env;
}
function exactNode(io,name,{type,uid,gid,mode}){
 const stat=io.lstatSync(name);
 if(stat.isSymbolicLink()||stat.uid!==uid||stat.gid!==gid||(stat.mode&0o7777)!==mode
  ||(type==='socket'?!stat.isSocket():!stat.isDirectory()))throw new Error();
}
function readEnvironmentFile(filename,io=fs){
 let fd;try{
  if(typeof filename!=='string'||!path.isAbsolute(filename)||path.resolve(filename)!==filename||filename==='/'||filename.includes('\0'))throw new Error();
  for(let current=path.dirname(filename);current!=='/';current=path.dirname(current)){const stat=io.lstatSync(current);
   if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o002)!==0)throw new Error();}
  fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const before=io.fstatSync(fd);if(!before.isFile()||before.uid!==0||before.nlink!==1||(before.mode&0o007)!==0
   ||before.size<1||before.size>1024*1024)throw new Error();
  const bytes=Buffer.alloc(before.size+1);let used=0;
  while(used<bytes.length){const count=io.readSync(fd,bytes,used,bytes.length-used,null);if(count===0)break;used+=count;}
  const after=io.fstatSync(fd);if(used!==before.size||['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'].some(key=>before[key]!==after[key]))throw new Error();
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used));
 }finally{if(fd!==undefined)io.closeSync(fd);}
}
function configuredEnvironment(definition,{readEnv=readEnvironmentFile}={}){
 const env={};const put=key=>{env[key]='configured';};
 // Catch prohibited keys in every unit directive, including PassEnvironment,
 // SetCredential, inline launch arguments, and unfamiliar future directives.
 // The observer records presence only and never copies the surrounding value.
 for(const key of DIRECT_DATABASE_ENV_KEYS){
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`,'m').test(definition))put(key);
 }
 for(const raw of definition.split('\n')){
  const line=raw.trim();if(line===''||line.startsWith('#'))continue;
  const file=line.match(/^EnvironmentFile=-?(\/[^\s]+)$/);
  if(file){for(const rawEntry of readEnv(file[1]).split(/\r?\n/)){
    const entry=rawEntry.trim();if(entry===''||entry.startsWith('#'))continue;
    const match=entry.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/);if(!match)throw new Error();put(match[1]);
   }continue;}
  if(line.startsWith('Environment=')){const body=line.slice('Environment='.length);
   const matches=[...body.matchAll(/(?:^|\s|")([A-Za-z_][A-Za-z0-9_]*)=/g)];if(matches.length===0)throw new Error();
   for(const match of matches)put(match[1]);}
 }
 return env;
}
function defaultCanRead(user,filename){
 const result=spawnSync('/usr/sbin/runuser',['-u',user,'--','/usr/bin/test','-r',filename],{
  encoding:'utf8',timeout:1000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 if(result.error||result.signal!==null||result.stdout!==''||result.stderr!==''||![0,1].includes(result.status))throw new Error();return result.status===0;
}
function protocolDenies(key){try{decodeLocalGatewayJson(Buffer.from(JSON.stringify({[key]:'forbidden'})));return false;}catch{return true;}}
function blockedConfigured(){return Object.freeze({applicationDbCredentialsAbsent:false,apiConfiguredCredentialsAbsent:false,
 workerConfiguredCredentialsAbsent:false,apiGatewaySecretDenied:false,workerGatewaySecretDenied:false,
 gatewayCredentialReadable:false,configuredStateVerified:false});}

// This remains valid while an application unit is intentionally inactive. It inspects the loaded
// unit fragment plus drop-ins, every referenced environment file, and /proc for active processes.
// Evidence contains booleans only: environment keys and values never leave this boundary.
export function observeBuyerWriterConfiguredIsolation({releaseSha,gatewayConfigurationFile=BUYER_WRITER_GATEWAY_CONFIG},
 {io=fs,run=execFileSync,readSnapshot=readRootOwnedJsonSnapshot,readUnit=unit=>unitDefinition(unit,run),
  readEnv=filename=>readEnvironmentFile(filename,io),canRead=defaultCanRead}={}){
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||gatewayConfigurationFile!==BUYER_WRITER_GATEWAY_CONFIG)throw new Error();
  const writerGid=identity('group','blackspire-writer',run);
  const snapshot=readSnapshot(gatewayConfigurationFile,{groupId:writerGid,maxBytes:65536});
  const gateway=validateBuyerWriterGatewayServiceConfiguration(snapshot.value);
  if(gateway.authority.releaseSha!==releaseSha||gateway.workspace!=='blackspire-command'||!snapshot.identity
   ||snapshot.identity.uid!==0||snapshot.identity.gid!==writerGid||(snapshot.identity.mode&0o7777)!==0o640)throw new Error();
  const results=[];
  for(const expected of APPLICATION_UNITS){const observed=readUnit(expected.unit);
   if(!observed||typeof observed.text!=='string'||!observed.state||observed.state.User!==expected.user||observed.state.Group!==expected.group)throw new Error();
   const configured=configuredEnvironment(observed.text,{readEnv}),configuredAbsent=validateApplicationDatabaseIsolation(configured).ok;
   const active=observed.state.ActiveState==='active'&&observed.state.SubState==='running'&&observed.state.MainPID!=='0';
   const inactive=observed.state.ActiveState==='inactive'&&observed.state.MainPID==='0';if(!active&&!inactive)throw new Error();
   const runningAbsent=!active||validateApplicationDatabaseIsolation(processEnvironment(observed.state.MainPID,io)).ok;
   results.push(Object.freeze({configuredAbsent,runningAbsent}));
  }
  const apiGatewaySecretDenied=canRead('blackspire-api',gatewayConfigurationFile)===false;
  const workerGatewaySecretDenied=canRead('blackspire-worker',gatewayConfigurationFile)===false;
  const gatewayCredentialReadable=canRead('blackspire-writer',gatewayConfigurationFile)===true;
  const apiConfiguredCredentialsAbsent=results[0].configuredAbsent&&results[0].runningAbsent;
  const workerConfiguredCredentialsAbsent=results[1].configuredAbsent&&results[1].runningAbsent;
  const applicationDbCredentialsAbsent=apiConfiguredCredentialsAbsent&&workerConfiguredCredentialsAbsent;
  const configuredStateVerified=applicationDbCredentialsAbsent&&apiGatewaySecretDenied&&workerGatewaySecretDenied&&gatewayCredentialReadable;
  return Object.freeze({applicationDbCredentialsAbsent,apiConfiguredCredentialsAbsent,workerConfiguredCredentialsAbsent,
   apiGatewaySecretDenied,workerGatewaySecretDenied,gatewayCredentialReadable,configuredStateVerified});
 }catch{return blockedConfigured();}
}

function gatewayTransport({io,run,readUnit}){
 const writerUid=identity('passwd','blackspire-writer',run),apiGid=identity('group','blackspire-api',run);
 exactNode(io,DIRECTORY,{type:'directory',uid:writerUid,gid:apiGid,mode:0o750});exactNode(io,SOCKET,{type:'socket',uid:writerUid,gid:apiGid,mode:0o660});
 const service=readUnit(GATEWAY_UNIT);
 if(service.state.ActiveState!=='active'||service.state.SubState!=='running'||service.state.User!=='blackspire-writer'
  ||service.state.Group!=='blackspire-api'||service.state.MainPID==='0')throw new Error();
 const gatewayEnv=processEnvironment(service.state.MainPID,io);
 if(gatewayEnv.BLACKSPIRE_BUYER_WRITER_GATEWAY_CONFIG!==BUYER_WRITER_GATEWAY_CONFIG||Object.hasOwn(gatewayEnv,'BLACKSPIRE_BUYER_WRITER_CLIENT_CONFIG'))throw new Error();
 const listeners=run('/usr/bin/ss',['-H','-ltnp'],options);return listeners.split('\n').every(line=>!line.includes(`pid=${service.state.MainPID},`));
}
function normalized(configured,gatewayTransportVerified){return Object.freeze({applicationDbCredentialsAbsent:configured.configuredStateVerified===true,gatewayTransportVerified,
 arbitrarySqlDenied:protocolDenies('sql')&&protocolDenies('query'),arbitraryFunctionDenied:protocolDenies('function')&&protocolDenies('procedure')&&protocolDenies('rpc'),
 arbitraryUrlDenied:protocolDenies('url')&&protocolDenies('endpoint')&&protocolDenies('host')&&protocolDenies('port')});}
const blockedRuntime=()=>Object.freeze({applicationDbCredentialsAbsent:false,gatewayTransportVerified:false,arbitrarySqlDenied:false,
 arbitraryFunctionDenied:false,arbitraryUrlDenied:false});

// Gateway acceptance allows inactive applications; the configured-state proof remains mandatory.
export function observeBuyerWriterGatewayAcceptanceIsolation(input,deps={}){
 try{const configured=observeBuyerWriterConfiguredIsolation(input,deps);if(!configured.configuredStateVerified)throw new Error();
  const readUnit=deps.readUnit??(unit=>unitDefinition(unit,deps.run??execFileSync));
  if(!gatewayTransport({io:deps.io??fs,run:deps.run??execFileSync,readUnit}))throw new Error();return normalized(configured,true);
 }catch{return blockedRuntime();}
}

// Final release remains strict: both application processes must be active with clean live envs.
export function observeBuyerWriterRuntimeIsolation(input,deps={}){
 try{const configured=observeBuyerWriterConfiguredIsolation(input,deps);if(!configured.configuredStateVerified)throw new Error();
  const io=deps.io??fs,run=deps.run??execFileSync,readUnit=deps.readUnit??(unit=>unitDefinition(unit,run));
  for(const expected of APPLICATION_UNITS){const observed=readUnit(expected.unit),state=observed.state;
   if(state.ActiveState!=='active'||state.SubState!=='running'||state.MainPID==='0'||state.User!==expected.user||state.Group!==expected.group
    ||!validateApplicationDatabaseIsolation(processEnvironment(state.MainPID,io)).ok)throw new Error();}
  if(!gatewayTransport({io,run,readUnit}))throw new Error();return normalized(configured,true);
 }catch{return blockedRuntime();}
}

export const configuredIsolationEvidenceDigest=evidence=>hash(JSON.stringify({applicationDbCredentialsAbsent:evidence.applicationDbCredentialsAbsent===true,
 apiConfiguredCredentialsAbsent:evidence.apiConfiguredCredentialsAbsent===true,workerConfiguredCredentialsAbsent:evidence.workerConfiguredCredentialsAbsent===true,
 apiGatewaySecretDenied:evidence.apiGatewaySecretDenied===true,workerGatewaySecretDenied:evidence.workerGatewaySecretDenied===true,
 gatewayCredentialReadable:evidence.gatewayCredentialReadable===true,configuredStateVerified:evidence.configuredStateVerified===true}));
