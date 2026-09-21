import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {verifyReleaseSource,readReleaseProtectedBytes} from './commander-host.js';
import {OWNED_BUYER_CONFIGURATION as C} from './owned-buyer-configuration.js';
const fail=()=>{throw new Error('Owned Buyer protected configuration host refused');};
const options={encoding:'utf8',timeout:5000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}};
const run=(cmd,args)=>execFileSync(cmd,args,options).trim();
const statSame=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','ctimeMs','mtimeMs'].every(k=>a[k]===b[k]);
const sync=p=>{const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
function acl(p){if(run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',p])!=='')fail();}
function ancestors(p){for(let d=path.dirname(p);;d=path.dirname(d)){const s=fs.lstatSync(d);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail();acl(d);if(d==='/')break;}}
export function readOwnedConfigurationBytes(p,{gid=0,mode=0o600,maxBytes=65536}={}){
 ancestors(p);let fd;try{fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const a=fs.fstatSync(fd);if(!a.isFile()||a.uid!==0||a.gid!==gid||(a.mode&0o7777)!==mode||a.nlink!==1||a.size<1||a.size>maxBytes)fail();
  const r=spawnSync('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{...options,stdio:['ignore','pipe','pipe',fd]});if(r.status!==0||r.stdout!==''||r.stderr!=='')fail();
  const bytes=fs.readFileSync(fd);if(bytes.length!==a.size||!statSame(a,fs.fstatSync(fd))||!statSame(a,fs.lstatSync(p)))fail();return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }catch(e){if(e.code==='ENOENT')return null;throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function publishOwnedConfigurationBytes(p,before,after,{gid=0,mode=0o600}={}){
 const current=readOwnedConfigurationBytes(p,{gid,mode}),stage=p+'.owned-buyer-stage';
 if(current===after){if(fs.existsSync(stage))fail();sync(p);sync(path.dirname(p));return;}
 if(current!==before||typeof after!=='string'||!after||Buffer.byteLength(after)>65536)fail();ancestors(p);
 const pending=readOwnedConfigurationBytes(stage,{gid,mode});
 if(pending!==null){if(pending!==after)fail();sync(stage);}
 else{const fd=fs.openSync(stage,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.fchownSync(fd,0,gid);fs.fchmodSync(fd,mode);fs.writeFileSync(fd,after);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(readOwnedConfigurationBytes(stage,{gid,mode})!==after)fail();}
 if(readOwnedConfigurationBytes(p,{gid,mode})!==before)fail();fs.renameSync(stage,p);sync(path.dirname(p));if(readOwnedConfigurationBytes(p,{gid,mode})!==after)fail();
}
export function createOwnedBuyerConfigurationHost({releaseSha}){
 if(process.getuid?.()!==0||process.getgid?.()!==0)fail();
 const apiGid=Number(run('/usr/bin/getent',['group','blackspire-api']).split(':')[2]);if(!Number.isSafeInteger(apiGid)||apiGid<1)fail();
 ancestors(C.root);try{fs.mkdirSync(C.root,{mode:0o700});sync(path.dirname(C.root));}catch(e){if(e.code!=='EEXIST')throw e;}
 const st=fs.lstatSync(C.root);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o7777)!==0o700)fail();acl(C.root);
 const filename=name=>{if(typeof name!=='string'||!(/^[a-z0-9_.-]+\.json$/).test(name))fail();return C.root+'/'+name;};
 const api=()=>readOwnedConfigurationBytes(C.apiEnvironment,{gid:apiGid,mode:0o640});
 return{
  async assertStopped(){verifyReleaseSource(releaseSha);for(const unit of ['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service']){
    const found=run('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--property=SubState','--property=MainPID','--property=LoadState']).split('\n').sort().join('\n');
    if(found!=='ActiveState=inactive\nLoadState=loaded\nMainPID=0\nSubState=dead')fail();}
   const env=run('/usr/bin/systemctl',['show','blackspire-command.service','--property=EnvironmentFiles','--value']);const worker=run('/usr/bin/systemctl',['show','blackspire-command-worker.service','--property=EnvironmentFiles','--value']);if(!env.includes(C.apiEnvironment+' (ignore_errors=no)')||worker.includes('command-api.env'))fail();
   if(api()===null)fail();const probe=user=>spawnSync('/usr/sbin/runuser',['-u',user,'--','/usr/bin/test','-r',C.apiEnvironment],options).status;if(probe('blackspire-api')!==0||probe('blackspire-worker')!==1)fail();},
  read(name){const p=filename(name),a=readOwnedConfigurationBytes(p),b=readOwnedConfigurationBytes(p+'.owned-buyer-stage');if(a!==null&&b!==null)fail();return a===null&&b===null?null:JSON.parse(a??b);},
  publish(name,value){const p=filename(name),bytes=JSON.stringify(value)+'\n';publishOwnedConfigurationBytes(p,null,bytes);},
  consumer:()=>readReleaseProtectedBytes('/var/lib/blackspire-operator/authority-consumer-token',1024).trim(),
  token:()=>readReleaseProtectedBytes('/var/lib/blackspire-operator/vercel-token',16384).trim(),
  apiEnvironment:api,
  receiver(){const p=readReleaseProtectedBytes(C.receiver,4096);return JSON.parse(p);},
  deal(){const p=readOwnedConfigurationBytes(C.deal,{gid:apiGid,mode:0o640});return p===null?null:JSON.parse(p);},
  replaceApi(before,after){publishOwnedConfigurationBytes(C.apiEnvironment,before,after,{gid:apiGid,mode:0o640});},
  publishDeal(value){publishOwnedConfigurationBytes(C.deal,null,JSON.stringify(value)+'\n',{gid:apiGid,mode:0o640});},
  verifyIsolation(){for(const p of [C.apiEnvironment,C.deal]){const probe=user=>spawnSync('/usr/sbin/runuser',['-u',user,'--','/usr/bin/test','-r',p],options).status;if(probe('blackspire-api')!==0||probe('blackspire-worker')!==1)fail();}},
 };
}
