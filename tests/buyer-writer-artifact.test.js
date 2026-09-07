import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeReleaseEvidence,verifyReleaseEvidence} from '../packages/shared/release-evidence.js';
import {verifyBuyerWriterArtifact} from '../packages/buyer-writer/artifact.js';
function fixture(){
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-artifact-')),releaseSha='a'.repeat(40),root=path.join(temporary,'releases',releaseSha);
  fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'COMMIT_SHA'),releaseSha+'\n');fs.writeFileSync(path.join(root,'app.js'),'export const synthetic = true;\n');
  const manifest=writeReleaseEvidence(root,{commitSha:releaseSha,expectedEnvironment:'production',buildTimestamp:'2026-09-07T00:00:00Z',buildId:'synthetic',ciProvider:'local-disposable',artifactName:'synthetic',packageVersion:'1.0.0',nodeVersion:'v22.23.1',repository:'synthetic'});
  fs.writeFileSync(path.join(root,'.release-complete'),'');fs.writeFileSync(path.join(root,'.deployment-record.json'),JSON.stringify({schema:'blackspire-deployment-record',version:1,commitSha:releaseSha,artifactDigest:manifest.artifact.digest,environment:'production',recordedAt:'2026-09-07T00:00:00.000Z'}));
  // Only OS ownership/mode is simulated for the unprivileged test fixture. Real
  // release hashing, file reads, traversal and before/after comparison run.
  const io={...fs,lstatSync:name=>{const s=fs.lstatSync(name);return Object.assign(Object.create(s),{uid:0,mode:s.isDirectory()?0o40755:s.mode&~0o022});}};
  return{root,temporary,options:{artifactRoot:root,releaseSha,environment:'production',uid:0,io},cleanup:()=>fs.rmSync(temporary,{recursive:true,force:true})};
}
test('artifact verification requires the real digest, deployment record and unchanged protected tree',()=>{
  const f=fixture();try{const proof=verifyBuyerWriterArtifact(f.options);assert.equal(proof.releaseSha,f.options.releaseSha);assert.match(proof.artifactDigest,/^[a-f0-9]{64}$/);assert.equal(proof.environment,'production');}finally{f.cleanup();}
});
test('changed content, missing marker, mismatched deployment, links and unprotected ownership fail',()=>{
  for(const mutate of [
    f=>fs.writeFileSync(path.join(f.root,'app.js'),'tampered'),f=>fs.unlinkSync(path.join(f.root,'.release-complete')),
    f=>fs.writeFileSync(path.join(f.root,'.deployment-record.json'),'{}'),f=>fs.symlinkSync('app.js',path.join(f.root,'alias.js')),
    f=>fs.linkSync(path.join(f.root,'app.js'),path.join(f.root,'alias.js')),
    f=>{f.options.uid=994;},f=>{const old=f.options.io.lstatSync;f.options.io.lstatSync=name=>Object.assign(Object.create(old(name)),{uid:994});},
  ]){const f=fixture();try{mutate(f);assert.throws(()=>verifyBuyerWriterArtifact(f.options),error=>error.message==='Buyer writer artifact verification rejected'&&!error.cause);}finally{f.cleanup();}}
});
test('tree changes after digest verification and oversized entries fail closed',()=>{
  for(const mutate of [
    f=>{f.options.verifyEvidence=args=>{const result=verifyReleaseEvidence(args);fs.writeFileSync(path.join(f.root,'app.js'),'changed after hashing');return result;};},
    f=>{const old=f.options.io.lstatSync;f.options.io.lstatSync=name=>{const s=old(name);return name.endsWith('app.js')?Object.assign(Object.create(s),{size:33554433}):s;};},
  ]){const f=fixture();try{mutate(f);assert.throws(()=>verifyBuyerWriterArtifact(f.options),/Buyer writer artifact verification rejected/);}finally{f.cleanup();}}
});
