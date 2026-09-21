import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {buyerStoreNamespaceBindings} from '../packages/buyer-store/namespace.js';
const node='/opt/nodejs/node-v22.23.1-linux-x64/bin/node';
if(process.argv[2]==='--inside'){
 const {root,mappings,denied}=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 const run=(args)=>{const r=spawnSync('/usr/bin/mount',args,{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);};
 run(['--make-rprivate','/']);
 for(const [source,destination] of mappings){
  const target=root+destination;
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.statSync(source).isDirectory())fs.mkdirSync(target,{recursive:true});else fs.writeFileSync(target,'');
  run(['--bind',source,target]);run(['-o','remount,bind,ro',target]);
 }
 fs.mkdirSync(root+'/run/systemd/system',{recursive:true});
 const attestation=spawnSync('/usr/sbin/chroot',[root,'/usr/bin/setpriv','--reuid=65534','--regid=65534','--groups=1000,65534','--no-new-privs','/usr/bin/systemctl','show','--property=InvocationID','--value','blackspire-command.service','blackspire-command-worker.service'],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',SYSTEMD_IGNORE_CHROOT:'1'}});
 assert.equal(attestation.status,0,attestation.stderr);assert.match(attestation.stdout,/^[a-f0-9\n]*$/);
 console.log('PASS: actual systemd generation observation through read-only bus socket');
 const code=`const fs=require('fs');const assert=require('assert');assert.equal(process.getuid(),65534);assert(process.getgroups().includes(1000));for(const file of ${JSON.stringify(denied)})assert.throws(()=>fs.readFileSync(file));assert.equal(fs.readFileSync('/etc/blackspire-buyer-store/runtime.json','utf8'),'synthetic-store');assert.equal(fs.readFileSync('/etc/blackspire/release-admission/state.json','utf8'),'synthetic-admission');for(const p of ['/etc/blackspire-buyer-store/runtime.json','/etc/blackspire/release-admission/state.json'])assert.throws(()=>fs.writeFileSync(p,'mutated'));console.log('PASS: isolated namespace denies credential/data reads and protected writes despite shared group membership');`;
 const r=spawnSync('/usr/sbin/chroot',[root,'/usr/bin/setpriv','--reuid=65534','--regid=65534','--groups=1000,65534','--no-new-privs',node,'-e',code],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,0,r.stderr);process.stdout.write(r.stdout);
}else{
 assert.equal(process.getuid(),0);assert.equal(process.versions.node,'22.23.1');
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-namespace-'));fs.chmodSync(base,0o755);
 try{
  const root=base+'/root',source=base+'/sources';fs.mkdirSync(root);fs.mkdirSync(source);
  const denied=['/etc/blackspire/command-api.env','/etc/blackspire/command.env','/etc/blackspire/worker-capability.json','/opt/blackspire-command/shared/database/command.sqlite','/var/lib/blackspire-operator/management.json','/home/operator/credential'];
  for(const p of [...denied,'/etc/blackspire-buyer-store/runtime.json','/etc/blackspire/release-admission/state.json']){
   fs.mkdirSync(path.dirname(source+p),{recursive:true});fs.writeFileSync(source+p,p.endsWith('runtime.json')?'synthetic-store':p.endsWith('state.json')?'synthetic-admission':'synthetic-private',{mode:0o640});fs.chownSync(source+p,0,1000);
  }
  const baseline=spawnSync('/usr/bin/setpriv',['--reuid=65534','--regid=65534','--groups=1000,65534','/usr/bin/cat',source+denied[0]],{encoding:'utf8'});assert.equal(baseline.status,0);assert.equal(baseline.stdout,'synthetic-private');
  const sha='a'.repeat(40),artifact='/opt/blackspire-command/releases/'+sha;fs.mkdirSync(source+artifact,{recursive:true});
  const mappings=buyerStoreNamespaceBindings(sha).map(destination=>[destination.startsWith('/etc/blackspire')||destination===artifact?source+destination:destination,destination]);
  const input=base+'/input.json';fs.writeFileSync(input,JSON.stringify({root,mappings,denied}));
  const child=spawnSync('/usr/bin/unshare',['--mount','--fork',node,new URL(import.meta.url).pathname,'--inside',input],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr);process.stdout.write(child.stdout);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
}
