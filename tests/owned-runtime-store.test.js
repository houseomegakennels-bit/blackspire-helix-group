import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createOwnedRuntimeStoreTransition} from '../packages/zola-release/owned-runtime-store.js';
import {createOwnedStoreTransition} from '../packages/zola-release/owned-store-transition.js';
import {publishBuyerStoreInstalledManifest} from '../packages/buyer-store/manifest-publication.js';
import {inspectBuyerWriterArtifact} from '../packages/buyer-writer/artifact-inspection.js';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
const bytes=v=>JSON.stringify(v)+'\n',hash=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const root=fs.mkdtempSync('/run/owned-runtime-store-'),gid=61012;
 const releaseSha='a'.repeat(40),binding={releaseSha,runId:'00000000-0000-4000-8000-000000000001',apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32)};
 const paths={runtime:root+'/runtime.json',manifest:root+'/installed.json',root:root+'/transitions'};
 fs.mkdirSync(paths.root,{mode:0o700});
 const ca='synthetic fixture certificate',profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16385,systemIdentifier:'7000000000000000001',caSha256:hash(ca)};
 const configuration={version:1,client:{version:1,releaseSha,profileDigest:ownedPostgresProfileDigest(profile),key:randomBytes(32).toString('base64url')},profile,ca,
 repositoryPassword:randomBytes(32).toString('base64url'),capabilityPassword:randomBytes(32).toString('base64url'),publicKey:'sb_publishable_fixture',operatorOwnerId:null,ipcGroupId:61013};
 fs.writeFileSync(paths.runtime,bytes(configuration),{mode:0o640});fs.chownSync(paths.runtime,0,gid);
 const publications={manifest:paths.manifest,root:root+'/publications',current:root+'/current',releases:root+'/releases'};
 fs.mkdirSync(publications.releases);fs.mkdirSync(publications.releases+'/'+releaseSha);fs.symlinkSync(publications.releases+'/'+releaseSha,publications.current);
 let inspections=0,wrongProof=false,wrongGeneration=false,lost=false,interrupt=false;
 const io=new Proxy(fs,{get(t,k){if(k==='renameSync')return(...args)=>{const r=fs.renameSync(...args);if(interrupt&&!lost&&args[1]===paths.manifest){lost=true;throw new Error('synthetic lost manifest rename acknowledgement');}return r;};return t[k];}});
 const inspect=args=>{inspections++;return inspectBuyerWriterArtifact({...args,run:async()=>({stdout:JSON.stringify({releaseSha:args.releaseSha,environment:'production',artifactDigest:'d'.repeat(64),...(wrongProof?{status:'SEALED_ARTIFACT_VERIFIED',deployed:false,productionAccepted:false}:{})}),stderr:''})});};
 const helper=()=>createOwnedRuntimeStoreTransition({
  inspect,transition:options=>createOwnedStoreTransition({paths,io,apiGroup:()=>61011,storeGroup:()=>gid,...options}),
  publish:(value,options)=>publishBuyerStoreInstalledManifest(value,{paths:publications,io,readConfig:async()=>({configuration,gid}),observeGenerations:()=>[wrongGeneration?'e'.repeat(32):binding.apiGeneration,binding.workerGeneration],...options}),
 });
 return {root,paths,publications,binding,configuration,helper,inspections:()=>inspections,badProof:()=>{wrongProof=true;},badGeneration:()=>{wrongGeneration=true;},interrupt:()=>{interrupt=true;},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const rootOnly={skip:process.getuid()!==0};
test('runtime store publishes through deployed proof at both actual protected layers and preserves inodes on replay',rootOnly,async()=>{
 const f=fixture();try{
  const result=await f.helper().publishManifest(f.binding);assert.equal(result.status,'BUYER_STORE_MANIFEST_PUBLISHED');assert.equal(f.inspections(),2);
  const actual=JSON.parse(fs.readFileSync(f.paths.manifest));assert.equal(actual.releaseSha,f.binding.releaseSha);assert.equal(actual.configurationDigest,hash(JSON.stringify(f.configuration)));
  assert.equal(fs.statSync(f.paths.manifest).gid,61012);assert.equal(fs.statSync(f.paths.manifest).mode&0o777,0o640);
  const inode=fs.statSync(f.paths.manifest).ino;await f.helper().publishManifest(f.binding);assert.equal(fs.statSync(f.paths.manifest).ino,inode);
  assert.equal(f.helper().observeManifest(f.binding),true);
 }finally{f.cleanup();}
});
test('sealed proof in runtime lane, current pointer drift and wrong generations cannot publish installed manifest',rootOnly,async()=>{
 for(const kind of ['proof','pointer','generation']){const f=fixture();try{
  if(kind==='proof')f.badProof();if(kind==='generation')f.badGeneration();if(kind==='pointer'){fs.unlinkSync(f.publications.current);fs.symlinkSync(f.root,f.publications.current);}
  await assert.rejects(f.helper().publishManifest(f.binding));assert.equal(fs.existsSync(f.paths.manifest),false);
 }finally{f.cleanup();}}
});
test('outer receipt and inner durable publication reconcile actual lost rename without replacement',rootOnly,async()=>{
 const f=fixture();try{
  f.interrupt();await assert.rejects(f.helper().publishManifest(f.binding));assert.equal(fs.existsSync(f.paths.root+'/manifest-'+f.binding.releaseSha+'.json'),true);
  const inode=fs.statSync(f.paths.manifest).ino;await f.helper().publishManifest(f.binding);assert.equal(fs.statSync(f.paths.manifest).ino,inode);
  fs.writeFileSync(f.paths.manifest,bytes({foreign:true}));await assert.rejects(f.helper().publishManifest(f.binding));assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.manifest)),{foreign:true});
 }finally{f.cleanup();}
});

test('runtime factory preserves sealed preparation and lifecycle methods; only publication uses deployed inspector',async()=>{
 const calls=[],base={prepare:()=>{calls.push('sealed-prepare');return 'sealed';},start:()=>{},restore:()=>{}};
 const inspect=async()=>({artifactDigest:'d'.repeat(64)});
 const runtimePublish=()=>{calls.push('deployed-publication');return 'runtime';};
 let constructors=0;
 const helper=createOwnedRuntimeStoreTransition({inspect,publish:()=>{},transition:options=>{
  constructors++;if(options===undefined)return base;
  assert.equal(options.inspect,inspect);return {prepare:()=>assert.fail('runtime preparation used'),start:()=>assert.fail(),restore:()=>assert.fail(),publishManifest:runtimePublish};
 }});
 assert.equal(constructors,2);assert.equal(helper.prepare,base.prepare);assert.equal(helper.start,base.start);assert.equal(helper.restore,base.restore);
 assert.equal(helper.prepare(),'sealed');assert.equal(helper.publishManifest(),'runtime');assert.deepEqual(calls,['sealed-prepare','deployed-publication']);
});
