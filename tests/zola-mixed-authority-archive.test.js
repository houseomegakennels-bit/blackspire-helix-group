
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {hash} from '../packages/zola-release/commander-journal.js';
import {recoveryDigest} from '../packages/zola-release/admitted-read-recovery.js';
import {MIXED_RETIREMENT as P} from '../packages/zola-release/mixed-retirement-history.js';
import {MIXED_ARCHIVE_FILES,createMixedAuthorityArchivePlan,createMixedAuthorityArchiveFiles,archiveMixedAuthority,verifyMixedAuthorityArchive} from '../packages/zola-release/mixed-authority-archive.js';
function fixture(){
 const root=fs.mkdtempSync('/root/zola-mixed-archive-'),paths={},snapshot={unitConfig:{fixture:true},files:{}};
 for(const [name,original]of Object.entries(MIXED_ARCHIVE_FILES)){
  const file=root+'/'+name;paths[name]=file;fs.writeFileSync(file,JSON.stringify({synthetic:name})+'\n',{mode:name==='secret'?0o600:0o640});
  const st=fs.lstatSync(file);snapshot.files[original]={digest:recoveryDigest(fs.readFileSync(file)),identity:Object.fromEntries(['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,st[k]]))};
 }
 const before={protectedStateDigest:hash(snapshot),retainedEvidenceDigest:P.retainedEvidenceDigest,artifactDigest:P.artifactDigest,bindingRetained:true,authorityInactive:true};
 const plan=createMixedAuthorityArchivePlan(snapshot,before);
 const proof={version:1,runId:P.runId,currentSha:P.releaseSha,hostStopped:true,noDetachedSurvivors:true,authorityInactive:true,bindingRetained:true,retainedEffects:true,...Object.fromEntries(['retainedEvidenceDigest','acceptanceDigest','collectorDigest','transitionDigest','successorArtifactDigest','lineageDigest'].map(k=>[k,P[k]])),stopPlanDigest:'a'.repeat(64),stopResultDigest:'b'.repeat(64),protectedStateDigest:plan.protectedStateDigest};
 const retired={schema:6,type:'sequence_retired',operationId:P.operationId,releaseSha:P.releaseSha,attemptId:P.attemptId,ordinal:13,stage:'six_reads',prefixDigest:P.prefixDigest,segmentDigest:P.segmentDigest,successorReleaseSha:P.successorReleaseSha,successorOperationId:P.successorOperationId,backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,proof,proofDigest:hash(proof)};
 const values=new Map([['plan',plan]]),store={read:n=>structuredClone(values.get(n)??null),retain:(n,v)=>{if(values.has(n))assert.deepEqual(values.get(n),v);else values.set(n,structuredClone(v));}};
 const files=createMixedAuthorityArchiveFiles({root:root+'/archive',paths}),host={fence:async()=>structuredClone(retired)};
 return {root,paths,plan,retired,files,host,store,values,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('actual protected archives preserve bytes and inode; completed evidence tolerates fresh live authority',{skip:process.getuid?.()!==0},async()=>{
 const f=fixture();try{
  f.files.prepare(f.plan);const result=await archiveMixedAuthority(f.plan,f);assert.equal(result.status,'MIXED_AUTHORITY_ARCHIVED');
  assert.deepEqual(await archiveMixedAuthority(f.plan,f),result);
  for(const [name,file]of Object.entries(f.paths)){assert.equal(fs.existsSync(file),false);assert.equal(fs.lstatSync(f.root+'/archive/'+name).ino,f.plan.files[name].identity.ino);fs.writeFileSync(file,'fresh authority',{mode:0o600});}
  assert.deepEqual(verifyMixedAuthorityArchive(f.plan,f),result);await assert.rejects(archiveMixedAuthority(f.plan,f));
  fs.appendFileSync(f.root+'/archive/claims',' ');assert.throws(()=>verifyMixedAuthorityArchive(f.plan,f));
 }finally{f.close();}
});
test('lost rename acknowledgement observes without redispatch; retained intent with original source refuses',{skip:process.getuid?.()!==0},async()=>{
 for(const after of [false,true]){const f=fixture();try{
  f.files.prepare(f.plan);let calls=0;const execute=f.files.execute;f.files.execute=(p,n)=>{calls++;if(after)execute(p,n);throw Error('lost ACK');};
  await assert.rejects(archiveMixedAuthority(f.plan,f));assert.equal(calls,1);f.files.execute=(...a)=>{calls++;return execute(...a);};
  if(after){assert.equal((await archiveMixedAuthority(f.plan,f)).status,'MIXED_AUTHORITY_ARCHIVED');assert.equal(calls,4);}
  else{await assert.rejects(archiveMixedAuthority(f.plan,f));assert.equal(calls,1);assert.equal(fs.existsSync(f.paths.claims),true);}
 }finally{f.close();}}
});
test('foreign destination, changed file identity, live-state drift and wrong retirement fail before move',{skip:process.getuid?.()!==0},async()=>{
 for(const kind of ['destination','identity','fence','retirement']){
  const f=fixture();try{f.files.prepare(f.plan);
   if(kind==='destination')fs.writeFileSync(f.root+'/archive/claims','foreign',{mode:0o640});
   if(kind==='identity'){const b=fs.readFileSync(f.paths.claims);fs.renameSync(f.paths.claims,f.paths.claims+'.retained');fs.writeFileSync(f.paths.claims,b,{mode:0o640});}
   if(kind==='fence')f.host.fence=async()=>{throw Error('running service');};
   if(kind==='retirement'){f.retired.proof.protectedStateDigest='f'.repeat(64);f.retired.proofDigest=hash(f.retired.proof);}
   await assert.rejects(archiveMixedAuthority(f.plan,f));assert.equal(fs.existsSync(f.paths.claims),true);
  }finally{f.close();}
 }
});
