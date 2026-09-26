#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000});
const digest=b=>createHash('sha256').update(b).digest('hex');
if(process.getuid()!==0||process.argv[2]!=='--apply')throw Error('Root and --apply required');
if(run('git',['status','--porcelain']).trim())throw Error('Clean source required');
const sha=run('git',['rev-parse','HEAD']).trim();
const root='/var/www/zola-ui/'+sha,record='/var/lib/blackspire-operator/zola-ui-'+sha;
const config=fs.realpathSync('/etc/nginx/sites-enabled/command.conf');
const previous=fs.readFileSync(config),stat=fs.statSync(config);
if(stat.uid!==0||(stat.mode&0o022)!==0)throw Error('Unsafe nginx configuration');
if(previous.includes('BEGIN ZOLA BRAND UI'))throw Error('Existing UI deployment requires explicit upgrade');
const files={'/zola':'index.html','/zola.css':'jarvis.css','/zola.js':'jarvis.js','/jarvis.css':'jarvis.css','/jarvis.js':'jarvis.js','/helix-core.js':'helix-core.js','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/zola-icon.svg':'zola-icon.svg','/hermes-runtime':'hermes-runtime.html','/hermes-runtime.css':'hermes-runtime.css','/hermes-runtime.js':'hermes-runtime.js'};
const types={html:'text/html',css:'text/css',js:'text/javascript',webmanifest:'application/manifest+json',svg:'image/svg+xml'};
const csp="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:";
const headers='add_header X-Frame-Options DENY always;\nadd_header X-Content-Type-Options nosniff always;\nadd_header Referrer-Policy no-referrer always;\nadd_header Permissions-Policy "microphone=(self), camera=(), geolocation=()" always;\nadd_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\nadd_header Content-Security-Policy "'+csp+'" always;\nadd_header Cache-Control "no-cache" always;\nadd_header X-Zola-UI-Revision "'+sha+'" always;\n';
let block='\n    # BEGIN ZOLA BRAND UI\n    location = / { return 302 /zola; }\n    location = /jarvis { return 302 /zola; }\n';
for(const[url,file]of Object.entries(files))block+='    location = '+url+' {\n        alias '+root+'/'+file+';\n        default_type '+types[file.split('.').at(-1)]+';\n        limit_except GET { deny all; }\n'+headers+'    }\n';
block+='    # END ZOLA BRAND UI\n';
const anchor='    # Defense-in-depth: deny hidden/dotfile traversal at the edge.';
if(previous.toString().split(anchor).length!==2)throw Error('Unexpected configuration shape');
const next=Buffer.from(previous.toString().replace(anchor,block+anchor));
const guard=openReleaseJournal();
function write(file,b,mode){const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function replace(b){const temp=config+'.zola-pending';write(temp,b,stat.mode&0o777);fs.renameSync(temp,config);}
try{
 const health=await fetch('http://127.0.0.1:8789/ready',{signal:AbortSignal.timeout(4000)});if(health.status!==200)throw Error('Backend not ready');
 fs.mkdirSync(root,{recursive:true,mode:0o755});fs.mkdirSync(record,{mode:0o700});
 const inventory={};
 for(const file of new Set(Object.values(files))){const bytes=fs.readFileSync('apps/jarvis-pwa/public/'+file);write(root+'/'+file,bytes,0o644);inventory[file]=digest(bytes);}
 write(record+'/nginx-before.conf',previous,0o600);write(record+'/nginx-after.conf',next,0o600);
 write(record+'/intent.json',JSON.stringify({sha,files:inventory,before:digest(previous),after:digest(next)})+'\n',0o600);
 if(!fs.readFileSync(config).equals(previous))throw Error('Concurrent configuration change');
 replace(next);
 try{run('/usr/sbin/nginx',['-t']);run('/usr/bin/systemctl',['reload','nginx']);}catch{replace(previous);run('/usr/sbin/nginx',['-t']);run('/usr/bin/systemctl',['reload','nginx']);throw Error('UI deployment rolled back');}
 write(record+'/result.json',JSON.stringify({status:'DEPLOYED',sha,at:new Date().toISOString()})+'\n',0o600);
 console.log(JSON.stringify({status:'DEPLOYED',url:'https://command.blackspirehelix.com/zola',sha}));
}finally{guard.close();}
