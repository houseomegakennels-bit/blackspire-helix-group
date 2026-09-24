import test from 'node:test';
import assert from 'node:assert/strict';
import {OWNED_POSTGRES_TARGET} from '../packages/buyer-writer/owned-postgres.js';
import {verifyOwnedDatabaseBoundary,verifyOwnedDatabaseAclResult,OWNED_DATABASE_ACL_SQL,ownedDatabaseAclParameters} from '../packages/buyer-writer/owned-database-evidence.js';
import {writerEvidenceFixture} from './helpers/owned-writer-evidence-fixture.js';
const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16388,systemIdentifier:'1234567890123456789',caSha256:'a'.repeat(64)};
const boundary=()=>({database:'postgres',actor:'postgres',sessionActor:'postgres',creatorOid:'16388',databaseOwnerOid:'16388',systemIdentifier:profile.systemIdentifier,
 serverVersion:170006,recovery:false,readOnly:true,managementSuperuser:false,extensions:['plpgsql'],netSchemas:0,networkRoutines:0,foreignDataWrappers:0,foreignServers:0,foreignTables:0,userMappings:0});
const observation=()=>{const writer=writerEvidenceFixture();writer.pgNet=writer.pgNet.map(row=>({...row,signature:null,owner:null,publicExecute:false,ownerExecute:false,runtimeExecute:false,issuerExecute:false,admissionExecute:false}));return {rows:[{boundary:boundary(),writer}]};};

test('owned evidence proves actual cluster and complete canonical writer isolation, never a provider ACL fix',()=>{
 const result=verifyOwnedDatabaseAclResult(observation(),profile);
 assert.equal(result.kind,'owned-postgres-isolation-v1');assert.equal(result.pgNetAbsent,true);assert.equal(result.writerIsolationVerified,true);
 assert.equal(Object.hasOwn(result,'providerAcl'),false);assert.equal(Object.hasOwn(result,'functionCount'),false);
 assert.equal(ownedDatabaseAclParameters(profile)[0],profile.creatorOid);
 assert.match(OWNED_DATABASE_ACL_SQL,/pg_control_system/);
});
test('empty, wrong cluster, wrong owner, writable, replica or foreign/network catalog evidence fails closed',()=>{
 for(const change of [{systemIdentifier:'987654321'}, {creatorOid:'10'}, {databaseOwnerOid:'10'}, {database:'other'}, {actor:'buyer_writer_runtime'},
  {sessionActor:'blackspire_cluster_admin'}, {managementSuperuser:true},{recovery:true},{readOnly:false},{serverVersion:170005},{extensions:[]},{extensions:['plpgsql','dblink']},
  ...['netSchemas','networkRoutines','foreignDataWrappers','foreignServers','foreignTables','userMappings'].map(key=>({[key]:1})),{extra:0}])
  assert.throws(()=>verifyOwnedDatabaseBoundary({...boundary(),...change},profile));
 for(const result of [null,{}, {rows:[]},{rows:[{}]},{rows:[observation().rows[0],observation().rows[0]]}])assert.throws(()=>verifyOwnedDatabaseAclResult(result,profile));
});
test('owned profile does not excuse existing role, relation, sequence, trigger, routine or pg_net authority',()=>{
 const mutations=[w=>w.roles.pop(),w=>{w.roles[0].superuser=true;},w=>w.directRelations.push({}),w=>w.directSequences.push({}),
  w=>w.targetPublicRelations.push({}),w=>{w.relationPolicySafe=false;},w=>{w.routinePolicySafe=false;},w=>{w.ownerPolicySafe=false;},
  w=>w.externalRoutines.push({}),w=>{w.pgNet[0].signature='net.http_get(text)';w.pgNet[0].owner='postgres';},w=>w.pgNet.pop()];
 for(const mutate of mutations){const value=observation();mutate(value.rows[0].writer);assert.throws(()=>verifyOwnedDatabaseAclResult(value,profile));}
});

test('composed release ACL stage records owned isolation without relabeling legacy provider evidence',async()=>{
 const {createProviderAclCheckOperation}=await import('../packages/zola-release/production-acl-writer.js');
 const {databaseProfileDigest}=await import('../packages/buyer-writer/database-profile.js');
 const isolation={pgNetIsolationVerified:true,applicationDbCredentialsAbsent:true,gatewayTransportVerified:true,arbitrarySqlDenied:true,
  arbitraryFunctionDenied:true,arbitraryUrlDenied:true,applicationPgNetCallSitesZero:true,applicationDbPgNetReferencesZero:true,
  applicationPgNetCallSiteCount:0,applicationDbPgNetReferenceCount:0,sourceScanDigest:'a'.repeat(64),functionBodyDigest:'b'.repeat(64)};
 const input={releaseSha:'a'.repeat(40),workspace:'zola-production',principal:'blackspire-release-root',backendProfile:'owned-postgres-v1',profileDigest:databaseProfileDigest(profile)};
 const args={input,state:{context:{...input,operationId:'11111111-1111-4111-8111-111111111111'}}};
 const raw=observation();let response={backendProfile:'owned-postgres-v1',profile,profileDigest:databaseProfileDigest(profile),observation:raw,evidence:verifyOwnedDatabaseAclResult(raw,profile)};
 const op=createProviderAclCheckOperation({backendProfile:input.backendProfile,profileDigest:input.profileDigest,query:async()=>response,isolationProof:async()=>({status:'PASS',evidence:isolation})});
 const result=await op.check(args);assert.equal(result.status,'PASS');assert.equal(result.evidence.ownedBackendObserved,true);
 assert.equal(result.evidence.providerAclObserved,false);assert.equal(result.evidence.providerAcl,false);assert.equal(Object.hasOwn(result.evidence,'functionCount'),false);
 await assert.rejects(op.check({...args,input:{...input,backendProfile:undefined,profileDigest:undefined}}));
 response={...response,profileDigest:'f'.repeat(64)};await assert.rejects(op.check(args));
 response={...response,profileDigest:databaseProfileDigest(profile),observation:{rows:[]}};assert.equal((await op.check(args)).status,'BLOCKED_EXTERNAL');
});
