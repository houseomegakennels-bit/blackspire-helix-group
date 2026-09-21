#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {verifyReleaseSource,readReleaseProtectedBytes} from '../packages/zola-release/commander-host.js';
import {readRootOwnedJsonSnapshot} from '../packages/buyer-writer/protected-json.js';
import {prepareApiEnvironment,API_ENVIRONMENT_FILE,API_ENVIRONMENT_STATE,API_PASSWORD_FILE,API_CONSUMER_TOKEN_FILE} from '../packages/zola-release/api-environment-preparation.js';
const fail=()=>{throw new Error('API environment host rejected');};
const options={encoding:'utf8',timeout:5000,maxBuffer:16384,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','pipe','pipe']};
const run=(command,args)=>execFileSync(command,args,options).trim();
const acl=file=>{if(run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',file])!=='')fail();};
function ancestors(file){for(let p=path.dirname(file);;p=path.dirname(p)){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail();acl(p);if(p==='/')break;}}
function syncDirectory(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function publishAbsent(file,bytes,gid,mode){
 ancestors(file);const temp=path.join(path.dirname(file),'.api-preparation-'+randomUUID());let fd;
 try{fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  fs.writeFileSync(fd,bytes);fs.fchownSync(fd,0,gid);fs.fchmodSync(fd,mode);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.linkSync(temp,file);fs.unlinkSync(temp);syncDirectory(path.dirname(file));
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
let lock;
try{
 if(process.getuid?.()!==0||process.geteuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4||process.argv[2]!=='--prepare')fail();
 const releaseSha=process.argv[3];verifyReleaseSource(releaseSha);
 const apiUid=Number(run('/usr/bin/id',['-u','blackspire-api']));
 const sharedGid=Number(run('/usr/bin/getent',['group','blackspire']).split(':')[2]);
 const apiGid=Number(run('/usr/bin/getent',['group','blackspire-api']).split(':')[2]);
 if([apiUid,apiGid,sharedGid].some(value=>!Number.isSafeInteger(value)||value<1)||apiGid===sharedGid)fail();
 const directory=path.dirname(API_ENVIRONMENT_STATE);ancestors(directory);
 try{fs.mkdirSync(directory,{mode:0o700});syncDirectory(path.dirname(directory));}catch(error){if(error.code!=='EEXIST')throw error;}
 const dir=fs.lstatSync(directory);if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==0||dir.gid!==0||(dir.mode&0o7777)!==0o700)fail();acl(directory);
 const lockFile=directory+'/lock';lock=fs.openSync(lockFile,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
 const st=fs.fstatSync(lock);if(!st.isFile()||st.uid!==0||st.gid!==0||st.nlink!==1||(st.mode&0o7777)!==0o600)fail();acl(lockFile);
 execFileSync('/usr/bin/flock',['--exclusive','--nonblock','3'],{...options,stdio:['ignore','pipe','pipe',lock]});
 const readEnvironment=()=>{
  ancestors(API_ENVIRONMENT_FILE);let fd;
  try{
   fd=fs.openSync(API_ENVIRONMENT_FILE,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   const before=fs.fstatSync(fd);
   if(!before.isFile()||before.uid!==0||before.gid!==apiGid||(before.mode&0o7777)!==0o640||before.nlink!==1||before.size<1||before.size>16384)fail();
   const check=spawnSync('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{...options,stdio:['ignore','pipe','pipe',fd]});
   if(check.status!==0||check.stdout!==''||check.stderr!=='')fail();
   const bytes=fs.readFileSync(fd,'utf8'),after=fs.fstatSync(fd),named=fs.lstatSync(API_ENVIRONMENT_FILE);
   if(['dev','ino','uid','gid','mode','nlink','size','ctimeMs','mtimeMs'].some(k=>before[k]!==after[k]||after[k]!==named[k]))fail();return bytes;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}
 };
 const readSource=()=>({password:readReleaseProtectedBytes(API_PASSWORD_FILE,1024).replace(/\n$/,''),consumerToken:readReleaseProtectedBytes(API_CONSUMER_TOKEN_FILE,1024).replace(/\n$/,'')});
 const host={
  assertStopped(){
   verifyReleaseSource(releaseSha);
   for(const unit of ['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service']){
    const rows=run('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--property=SubState','--property=MainPID']).split('\n').sort().join('\n');
    if(rows!=='ActiveState=inactive\nMainPID=0\nSubState=dead')fail();
   }
   const api=run('/usr/bin/systemctl',['show','blackspire-command.service','--property=EnvironmentFiles','--value']);
   const worker=run('/usr/bin/systemctl',['show','blackspire-command-worker.service','--property=EnvironmentFiles','--value']);
   if(!api.includes(API_ENVIRONMENT_FILE+' (ignore_errors=no)')||worker.includes('command-api.env'))fail();
   const shared='/etc/blackspire/command.env';ancestors(shared);const sharedStat=fs.lstatSync(shared);
   if(!sharedStat.isFile()||sharedStat.isSymbolicLink()||sharedStat.uid!==0||sharedStat.gid!==sharedGid||(sharedStat.mode&0o7777)!==0o640||sharedStat.nlink!==1)fail();acl(shared);
   if(/^(?:COMMAND_ADMIN_PASSWORD_HASH|SESSION_SECRET|COMMAND_ADMIN_TOKEN|BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN)=/m.test(fs.readFileSync(shared,'utf8')))fail();
   const database='/opt/blackspire-command/shared/database/command.sqlite',identity=fs.lstatSync(database);
   if(!identity.isFile()||identity.isSymbolicLink()||identity.uid!==apiUid||identity.gid!==sharedGid||(identity.mode&0o7777)!==0o660||identity.nlink!==1)fail();acl(database);
   for(let p=path.dirname(database);;p=path.dirname(p)){
    const info=fs.lstatSync(p);if(!info.isDirectory()||info.isSymbolicLink()||![0,apiUid].includes(info.uid)||(info.mode&0o002)||(info.mode&0o020)&&info.gid!==sharedGid)fail();acl(p);if(p==='/')break;
   }
   const db=new DatabaseSync(database,{readOnly:true});
   try{
    if(!fs.readdirSync('/proc/self/fd').some(name=>{try{const fd=fs.statSync('/proc/self/fd/'+name);return fd.dev===identity.dev&&fd.ino===identity.ino;}catch{return false;}}))fail();
    if(db.prepare('SELECT count(*) AS count FROM sessions').get().count!==0)fail();
    const after=fs.lstatSync(database);if(after.dev!==identity.dev||after.ino!==identity.ino)fail();
   }finally{db.close();}
  },
  readSource,assertSource(source){if(JSON.stringify(readSource())!==JSON.stringify(source))fail();},
  readPlan(){try{const state=readRootOwnedJsonSnapshot(API_ENVIRONMENT_STATE,{groupId:0,maxBytes:16384});if(state.identity.gid!==0||(state.identity.mode&0o7777)!==0o600)fail();return state.value;}catch(error){if(!fs.existsSync(API_ENVIRONMENT_STATE))return null;throw error;}},
  retainPlan(plan){publishAbsent(API_ENVIRONMENT_STATE,JSON.stringify(plan)+'\n',0,0o600);},readEnvironment,
  publishAbsent(bytes){publishAbsent(API_ENVIRONMENT_FILE,bytes,apiGid,0o640);},
  verifyIsolation(){
   const probe=user=>spawnSync('/usr/sbin/runuser',['-u',user,'--','/usr/bin/test','-r',API_ENVIRONMENT_FILE],options).status;
   if(probe('blackspire-api')!==0||probe('blackspire-worker')!==1)fail();
  },
 };
 process.stdout.write(JSON.stringify(await prepareApiEnvironment({releaseSha},{host}))+'\n');
}catch{process.stderr.write('API environment preparation refused; retain protected state and reconcile.\n');process.exitCode=1;}
finally{if(lock!==undefined)fs.closeSync(lock);}
