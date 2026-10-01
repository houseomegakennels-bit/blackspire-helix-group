#!/usr/bin/env node
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
const hash=b=>createHash('sha256').update(b).digest('hex');
const previousSha='21262eab40ab8f3e82daccf15ff8cc8b92dcb498';
const unitPath='/etc/systemd/system/blackspire-voice.service';
const helper='/opt/blackspire-voice/configure-key.py';
const dbPath='/var/lib/blackspire-voice/voice.sqlite';
function checkFile(file){const s=fs.lstatSync(file);if(!s.isFile()||s.uid!==0||(s.mode&0o022))throw Error('Unsafe operator file');return s;}
function write(file,bytes,mode=0o600){const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function replace(file,bytes,mode){const temp=file+'.everyday-pending';write(temp,bytes,mode);fs.renameSync(temp,file);}
function active(){const db=new DatabaseSync(dbPath,{readOnly:true});try{return db.prepare("SELECT count(*) n FROM voice_sessions WHERE status IN ('active','connecting','closing')").get().n;}finally{db.close();}}
async function boundary(){for(const route of ['status','personal','transcripts']){let ok=false;for(let i=0;i<10;i++){try{const r=await fetch('http://127.0.0.1:8796/api/voice/'+route+'?workspaceId=blackspire-command',{signal:AbortSignal.timeout(1500)});if(r.status===401){ok=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}if(!ok)throw Error('Gateway authorization boundary failed');}}
async function readiness(){const r=await fetch('http://127.0.0.1:8789/ready',{signal:AbortSignal.timeout(4000)});const b=await r.json();if(!r.ok||!b.ok||!Object.values(b.checks||{}).length||!Object.values(b.checks).every(v=>v===true)||!b.deploymentIdentity?.build?.value)throw Error('Backend not ready');return b.deploymentIdentity.build.value;}
if(process.getuid()!==0||process.argv[2]!=='--apply')throw Error('Root and --apply required');
if(run('git',['status','--porcelain']).trim())throw Error('Clean committed source required');
const sha=run('git',['rev-parse','HEAD']).trim();
if(!/^[a-f0-9]{40}$/.test(sha)||sha===previousSha)throw Error('Invalid successor');
const unitStat=checkFile(unitPath),oldUnit=fs.readFileSync(unitPath,'utf8');
const oldRoot='/opt/blackspire-voice/releases/'+previousSha;
const expected='ExecStart=/opt/nodejs/node-v22.23.1-linux-x64/bin/node '+oldRoot+'/gateway.js';
if(oldUnit.split(expected).length!==2||fs.readlinkSync(helper)!==oldRoot+'/configure-key.py')throw Error('Unexpected gateway predecessor');
if(run('/usr/bin/systemctl',['is-active','blackspire-voice.service']).trim()!=='active'||active()!==0)throw Error('Gateway not idle and active');
const config=fs.realpathSync('/etc/nginx/sites-enabled/command.conf'),configStat=checkFile(config),oldConfig=fs.readFileSync(config,'utf8');
const anchor='    location ^~ /api/voice/ {';
if(oldConfig.split(anchor).length!==2||oldConfig.includes('location = /api/voice/session'))throw Error('Unexpected voice routing');
const gatedConfig=oldConfig.replace(anchor,'    location = /api/voice/session { return 503; }\n'+anchor);
const root='/opt/blackspire-voice/releases/'+sha,record='/var/lib/blackspire-operator/zola-voice-'+sha;
const guard=openReleaseJournal();
let gated=false,stopped=false,switched=false,complete=false;
try{
 const backend=await readiness();await boundary();
 fs.mkdirSync(record,{mode:0o700});fs.mkdirSync(root,{mode:0o755});
 const inventory={};
 write(root+'/package.json',JSON.stringify({type:'module'}),0o644);
 for(const file of ['gateway.js','personal.js','configure-key.py','project-checkpoints.json']){const bytes=fs.readFileSync('apps/voice/'+file);write(root+'/'+file,bytes,0o644);inventory[file]=hash(bytes);}
 write(record+'/unit-before',oldUnit);write(record+'/nginx-before',oldConfig);
 write(record+'/intent.json',JSON.stringify({sha,previousSha,backend,inventory})+'\n');
 if(fs.readFileSync(config,'utf8')!==oldConfig||fs.readFileSync(unitPath,'utf8')!==oldUnit)throw Error('Concurrent configuration change');
 replace(config,gatedConfig,configStat.mode&0o777);gated=true;run('/usr/sbin/nginx',['-t']);run('/usr/bin/systemctl',['reload','nginx']);
 // Let already-admitted session requests drain before checking the durable reservations.
 await new Promise(r=>setTimeout(r,31000));
 if(active()!==0)throw Error('A voice call is active; upgrade deferred');
 stopped=true;run('/usr/bin/systemctl',['stop','blackspire-voice.service']);
 if(active()!==0)throw Error('Voice reservation remained after stop');
 const db=new DatabaseSync(dbPath);try{const result=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(result.busy)throw Error('Database checkpoint busy');if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Database integrity check failed');}finally{db.close();}
 fs.copyFileSync(dbPath,record+'/voice-before.sqlite',fs.constants.COPYFILE_EXCL);fs.chmodSync(record+'/voice-before.sqlite',0o600);
 const newUnit=oldUnit.replace(expected,'ExecStart=/opt/nodejs/node-v22.23.1-linux-x64/bin/node '+root+'/gateway.js');
 replace(unitPath,newUnit,unitStat.mode&0o777);switched=true;
 run('/usr/bin/systemd-analyze',['verify',unitPath]);run('/usr/bin/systemctl',['daemon-reload']);run('/usr/bin/systemctl',['start','blackspire-voice.service']);
 await boundary();if(await readiness()!==backend)throw Error('Backend identity changed');
 if(run('/usr/bin/systemctl',['is-active','blackspire-voice.service']).trim()!=='active')throw Error('Gateway inactive');
 fs.symlinkSync(root+'/configure-key.py',helper+'.everyday-pending');fs.renameSync(helper+'.everyday-pending',helper);
 if(fs.readFileSync(config,'utf8')!==gatedConfig)throw Error('Concurrent nginx change');
 replace(config,oldConfig,configStat.mode&0o777);run('/usr/sbin/nginx',['-t']);run('/usr/bin/systemctl',['reload','nginx']);gated=false;
 write(record+'/result.json',JSON.stringify({status:'DEPLOYED',sha,backend,at:new Date().toISOString()})+'\n');complete=true;
 console.log(JSON.stringify({status:'DEPLOYED',sha,backend,record}));
}catch(error){
 try{
  if(switched){run('/usr/bin/systemctl',['stop','blackspire-voice.service']);replace(unitPath,oldUnit,unitStat.mode&0o777);run('/usr/bin/systemctl',['daemon-reload']);}
  if(stopped){run('/usr/bin/systemctl',['start','blackspire-voice.service']);await boundary();}
  if(fs.readlinkSync(helper)!==oldRoot+'/configure-key.py'){fs.symlinkSync(oldRoot+'/configure-key.py',helper+'.rollback-pending');fs.renameSync(helper+'.rollback-pending',helper);}
  if(gated){if(fs.readFileSync(config,'utf8')!==gatedConfig)throw Error('Concurrent routing change requires reconciliation');replace(config,oldConfig,configStat.mode&0o777);run('/usr/sbin/nginx',['-t']);run('/usr/bin/systemctl',['reload','nginx']);}
  if(fs.existsSync(record))write(record+'/result.json',JSON.stringify({status:'NOT_DEPLOYED',sha,at:new Date().toISOString()})+'\n');
  complete=true;
 }catch{throw Error('Rollback needs reconciliation; retain operator lock and private evidence');}
 throw Error('Voice upgrade not deployed: '+error.message);
}finally{if(complete)guard.close();}
