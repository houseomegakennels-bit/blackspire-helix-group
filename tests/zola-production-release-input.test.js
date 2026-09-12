import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadProductionReleaseInput,PRODUCTION_PRINCIPAL,PRODUCTION_WORKSPACE} from '../packages/zola-release/production-release-input.js';

const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);
const input=()=>({schema:1,kind:'zola_production_release',releaseSha:a,previousMainSha:b,recoverySha:c,workspace:PRODUCTION_WORKSPACE,principal:PRODUCTION_PRINCIPAL,
 preparationRoot:'/var/lib/blackspire-operator/preparation',packageConfigurationFile:'/var/lib/blackspire-operator/preparation/package.json',n8nBackupFile:'/var/lib/blackspire-operator/preparation/n8n.json',diskConfigurationFile:'/var/lib/blackspire-operator/preparation/disk.json',backupManifestFile:'/var/lib/blackspire-operator/preparation/backup.json',migrationConfigurationFile:'/var/lib/blackspire-operator/preparation/migration.json',activationConfigurationFile:'/var/lib/blackspire-operator/preparation/activation.json'});

// File path policy is exercised by the host integration tests; these focused
// unit cases inject only immutable bytes/source after creating the exact fixed
// protected pathname is impractical in parallel test processes.
test('loader binds exact bytes and source and rejects semantic injection',()=>{
 const operator=fs.mkdtempSync(path.join(os.tmpdir(),'zola-input-')),root=path.join(operator,'preparation'),value=input(),reads=[];
 fs.mkdirSync(root,{mode:0o700});fs.chmodSync(operator,0o700);value.preparationRoot=root;
 for(const key of Object.keys(value).filter(key=>key.endsWith('File')))value[key]=path.join(root,path.basename(value[key]));
 const raw=JSON.stringify(value)+'\n',policy={preparationRoot:root,operatorRoot:operator,owner:process.getuid()},identity={getuid:()=>0,geteuid:()=>0};
 const file=path.join(root,`input-test-${process.pid}-${Date.now()}.json`);fs.writeFileSync(file,raw,{mode:0o600});
 try{const result=loadProductionReleaseInput(file,{policy,identity,readBytes:()=>{reads.push(1);return raw;},verifySource:sha=>({releaseSha:sha,clean:true})});
  assert.equal(result.value.releaseSha,a);assert.match(result.inputDigest,/^[a-f0-9]{64}$/);assert.equal(reads.length,2);
  const injected={...value,approved:true};assert.throws(()=>loadProductionReleaseInput(file,{policy,identity,readBytes:()=>JSON.stringify(injected),verifySource:()=>({})}));
 }finally{fs.unlinkSync(file);}
});
test('loader refuses non-root identity before reading input',()=>{
 let read=false;assert.throws(()=>loadProductionReleaseInput('/var/lib/blackspire-operator/preparation/absent.json',{identity:{getuid:()=>1000,geteuid:()=>1000},readBytes:()=>{read=true;},verifySource:()=>({})}));assert.equal(read,false);
});
test('loader rejects duplicate-key/noncanonical input and the wrong runtime',()=>{const operator=fs.mkdtempSync(path.join(os.tmpdir(),'zola-input-')),root=path.join(operator,'preparation'),policy={preparationRoot:root,operatorRoot:operator,owner:process.getuid()},identity={getuid:()=>0,geteuid:()=>0};
 fs.mkdirSync(root,{mode:0o700});fs.chmodSync(operator,0o700);const file=path.join(root,'input.json');fs.writeFileSync(file,'{}\n',{mode:0o600});
 const duplicate='{"schema":1,"schema":1}\n';assert.throws(()=>loadProductionReleaseInput(file,{policy,identity,readBytes:()=>duplicate,verifySource:()=>({})}));
 assert.throws(()=>loadProductionReleaseInput(file,{policy,identity,runtimeVersion:'22.22.0',readBytes:()=>'{ }\n',verifySource:()=>({})}));
});
