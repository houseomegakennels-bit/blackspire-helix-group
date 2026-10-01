#!/usr/bin/env node
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:30000});
if(process.getuid()!==0||process.argv[2]!=='--apply')throw Error('Root and --apply required.');
if(run('git',['status','--porcelain']).trim())throw Error('Clean committed source required.');
const sha=run('git',['rev-parse','HEAD']).trim();
const unitPath='/etc/systemd/system/blackspire-voice.service';
if(fs.existsSync(unitPath))throw Error('Voice service already exists; use a reviewed successor.');
const root='/opt/blackspire-voice/releases/'+sha;
fs.mkdirSync(root,{recursive:true,mode:0o755});
fs.writeFileSync(root+'/package.json',JSON.stringify({type:'module'}),{flag:'wx',mode:0o644});
for(const file of ['gateway.js','personal.js','configure-key.py','project-checkpoints.json'])fs.copyFileSync('apps/voice/'+file,root+'/'+file,fs.constants.COPYFILE_EXCL);
try{run('/usr/bin/id',['blackspire-voice']);}catch{run('/usr/sbin/useradd',['--system','--no-create-home','--home-dir','/var/lib/blackspire-voice','--shell','/usr/sbin/nologin','blackspire-voice']);}
const unit='[Unit]\nDescription=Zola isolated realtime voice gateway\nAfter=network-online.target blackspire-command.service\nWants=network-online.target\n\n[Service]\nType=simple\nUser=blackspire-voice\nGroup=blackspire-voice\nStateDirectory=blackspire-voice\nStateDirectoryMode=0700\nUMask=0077\nEnvironmentFile=-/etc/blackspire/voice.env\nEnvironment=ZOLA_VOICE_DATA_DIR=/var/lib/blackspire-voice\nExecStart=/opt/nodejs/node-v22.23.1-linux-x64/bin/node '+root+'/gateway.js\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=20\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\nPrivateTmp=true\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nCapabilityBoundingSet=\nRestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX\nMemoryMax=192M\nTasksMax=32\n\n[Install]\nWantedBy=multi-user.target\n';
fs.writeFileSync(unitPath,unit,{flag:'wx',mode:0o644});
try{
 run('/usr/bin/systemd-analyze',['verify',unitPath]);
 run('/usr/bin/systemctl',['daemon-reload']);
 run('/usr/bin/systemctl',['enable','--now','blackspire-voice.service']);
 let response;
 for(let i=0;i<10;i++){try{response=await fetch('http://127.0.0.1:8796/api/voice/status?workspaceId=blackspire-command',{signal:AbortSignal.timeout(1500)});if(response.status===401)break;}catch{}await new Promise(r=>setTimeout(r,300));}
 if(response?.status!==401)throw Error('Voice unauthenticated boundary did not verify.');
 fs.symlinkSync(root+'/configure-key.py','/opt/blackspire-voice/configure-key.py');
 console.log(JSON.stringify({installed:true,sha,providerEnabled:fs.existsSync('/etc/blackspire/voice.env'),configureCommand:'sudo python3 '+root+'/configure-key.py'}));
}catch(e){
 run('/usr/bin/systemctl',['disable','--now','blackspire-voice.service']);
 fs.unlinkSync(unitPath);run('/usr/bin/systemctl',['daemon-reload']);throw e;
}
