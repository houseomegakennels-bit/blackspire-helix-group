import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buyerStoreNamespaceBindings,prepareBuyerStoreNamespace,renderBuyerStoreNamespaceDropin} from '../packages/buyer-store/namespace.js';
test('namespace mount set contains only explicit runtime inputs and exact sealed artifact',()=>{
 const sha='a'.repeat(40),mounts=buyerStoreNamespaceBindings(sha);
 for(const forbidden of ['/etc','/var','/home','/opt/blackspire-command','/etc/blackspire','/opt/blackspire-command/shared','/etc/blackspire/command.env'])assert(!mounts.includes(forbidden));
 assert(mounts.includes('/etc/blackspire/release-admission'));assert(mounts.includes('/opt/blackspire-command/releases/'+sha));
 assert(!renderBuyerStoreNamespaceDropin(sha).includes('/releases '));
 assert.throws(()=>buyerStoreNamespaceBindings('../outside'));
});
test('namespace preparation requires quiescence and refuses foreign retained release', {skip:process.getuid()!==0},async()=>{
 const base=fs.mkdtempSync('/root/buyer-namespace-test-'),sha='a'.repeat(40),root=base+'/rootfs',dropin=base+'/unit/namespace.conf';
 const options={root,dropin,run:()=> '0\n0\n0\n',inspect:async()=>({artifactDigest:'b'.repeat(64)})};
 try{
  assert.equal((await prepareBuyerStoreNamespace(sha,options)).status,'BUYER_STORE_NAMESPACE_PREPARED');
  await prepareBuyerStoreNamespace(sha,options);
  assert.equal(fs.readlinkSync(root+'/opt/blackspire-command/current'),'releases/'+sha);
  assert.equal(fs.readFileSync(dropin,'utf8'),renderBuyerStoreNamespaceDropin(sha));
  await assert.rejects(prepareBuyerStoreNamespace('c'.repeat(40),options));
  await assert.rejects(prepareBuyerStoreNamespace(sha,{...options,run:()=> '0\n100\n0\n'}));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('namespace rejects foreign content and accepts only empty mountpoint scaffolding',{skip:process.getuid()!==0},async()=>{
 const {verifyBuyerStoreNamespaceInventory}=await import('../packages/buyer-store/namespace.js');
 const base=fs.mkdtempSync('/root/buyer-namespace-inventory-'),sha='a'.repeat(40),root=base+'/rootfs',dropin=base+'/unit/namespace.conf';
 const options={root,dropin,run:()=> '0\n0\n0\n',inspect:async()=>({artifactDigest:'b'.repeat(64)})};
 try{
  await prepareBuyerStoreNamespace(sha,options);
  fs.mkdirSync(root+'/etc',{mode:0o755});fs.writeFileSync(root+'/etc/passwd','',{mode:0o644});
  fs.mkdirSync(root+'/usr/bin',{recursive:true});assert.equal(verifyBuyerStoreNamespaceInventory(sha,{root}),true);
  for(const [file,contents] of [['/etc/passwd','synthetic private data'],['/etc/foreign','synthetic'],['/usr/bin/foreign','synthetic']]){
   fs.writeFileSync(root+file,contents,{mode:0o600});await assert.rejects(prepareBuyerStoreNamespace(sha,options));fs.unlinkSync(root+file);
  }
  fs.symlinkSync('/etc',root+'/etc/foreign');await assert.rejects(prepareBuyerStoreNamespace(sha,options));fs.unlinkSync(root+'/etc/foreign');
  fs.mkdirSync(root+'/home');await assert.rejects(prepareBuyerStoreNamespace(sha,options));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
