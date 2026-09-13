import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {APPLICATION_FUNCTION_PG_NET_SQL,createPgNetIsolationProof,scanApplicationPgNetSource}
 from '../packages/zola-release/pg-net-isolation.js';
import {PROVIDER_ACL_CHECK_SQL,PROVIDER_ACL_FUNCTIONS,createProviderAclCheckOperation}
 from '../packages/zola-release/production-acl-writer.js';

const releaseSha='a'.repeat(40),operationId='11111111-1111-4111-8111-111111111111';
const args={input:{releaseSha,workspace:'blackspire',principal:'zola-release'},
 state:{context:{releaseSha,operationId,workspace:'blackspire',principal:'zola-release'}}};
const runtime=()=>({applicationDbCredentialsAbsent:true,gatewayTransportVerified:true,arbitrarySqlDenied:true,
 arbitraryFunctionDenied:true,arbitraryUrlDenied:true});
const cleanScan=()=>({available:true,applicationPgNetCallSitesZero:true,callSiteCount:0,sourceScanDigest:'b'.repeat(64)});
const providerRows=()=>PROVIDER_ACL_FUNCTIONS.map(functionName=>({functionName,arguments:'',owner:'supabase_admin',
 publicExecute:true,ownerExecute:true,postgresExecute:true,serviceRoleExecute:true,writerExecute:true}));

test('deterministic source proof rejects a new production pg_net call site',()=>{
 const result=scanApplicationPgNetSource({files:{'apps/api/fixture.js':'await net.http_post(target)'}});
 assert.equal(result.available,true);assert.equal(result.applicationPgNetCallSitesZero,false);assert.equal(result.callSiteCount,1);
 assert.match(result.sourceScanDigest,/^[a-f0-9]{64}$/);
});

test('source proof uses an exact file allowlist rather than a test or directory exemption',()=>{
 assert.equal(scanApplicationPgNetSource({files:{'scripts/test-buyer-writer-acl.mjs':'pg_net'}}).applicationPgNetCallSitesZero,true);
 assert.equal(scanApplicationPgNetSource({files:{'scripts/new-test.mjs':'pg_net'}}).applicationPgNetCallSitesZero,false);
 assert.equal(scanApplicationPgNetSource({files:{'packages/new-observer.js':'net.http_get()'}}).applicationPgNetCallSitesZero,false);
});

test('repository source discovery includes untracked production files',()=>{
 const root=mkdtempSync(join(tmpdir(),'zola-pg-net-source-'));
 try{
  mkdirSync(join(root,'apps','api'),{recursive:true});execFileSync('/usr/bin/git',['init','--quiet'],{cwd:root});
  writeFileSync(join(root,'apps','api','untracked.js'),'net.http_post("forbidden")\n');
  const result=scanApplicationPgNetSource({root});
  assert.equal(result.available,true);assert.equal(result.applicationPgNetCallSitesZero,false);assert.equal(result.callSiteCount,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('isolation proof runs the fixed read-only application function-body observation',async()=>{
 let calls=0;
 const proof=createPgNetIsolationProof({query:async(sql,values)=>{
  calls++;assert.equal(sql,APPLICATION_FUNCTION_PG_NET_SQL);assert.deepEqual(values,[]);
  assert.match(sql,/pg_proc/);assert.doesNotMatch(sql,/\b(?:grant|revoke|alter|update|insert|delete|call)\b/i);return{rows:[]};
 },verifyRuntimeIsolation:async()=>runtime(),scanSource:cleanScan});
 const result=await proof();
 assert.equal(result.status,'PASS');assert.equal(result.evidence.pgNetIsolationVerified,true);
 assert.equal(result.evidence.applicationPgNetCallSitesZero,true);
 assert.equal(result.evidence.applicationDbPgNetReferencesZero,true);assert.equal(calls,1);
});

test('application function pg_net reference and unavailable catalog observation fail closed',async()=>{
 const offending=createPgNetIsolationProof({query:async()=>({rows:[{schemaName:'public',functionName:'dispatch',arguments:'',owner:'postgres'}]}),
  verifyRuntimeIsolation:async()=>runtime(),scanSource:cleanScan});
 const observed=await offending();assert.equal(observed.status,'BLOCKED_EXTERNAL');
 assert.equal(observed.evidence.applicationDbPgNetReferencesZero,false);
 const unavailable=createPgNetIsolationProof({query:async()=>{throw new Error('offline');},verifyRuntimeIsolation:async()=>runtime(),scanSource:cleanScan});
 assert.deepEqual(await unavailable(),{status:'BLOCKED_EXTERNAL'});
});

test('PUBLIC EXECUTE 12/12 passes only with every isolation proof and records provider risk',async()=>{
 const query=async(sql)=>sql===PROVIDER_ACL_CHECK_SQL?{rows:providerRows()}:{rows:[]};
 const isolationProof=createPgNetIsolationProof({query,verifyRuntimeIsolation:async()=>runtime(),scanSource:cleanScan});
 const passed=await createProviderAclCheckOperation({query,isolationProof}).check(args);
 assert.equal(passed.status,'PASS');assert.equal(passed.evidence.publicExecuteCount,12);
 assert.equal(passed.evidence.providerAcl,false);assert.equal(passed.evidence.providerAclObserved,true);
 assert.equal(passed.evidence.providerRisk,'PUBLIC_EXECUTE_EXTERNALLY_OPEN');assert.equal(passed.evidence.providerRiskRecorded,true);
 const incomplete=createPgNetIsolationProof({query,verifyRuntimeIsolation:async()=>({...runtime(),arbitraryUrlDenied:false}),scanSource:cleanScan});
 assert.deepEqual(await createProviderAclCheckOperation({query,isolationProof:incomplete}).check(args),{status:'BLOCKED_EXTERNAL'});
});
