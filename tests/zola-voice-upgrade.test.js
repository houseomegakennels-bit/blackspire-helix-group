import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../scripts/upgrade-zola-voice.mjs',import.meta.url),'utf8').replace(/^#!.*\n/,'').replace(/^import .*;\n/gm,'');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function simulate({busy=false,badBoundary=false}={}){
 const predecessor='21262eab40ab8f3e82daccf15ff8cc8b92dcb498',sha='a'.repeat(40),unit='/etc/systemd/system/blackspire-voice.service',nginx='/etc/nginx/sites-enabled/command.conf',helper='/opt/blackspire-voice/configure-key.py';
 const oldRoot='/opt/blackspire-voice/releases/'+predecessor,root='/opt/blackspire-voice/releases/'+sha;
 const oldUnit='ExecStart=/opt/nodejs/node-v22.23.1-linux-x64/bin/node '+oldRoot+'/gateway.js';
 const config='    location ^~ /api/voice/ { proxy_pass http://127.0.0.1:8796; }';
 const files=new Map([[unit,oldUnit],[nginx,config],[helper,oldRoot+'/configure-key.py'],['/var/lib/blackspire-voice/voice.sqlite','private-db']]),handles=new Map(),commands=[];
 let serial=0,closed=false,newService=false;
 const f={constants:{COPYFILE_EXCL:1},lstatSync:()=>({isFile:()=>true,uid:0,mode:0o100644}),realpathSync:p=>p,readlinkSync:p=>files.get(p),readFileSync:(p,encoding)=>{const b=files.has(p)?files.get(p):'fixture-source';return encoding?b:Buffer.from(b);},openSync:(p)=>{if(files.has(p))throw Error('exists');files.set(p,'');handles.set(++serial,p);return serial;},writeFileSync:(fd,b)=>files.set(handles.get(fd),String(b)),fsyncSync(){},closeSync(){},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);},mkdirSync:p=>{if(files.has(p))throw Error('exists');files.set(p,'directory');},copyFileSync:(a,b)=>files.set(b,files.get(a)),chmodSync(){},existsSync:p=>files.has(p),symlinkSync:(a,b)=>files.set(b,a)};
 const exec=(command,args)=>{commands.push([command,...args].join(' '));if(command==='git')return args[0]==='status'?'':sha;if(args[0]==='is-active')return 'active';if(args[0]==='start')newService=files.get(unit).includes(root);return '';};
 class DB{prepare(sql){return {get:()=>sql.includes('count(*)')?{n:busy&&commands.some(x=>x.endsWith('reload nginx'))?1:0}:sql.includes('quick_check')?{quick_check:'ok'}:{busy:0}};}close(){}}
 const fetch=async url=>url.endsWith('/ready')?{ok:true,json:async()=>({ok:true,checks:{ok:true},deploymentIdentity:{build:{value:'backend'}}})}:{status:badBoundary&&newService?500:401};
 let error;
 try{await new AsyncFunction('fs','execFileSync','DatabaseSync','createHash','openReleaseJournal','process','fetch','setTimeout','console',source)(f,exec,DB,createHash,()=>({close(){closed=true;}}),{getuid:()=>0,argv:['node','operator','--apply']},fetch,fn=>fn(),{log(){}});}catch(e){error=e;}
 return {files,commands,closed,error,unit,nginx,helper,oldUnit,config,root,oldRoot};
}
test('voice successor upgrades immutable source, restores admission, and preserves backend configuration',async()=>{
 const r=await simulate();assert.equal(r.error,undefined);assert.ok(r.files.get(r.unit).includes(r.root));assert.equal(r.files.get(r.nginx),r.config);assert.equal(r.files.get(r.helper),r.root+'/configure-key.py');assert.ok([...r.files.keys()].some(x=>x.endsWith('/voice-before.sqlite')));assert.equal(r.closed,true);
});
test('an active voice reservation defers the upgrade before service stop',async()=>{
 const r=await simulate({busy:true});assert.match(r.error.message,/active/);assert.equal(r.files.get(r.unit),r.oldUnit);assert.equal(r.files.get(r.nginx),r.config);assert.equal(r.commands.some(x=>x.endsWith('stop blackspire-voice.service')),false);assert.equal(r.closed,true);
});
test('a failed successor authorization probe restores the old unit, helper and routing',async()=>{
 const r=await simulate({badBoundary:true});assert.match(r.error.message,/not deployed/);assert.equal(r.files.get(r.unit),r.oldUnit);assert.equal(r.files.get(r.nginx),r.config);assert.equal(r.files.get(r.helper),r.oldRoot+'/configure-key.py');assert.equal(r.closed,true);
});
