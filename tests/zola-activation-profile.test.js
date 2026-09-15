import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {collectZolaActivationProfile,writeZolaActivationProfile} from '../packages/zola-release/activation-profile.js';

function fixture(){
  const releaseSha='a'.repeat(40),apiUnit='blackspire-command.service',workerUnit='blackspire-command-worker.service';
  const api={supervisor:{pid:10},child:{pid:11,uid:900,euid:900,gid:901,egid:901,groups:[901]}};
  const worker={supervisor:{pid:20},child:{pid:21,uid:902}};
  const runtime={api:{supervisor:api.supervisor,invocationId:'b'.repeat(32),controlGroup:'/system.slice/'+apiUnit},worker:{pid:20,invocationId:'c'.repeat(32),controlGroup:'/system.slice/'+workerUnit}};
  const input={releaseSha,configurationFile:'/etc/blackspire/writer.json'};
  const secret=()=>randomBytes(32).toString('base64url');
  const config={version:1,workspace:'blackspire-command',bindingFile:'/etc/blackspire/binding.json',writerCredential:secret(),issuerCredential:secret(),runtime:{host:'db.test',port:5432,database:'postgres',password:secret()},issuer:{host:'db.test',port:5432,database:'postgres',password:secret()}};
  const options={uid:0,run:async()=>({stdout:'10\n',stderr:''}),collect:({role})=>structuredClone(role==='api'?api:worker),
    inspectFactory:()=>async()=>structuredClone(runtime),resolveIdentity:async()=>({uid:900,credentialGroupId:901,workerUid:902}),
    readSnapshot:()=>({identity:{ino:1},value:structuredClone(config)}),inspectArtifact:async()=>({releaseSha,environment:'production',artifactDigest:'d'.repeat(64)})};
  return{input,options,config,runtime,api,worker};
}

test('activation profile derives API child, private NSS identity and exact generations without copying credentials',async()=>{
  const f=fixture(),result=await collectZolaActivationProfile(f.input,f.options);
  assert.equal(result.profile.context.apiPid,11);assert.equal(result.profile.context.apiGeneration,'b'.repeat(32));
  assert.equal(result.workerGeneration,'c'.repeat(32));assert.equal(result.profile.context.artifactRoot,'/opt/blackspire-command/releases/'+'a'.repeat(40));
  for(const secret of [f.config.writerCredential,f.config.issuerCredential,f.config.runtime.password,f.config.issuer.password])assert.ok(!JSON.stringify(result).includes(secret));
});

test('profile builder rejects stopped services, source/identity mismatch, and configuration or process drift',async()=>{
  for(const mutate of [
    f=>{f.options.uid=1;f.options.run=()=>assert.fail('must reject before observation');},
    f=>{f.options.run=async()=>({stdout:'0\n',stderr:''});f.options.readSnapshot=()=>assert.fail('must not read secrets');},
    f=>{f.options.inspectArtifact=async()=>({releaseSha:'e'.repeat(40),environment:'production',artifactDigest:'d'.repeat(64)});},
    f=>{f.worker.child.uid=900;},
    f=>{f.config.workspace='foreign';},
    f=>{let reads=0;f.options.readSnapshot=()=>({identity:{ino:++reads},value:structuredClone(f.config)});},
    f=>{let reads=0;f.options.inspectFactory=()=>async()=>({...structuredClone(f.runtime),epoch:++reads});},
    f=>{let reads=0;f.options.collect=({role})=>role==='api'?{...structuredClone(f.api),epoch:++reads}:f.worker;},
  ]){
    const f=fixture();mutate(f);await assert.rejects(collectZolaActivationProfile(f.input,f.options),/^Error: Zola activation profile preparation rejected$/);
  }
});

test('profile publication refuses nonroot, writable and symlink ancestors before creating a file',()=>{
  let opened=false;
  const io={lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o777}),openSync:()=>{opened=true;assert.fail('no write');}};
  assert.throws(()=>writeZolaActivationProfile('/safe/profile.json',{}, {uid:0,io}),/preparation rejected/);assert.equal(opened,false);
  assert.throws(()=>writeZolaActivationProfile('/safe/profile.json',{}, {uid:2,io}),/preparation rejected/);
  io.lstatSync=()=>({isDirectory:()=>true,isSymbolicLink:()=>true,uid:0,mode:0o755});
  assert.throws(()=>writeZolaActivationProfile('/safe/profile.json',{}, {uid:0,io}),/preparation rejected/);
});

test('root host publishes one protected profile and preserves it on duplicate or symlink attempts',{skip:process.getuid()!==0},()=>{
  const directory=fs.mkdtempSync('/root/zola-profile-test-');fs.chmodSync(directory,0o700);
  try{
    const destination=path.join(directory,'profile.json'),value={version:1,configurationFile:'/etc/blackspire/writer.json',context:{releaseSha:'a'.repeat(40)}};
    const result=writeZolaActivationProfile(destination,value);
    assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal(fs.statSync(destination).mode&0o777,0o600);
    const bytes=fs.readFileSync(destination);assert.deepEqual(JSON.parse(bytes),value);
    assert.throws(()=>writeZolaActivationProfile(destination,{version:2}),/preparation rejected/);
    assert.ok(fs.readFileSync(destination).equals(bytes));
    const link=path.join(directory,'link.json');fs.symlinkSync(destination,link);
    assert.throws(()=>writeZolaActivationProfile(link,value),/preparation rejected/);assert.ok(fs.readFileSync(destination).equals(bytes));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
