import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {fail} from './local-protocol.js';
export const BUYER_STORE_ROOTFS='/var/lib/blackspire-buyer-store/rootfs';
export const BUYER_STORE_NAMESPACE_DROPIN='/etc/systemd/system/blackspire-buyer-store.service.d/namespace.conf';
export const BUYER_STORE_READONLY_BINDS=Object.freeze(['/usr/bin','/usr/lib','/lib','/lib64','/opt/nodejs/node-v22.23.1-linux-x64',
 '/etc/passwd','/etc/group','/etc/nsswitch.conf','/etc/hosts','/etc/resolv.conf','/etc/ssl/certs',
 '/etc/blackspire-buyer-store','/etc/blackspire/release-admission','/run/dbus/system_bus_socket']);
export function buyerStoreNamespaceBindings(releaseSha){
 if(!/^[a-f0-9]{40}$/.test(releaseSha))fail();
 return [...BUYER_STORE_READONLY_BINDS,'/opt/blackspire-command/releases/'+releaseSha];
}
export function renderBuyerStoreNamespaceDropin(releaseSha){
 return '[Service]\nBindReadOnlyPaths=\nBindReadOnlyPaths='+buyerStoreNamespaceBindings(releaseSha).join(' ')+'\n';
}
// Validate the underlying stopped root, not mounted host inputs. Only empty
// systemd mountpoint scaffolding and the exact artifact symlink may remain.
export function verifyBuyerStoreNamespaceInventory(releaseSha,{io=fs,root=BUYER_STORE_ROOTFS}={}){
 const files=new Set(['/etc/passwd','/etc/group','/etc/nsswitch.conf','/etc/hosts','/etc/resolv.conf','/run/dbus/system_bus_socket']);
 const directories=new Set(['/', '/tmp','/dev','/proc','/sys','/run/systemd/system','/run/blackspire-buyer-store']);
 for(const target of [...buyerStoreNamespaceBindings(releaseSha),...directories]){
  if(!files.has(target))directories.add(target);
  for(let p=path.posix.dirname(target);p!=='/';p=path.posix.dirname(p))directories.add(p);
 }
 const link='/opt/blackspire-command/current';directories.add('/opt/blackspire-command');
 const visit=relative=>{
  const filename=root+(relative==='/'?'':relative),s=io.lstatSync(filename);
  if(s.uid!==0||s.gid!==0)fail();
  if(relative===link){if(!s.isSymbolicLink()||io.readlinkSync(filename)!=='releases/'+releaseSha)fail();return;}
  if(s.isSymbolicLink())fail();
  if(files.has(relative)){if(!s.isFile()||s.nlink!==1||s.size!==0||(s.mode&0o022)!==0)fail();return;}
  if(!directories.has(relative)||!s.isDirectory()||(s.mode&0o022)!==0)fail();
  for(const name of io.readdirSync(filename))visit((relative==='/'?'':relative)+'/'+name);
 };
 try{io.lstatSync(root);}catch(error){if(error.code==='ENOENT')return true;throw error;}
 visit('/');return true;
}

// The empty root contains no host credentials/data. systemd creates an isolated
// mount namespace, binds only this allowlist, then applies the service identity.
export async function prepareBuyerStoreNamespace(releaseSha,{io=fs,uid=process.getuid(),root=BUYER_STORE_ROOTFS,dropin=BUYER_STORE_NAMESPACE_DROPIN,
 run=execFileSync,inspect=inspectSealedBuyerWriterArtifact}={}){
 if(uid!==0||!/^[a-f0-9]{40}$/.test(releaseSha))fail();
 const states=run('/usr/bin/systemctl',['show','--property=MainPID','--value','blackspire-buyer-store.service','blackspire-command.service','blackspire-command-worker.service'],
  {encoding:'utf8',timeout:1000,maxBuffer:4096}).trim().split(/\s+/);
 if(states.length!==3||states.some(p=>p!=='0'))fail();
 const proof=await inspect({artifactRoot:'/opt/blackspire-command/releases/'+releaseSha,releaseSha,environment:'production'});
 if(!/^[a-f0-9]{64}$/.test(proof.artifactDigest))fail();
 const directory=target=>{
  const missing=[];for(let p=target;p!=='/';p=path.dirname(p)){
   try{const s=io.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)fail();}
   catch(e){if(e.code!=='ENOENT')throw e;missing.unshift(p);}
  }
  for(const p of missing)io.mkdirSync(p,{mode:0o755});
 };
 verifyBuyerStoreNamespaceInventory(releaseSha,{io,root});
 directory(root);
 for(const target of ['opt/blackspire-command','run/systemd/system','tmp'])directory(root+'/'+target);
 const current=root+'/opt/blackspire-command/current',target='releases/'+releaseSha;
 try{const s=io.lstatSync(current);if(!s.isSymbolicLink()||s.uid!==0||io.readlinkSync(current)!==target)fail();}
 catch(e){if(e.code!=='ENOENT')throw e;io.symlinkSync(target,current);}
 directory(path.dirname(dropin));const content=renderBuyerStoreNamespaceDropin(releaseSha);
 let fd;try{fd=io.openSync(dropin,io.constants.O_CREAT|io.constants.O_EXCL|io.constants.O_NOFOLLOW|io.constants.O_WRONLY,0o600);io.writeFileSync(fd,content);io.fsyncSync(fd);}
 catch(e){if(e.code!=='EEXIST')throw e;const s=io.lstatSync(dropin);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.nlink!==1||(s.mode&0o7777)!==0o600||io.readFileSync(dropin,'utf8')!==content)fail();}
 finally{if(fd!==undefined)io.closeSync(fd);}
 for(const p of [root+'/opt/blackspire-command',path.dirname(dropin)]){const d=io.openSync(p,io.constants.O_RDONLY);try{io.fsyncSync(d);}finally{io.closeSync(d);}}
 verifyBuyerStoreNamespaceInventory(releaseSha,{io,root});
 return {status:'BUYER_STORE_NAMESPACE_PREPARED',releaseSha,artifactDigest:proof.artifactDigest};
}
