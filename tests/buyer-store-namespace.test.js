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
