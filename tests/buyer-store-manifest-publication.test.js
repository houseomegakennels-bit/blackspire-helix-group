import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {acquireReleaseAdmissionLock} from '../packages/shared/release-admission.js';
import {publishBuyerStoreInstalledManifest} from '../packages/buyer-store/manifest-publication.js';
test('actual protected manifest publication retains interrupted outcome and restores previous bytes',{skip:process.getuid()!==0},async()=>{
 const dir=fs.mkdtempSync('/run/buyer-manifest-');
 const binding={releaseSha:'a'.repeat(40),runId:'00000000-0000-0000-0000-000000000001',apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32)};
 const paths={manifest:dir+'/installed.json',root:dir+'/publications',current:dir+'/current',releases:dir+'/releases'};
 fs.mkdirSync(paths.releases);fs.mkdirSync(paths.releases+'/'+binding.releaseSha);fs.symlinkSync(paths.releases+'/'+binding.releaseSha,paths.current);
 const previous={retained:'prior-reviewed-binding'};fs.writeFileSync(paths.manifest,JSON.stringify(previous)+'\n',{mode:0o640});
 let failAfterRename=true;
 const io=new Proxy(fs,{get(target,key){if(key==='renameSync')return (...args)=>{const result=fs.renameSync(...args);if(failAfterRename){failAfterRename=false;throw new Error('synthetic interrupted publication');}return result;};return target[key];}});
 const configuration={client:{releaseSha:binding.releaseSha}};
 const dependencies={paths,io,uid:0,readConfig:async()=>({configuration,gid:0}),observeGenerations:()=>[binding.apiGeneration,binding.workerGeneration],
  inspect:async()=>({artifactDigest:'d'.repeat(64)}),readProtected:p=>JSON.parse(fs.readFileSync(p,'utf8'))};
 try{
  await assert.rejects(publishBuyerStoreInstalledManifest(binding,dependencies));
  const result=await publishBuyerStoreInstalledManifest(binding,dependencies);assert.equal(result.status,'BUYER_STORE_MANIFEST_PUBLISHED');
  const inode=fs.statSync(paths.root+'/admission.lock').ino;const held=acquireReleaseAdmissionLock({root:paths.root,exclusive:true,owner:0,groupId:0});try{await assert.rejects(publishBuyerStoreInstalledManifest(binding,dependencies));}finally{held.close();}
  assert.equal(fs.statSync(paths.root+'/admission.lock').ino,inode);
  const actual=JSON.parse(fs.readFileSync(paths.manifest));assert.equal(actual.releaseSha,binding.releaseSha);
  assert.equal((fs.statSync(paths.manifest).mode&0o777),0o640);
  await publishBuyerStoreInstalledManifest(binding,{...dependencies,restore:true});
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.manifest)),previous);
  await publishBuyerStoreInstalledManifest(binding,dependencies);
  fs.writeFileSync(paths.manifest,JSON.stringify({foreign:true}));
  await assert.rejects(publishBuyerStoreInstalledManifest(binding,{...dependencies,restore:true}));
  await assert.rejects(publishBuyerStoreInstalledManifest(binding,{...dependencies,observeGenerations:()=>['e'.repeat(32),binding.workerGeneration]}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
