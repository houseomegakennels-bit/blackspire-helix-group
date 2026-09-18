import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
 BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT,validateBuyerWriterProductionPlan,
} from '../scripts/lib/buyer-writer-production-preflight.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const artifactPaths={
 installer:path.join(root,'packages/buyer-writer/sql/install.sql'),
 provisioner:path.join(root,'packages/buyer-writer/production-provisioner.js'),
 verifier:path.join(root,'packages/buyer-writer/production-verifier.js'),
};
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=(filename,value,mode=0o600)=>fs.writeFileSync(filename,JSON.stringify(value),{mode});
const target={environment:'production',host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,
 database:'postgres',actor:'postgres',creatorOid:16388,serverMajor:17};
const fixed=new Date('2026-09-18T01:00:00.000Z');

function fixture(modify=()=>{}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-preflight-v2-'));
 const paths={directory,release:path.join(directory,'release.json'),catalog:path.join(directory,'catalog.json'),
  gateway:path.join(directory,'gateway.json'),management:path.join(directory,'management.json'),
  claims:path.join(directory,'claims'),restore:path.join(directory,'restore.json'),sql:path.join(directory,'restore.sql')};
 fs.chmodSync(directory,0o700);fs.mkdirSync(paths.claims,{mode:0o700});
 const artifacts=Object.fromEntries(Object.entries(artifactPaths).map(([name,filename])=>[
  name,{path:filename,sha256:sha(fs.readFileSync(filename))},
 ]));
 const release={version:1,releaseSha:'a'.repeat(40),nonce:randomBytes(32).toString('hex'),target:{...target},artifacts};
 json(paths.release,release);
 const releaseManifestSha256=sha(fs.readFileSync(paths.release));
 const catalog={version:1,capturedAt:'2026-09-18T00:58:00.000Z',releaseSha:release.releaseSha,nonce:release.nonce,
  target:{...target},releaseManifestSha256,artifactHashes:Object.fromEntries(
   Object.entries(artifacts).map(([name,row])=>[name,row.sha256])),
  impact:structuredClone(BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT)};
 json(paths.catalog,catalog);json(paths.gateway,{version:3},0o640);json(paths.management,{protected:true});
 const state={paths,release,catalog,restoreArtifactPath:undefined};
 modify(state);
 const options={mode:'apply',releaseManifestPath:paths.release,catalogSnapshotPath:paths.catalog,
  gatewayConfigPath:paths.gateway,managementConfigPath:paths.management,nonceClaimDirectory:paths.claims,
  restoreArtifactPath:state.restoreArtifactPath,now:()=>new Date(fixed)};
 return {paths,state,options,cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
function rejected(options){assert.throws(()=>validateBuyerWriterProductionPlan(options),
 error=>error.message==='Buyer writer production preflight failed');}
test('validates only an offline forward-only plan from pinned root-owned evidence',()=>{
 const f=fixture();
 try{
  const result=validateBuyerWriterProductionPlan(f.options);
  assert.equal(result.status,'PLAN_VALIDATED_OFFLINE');
  assert.equal(result.executionClassification,'IRREVERSIBLE_FORWARD_ONLY');
  assert.equal(result.executed,false);assert.equal(result.connectionAttempted,false);
  assert.equal(result.safety.networkCapability,'absent');assert.equal(result.safety.executorAccepted,false);
  assert.deepEqual(result.catalog.counts,Object.fromEntries(Object.entries(BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT)
   .map(([key,value])=>[key,value.length])));
  assert.equal(result.configs.gateway.mode,'0640');assert.equal(result.configs.management.mode,'0600');
  assert.equal(JSON.stringify(result).includes(f.paths.management),false);
 }finally{f.cleanup();}
});

test('rejects stale, future and mismatched target/release/artifact/nonce bindings',()=>{
 const changes=[
  state=>{state.catalog.capturedAt='2026-09-18T00:54:59.000Z';json(state.paths.catalog,state.catalog);},
  state=>{state.catalog.capturedAt='2026-09-18T01:00:31.000Z';json(state.paths.catalog,state.catalog);},
  state=>{state.catalog.nonce='b'.repeat(64);json(state.paths.catalog,state.catalog);},
  state=>{state.catalog.releaseSha='b'.repeat(40);json(state.paths.catalog,state.catalog);},
  state=>{state.catalog.target.creatorOid=999;json(state.paths.catalog,state.catalog);},
  state=>{state.catalog.artifactHashes.verifier='0'.repeat(64);json(state.paths.catalog,state.catalog);},
 ];
 for(const change of changes){const f=fixture(change);try{rejected(f.options);}finally{f.cleanup();}}
});

test('rejects an extra or missing delta in every canonical impact category',()=>{
 for(const category of Object.keys(BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT)){
  const extra=fixture(state=>{state.catalog.impact[category].push('unexpected:delta');
   json(state.paths.catalog,state.catalog);});
  try{rejected(extra.options);}finally{extra.cleanup();}
  if(BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT[category].length){
   const missing=fixture(state=>{state.catalog.impact[category].pop();json(state.paths.catalog,state.catalog);});
   try{rejected(missing.options);}finally{missing.cleanup();}
  }
 }
});
test('rejects symlinked evidence and incorrect config or evidence modes',()=>{
 const symlink=fixture(state=>{const real=path.join(state.paths.directory,'real-release.json');
  fs.renameSync(state.paths.release,real);fs.symlinkSync(real,state.paths.release);});
 try{rejected(symlink.options);}finally{symlink.cleanup();}
 for(const [name,mode] of [['gateway',0o600],['management',0o640],['catalog',0o644],['release',0o644]]){
  const f=fixture(state=>fs.chmodSync(state.paths[name],mode));
  try{rejected(f.options);}finally{f.cleanup();}
 }
});

test('rejects tampered pinned artifacts and cannot be uplifted by a fake executor',()=>{
 const tampered=fixture(state=>{state.release.artifacts.installer.sha256='0'.repeat(64);json(state.paths.release,state.release);});
 try{rejected(tampered.options);}finally{tampered.cleanup();}
 const fake=fixture();
 try{rejected({...fake.options,executor:async()=>({safe:true})});}finally{fake.cleanup();}
});

test('requires a loaded, hashed, bound executable restore artifact before changing classification',()=>{
 const good=fixture(state=>{
  const sql='-- BLACKSPIRE EXACT RESTORE\nbegin;\nselect 1;\ncommit;\n';
  fs.writeFileSync(state.paths.sql,sql,{mode:0o600});
  const restore={version:1,kind:'buyer_writer_exact_restore',releaseSha:state.release.releaseSha,
   nonce:state.release.nonce,target:{...target},executable:{format:'sql',path:state.paths.sql,
    sha256:sha(Buffer.from(sql)),coverage:Object.keys(BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT)}};
  json(state.paths.restore,restore);state.restoreArtifactPath=state.paths.restore;
 });
 try{
  const result=validateBuyerWriterProductionPlan(good.options);
  assert.equal(result.status,'PLAN_VALIDATED_OFFLINE');
  assert.equal(result.executionClassification,'EXACT_RESTORE_ARTIFACT_VALIDATED');
  assert.deepEqual(result.restore.coverage,Object.keys(BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT));
 }finally{good.cleanup();}
 const bad=fixture(state=>{
  const sql='-- BLACKSPIRE EXACT RESTORE\nbegin;\ncommit;\n';
  fs.writeFileSync(state.paths.sql,sql,{mode:0o600});
  const restore={version:1,kind:'buyer_writer_exact_restore',releaseSha:state.release.releaseSha,
   nonce:state.release.nonce,target:{...target},executable:{format:'sql',path:state.paths.sql,
    sha256:sha(Buffer.from(sql)),coverage:Object.keys(BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT)}};
  json(state.paths.restore,restore);fs.appendFileSync(state.paths.sql,'-- tampered\n');state.restoreArtifactPath=state.paths.restore;
 });
 try{rejected(bad.options);}finally{bad.cleanup();}
});

test('single-use nonce claim rejects replay across validations',()=>{
 const f=fixture();
 try{
  assert.equal(validateBuyerWriterProductionPlan(f.options).status,'PLAN_VALIDATED_OFFLINE');
  rejected(f.options);
 }finally{f.cleanup();}
});
test('CLI emits mode-0600 redacted evidence and never accepts connect or executor flags',()=>{
 const f=fixture();const evidence=path.join(f.paths.directory,'evidence.json');
 try{
  f.state.catalog.capturedAt=new Date().toISOString();json(f.paths.catalog,f.state.catalog);
  const cli=path.join(root,'scripts/preflight-buyer-writer-production.mjs');
  const args=[cli,'--mode','verify','--release-manifest',f.paths.release,'--catalog-snapshot',f.paths.catalog,
   '--gateway-config',f.paths.gateway,'--management-config',f.paths.management,
   '--nonce-claim-dir',f.paths.claims,'--output',evidence];
  const result=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);assert.equal(report.status,'PLAN_VALIDATED_OFFLINE');
  assert.equal(report.executionClassification,'READ_ONLY');
  assert.equal(fs.statSync(evidence).mode&0o777,0o600);
  assert.equal(result.stdout.includes(f.paths.management),false);
  for(const flag of ['--connect','--executor']){
   const denied=spawnSync(process.execPath,[cli,flag,'true'],{encoding:'utf8'});
   assert.notEqual(denied.status,0);assert.match(denied.stderr,/no connection was attempted/);
  }
 }finally{f.cleanup();}
});
