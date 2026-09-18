import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
 buildBuyerWriterProductionPreflight,runBuyerWriterProductionPreflight,
} from '../scripts/lib/buyer-writer-production-preflight.mjs';

const target=Object.freeze({
 version:1,environment:'production',host:'db.kchtrvfcixnimvxxctkj.supabase.co',
 port:5432,database:'postgres',actor:'postgres',creatorOid:16388,serverMajor:17,
});
const managementPath='/var/lib/blackspire-operator/buyer-writer-management.json';
const fixedNow=()=>new Date('2026-09-18T00:00:00.000Z');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const impact=Object.freeze({
 version:1,capturedAt:'2026-09-18T00:00:00.000Z',targetDescriptorSha256:digest(target),
 installerSha256:'b7a39ddf38357bd67eeebceed73a7e0ba054c9f2856dee96f17c53b1f2f3e2a1',
 unexpectedRoles:[],unexpectedObjects:[],unexpectedAclDeltas:[],unexpectedDefaultPrivilegeDeltas:[],
 unexpectedExtensionDeltas:[],unexpectedPublicDatabasePrivilegeDeltas:[],
 plannedPublicDatabasePrivilegeDeltas:['postgres:PUBLIC:CREATE:revoke','postgres:PUBLIC:TEMPORARY:revoke'],
 restoreManifest:null,
});
const options=mode=>({
 mode,target:{...target},impactManifest:structuredClone(impact),managementConfigPath:managementPath,now:fixedNow,
});
const expectedIdentity={
 actor:'postgres',database:'postgres',creatorOid:16388,serverMajor:17,
 superuser:false,createRole:true,createDb:true,replication:true,bypassRls:true,
};

test('offline preflight validates immutable contracts and has no connection capability',async()=>{
 let called=false;
 const report=await runBuyerWriterProductionPreflight(options('apply'));
 assert.equal(report.status,'READY_OFFLINE');
 assert.equal(report.executionClassification,'IRREVERSIBLE_FORWARD_ONLY');
 assert.equal(report.impact.exactRestoreAvailable,false);
 assert.deepEqual(report.impact.unexpectedCounts,
  {roles:0,objects:0,acl:0,defaultPrivileges:0,extensions:0,publicDatabasePrivileges:0});
 assert.deepEqual(report.impact.plannedPublicDatabasePrivilegeDeltas,
  ['postgres:PUBLIC:CREATE:revoke','postgres:PUBLIC:TEMPORARY:revoke']);
 assert.equal(report.executed,false);
 assert.equal(report.connectionAttempted,false);
 assert.equal(called,false);
 assert.deepEqual(report.target.expectedIdentity,expectedIdentity);
 assert.equal(report.contracts.installerSha256,'b7a39ddf38357bd67eeebceed73a7e0ba054c9f2856dee96f17c53b1f2f3e2a1');
 assert.deepEqual(report.contracts.authentication,[
  'buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission_login',
 ]);
 assert.equal(report.plan.some(row=>row.id==='canonical-installer'&&row.checkpoint==='roles installed NOLOGIN'),true);
 assert.equal(report.rollback.some(row=>row.action==='reconnect, disable logins, re-observe'),true);
 const serialized=JSON.stringify(report);
 assert.equal(serialized.includes(managementPath),false);
 assert.equal(serialized.includes('password'),false);
 assert.equal(report.safety.networkCapability,'absent');
 assert.equal(Object.isFrozen(report),true);
});

test('each production mode receives the matching transaction and rollback plan',()=>{
 const inspect=buildBuyerWriterProductionPreflight(options('inspect'));
 const verify=buildBuyerWriterProductionPreflight(options('verify'));
 const rollback=buildBuyerWriterProductionPreflight(options('rollback'));
 const reconcile=buildBuyerWriterProductionPreflight(options('reconcile'));
 assert.equal(inspect.plan.some(row=>row.mutation),false);
 assert.deepEqual(inspect.plan,verify.plan);
 assert.equal(rollback.plan.filter(row=>row.mutation).length,1);
 assert.equal(rollback.plan.some(row=>row.id==='canonical-installer'),false);
 assert.equal(reconcile.plan.some(row=>row.id==='bind-credentials-and-grants'
  &&row.transaction==='single transaction'),true);
 assert.equal(inspect.executionClassification,'READ_ONLY');
 assert.equal(rollback.executionClassification,'FAIL_CLOSED_ONLY');
 const reversible=buildBuyerWriterProductionPreflight({...options('apply'),impactManifest:{
  ...structuredClone(impact),restoreManifest:{version:1,exact:true,sha256:'a'.repeat(64),
   coverage:['roles','objects','acl','defaultPrivileges','extensions','publicDatabasePrivileges']},
 }});
 assert.equal(reversible.executionClassification,'REVERSIBLE_WITH_EXACT_RESTORE');
 assert.equal(reversible.impact.exactRestoreAvailable,true);
});
test('target and protected-input validation reject drift and secret-shaped descriptors',()=>{
 const cases=[
  {...target,host:'db.example.test'},
  {...target,serverMajor:16},
  {...target,creatorOid:0},
  {...target,password:'must-not-be-accepted'},
 ];
 for(const value of cases)assert.throws(
  ()=>buildBuyerWriterProductionPreflight({...options('apply'),target:value}),
  error=>error.message==='Buyer writer production preflight failed',
 );
 const impactDrift=[
  {...structuredClone(impact),unexpectedRoles:['buyer_writer_owner']},
  {...structuredClone(impact),unexpectedObjects:['buyer_writer.operation_admissions']},
  {...structuredClone(impact),unexpectedAclDeltas:['PUBLIC:EXECUTE']},
  {...structuredClone(impact),unexpectedDefaultPrivilegeDeltas:['PUBLIC:EXECUTE']},
  {...structuredClone(impact),unexpectedExtensionDeltas:['pg_net:update']},
  {...structuredClone(impact),unexpectedPublicDatabasePrivilegeDeltas:['postgres:PUBLIC:CONNECT:grant']},
  {...structuredClone(impact),plannedPublicDatabasePrivilegeDeltas:[]},
  {...structuredClone(impact),targetDescriptorSha256:'0'.repeat(64)},
 ];
 for(const value of impactDrift)assert.throws(
  ()=>buildBuyerWriterProductionPreflight({...options('apply'),impactManifest:value}),
  /production preflight failed/,
 );
 for(const value of ['relative.json','/'])assert.throws(
  ()=>buildBuyerWriterProductionPreflight({...options('apply'),managementConfigPath:value}),
  /production preflight failed/,
 );
 assert.throws(()=>buildBuyerWriterProductionPreflight(options('destroy')),/production preflight failed/);
});

test('only an explicit caller-supplied executor can attest an observation',async()=>{
 let calls=0;
 const report=await runBuyerWriterProductionPreflight({...options('verify'),executor:async request=>{
  calls++;
  assert.equal(request.kind,'buyer-writer-production-identity-probe');
  assert.equal(request.mutationAllowed,false);
  assert.equal(request.credentialsProvided,false);
  assert.deepEqual(request.expectedIdentity,expectedIdentity);
  assert.equal(JSON.stringify(request).includes(managementPath),false);
  return {...expectedIdentity};
 }});
 assert.equal(calls,1);
 assert.equal(report.status,'READY_EXECUTOR_ATTESTED');
 assert.equal(report.executed,true);
 assert.equal(report.connectionAttempted,true);
 assert.equal(report.executorEvidence.identityVerified,true);
 assert.equal(report.safety.networkCapability,'caller-supplied-only');
 await assert.rejects(
  runBuyerWriterProductionPreflight({...options('verify'),executor:async()=>({...expectedIdentity,createRole:false})}),
  error=>error.message==='Buyer writer production preflight failed',
 );
 await assert.rejects(
  runBuyerWriterProductionPreflight({...options('verify'),executor:'connect'}),
  /production preflight failed/,
 );
});

test('CLI emits a redacted mode-0600 evidence file and exposes no executor switch',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-preflight-'));
 try{
  const descriptor=path.join(temporary,'target.json');
  const impactPath=path.join(temporary,'impact.json');
  const evidence=path.join(temporary,'evidence.json');
  fs.writeFileSync(descriptor,JSON.stringify(target),{mode:0o600});
  fs.writeFileSync(impactPath,JSON.stringify(impact),{mode:0o600});
  const cli=new URL('../scripts/preflight-buyer-writer-production.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[cli.pathname,'--mode','apply','--target',descriptor,
   '--impact-manifest',impactPath,'--management-config',managementPath,'--output',evidence],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const stdout=JSON.parse(result.stdout);
  const stored=JSON.parse(fs.readFileSync(evidence,'utf8'));
  assert.deepEqual(stored,stdout);
  assert.equal(stdout.status,'READY_OFFLINE');
  assert.equal(stdout.connectionAttempted,false);
  assert.equal(fs.statSync(evidence).mode&0o777,0o600);
  const combined=result.stdout+fs.readFileSync(evidence,'utf8');
  assert.equal(combined.includes(managementPath),false);
  assert.equal(combined.includes('password'),false);

  const refused=spawnSync(process.execPath,[cli.pathname,'--connect'],{encoding:'utf8'});
  assert.notEqual(refused.status,0);
  assert.match(refused.stderr,/no connection was attempted/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
