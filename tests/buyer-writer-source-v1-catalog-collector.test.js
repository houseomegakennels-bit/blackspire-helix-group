import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBuyerWriterSourceV1Catalog,SOURCE_V1_CATALOG_SQL}
  from '../packages/buyer-writer/source-v1-catalog-collector.js';

const releaseSha='a'.repeat(40),artifactDigest='b'.repeat(64);
const credentialSourceDigest='c'.repeat(64),creatorOid=16388;
const ca='-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n';
const target={host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',ca};
const managementConfiguration={host:target.host,password:'protected-management-value',ca};
const row={sessionUser:'postgres',currentUser:'postgres',database:'postgres',
  serverVersionNum:170006,sessionUserOid:creatorOid,currentUserOid:creatorOid,
  creatorOid,creatorRole:'postgres',inRecovery:false};

function connection(value=row){
  const queries=[];let ended=0;
  return {queries,ended:()=>ended,connect:async credential=>{
    assert.equal(credential,managementConfiguration);
    return {query:async(text,values)=>{
      queries.push([text,values]);
      if(text===SOURCE_V1_CATALOG_SQL)return {rows:[value]};
      return {rows:[]};
    },end:async()=>{ended++;}};
  }};
}
test('collector authenticates postgres and returns exact in-memory evidence',async()=>{
  const f=connection();
  const result=await collectBuyerWriterSourceV1Catalog({releaseSha,artifactDigest,
    credentialSourceDigest,creatorOid,target,managementConfiguration},
  {connect:f.connect,now:()=>Date.UTC(2026,8,19,12)});
  assert.equal(result.authentication.authenticated,true);
  assert.equal(result.authentication.creatorOid,creatorOid);
  assert.equal(result.target.serverMajor,17);
  assert.equal(result.capturedAt,'2026-09-19T12:00:00.000Z');
  assert.deepEqual(f.queries.map(([text])=>text),['begin read only',
    "set local search_path=pg_catalog; set local statement_timeout='7s'; set local lock_timeout='1s'",
    SOURCE_V1_CATALOG_SQL,'rollback']);
  assert.deepEqual(f.queries[2][1],[]);assert.equal(f.ended(),1);
});

test('collector rejects identity, server, recovery, target and management drift',async()=>{
  const badRows=[
    {...row,currentUser:'other'},{...row,creatorOid:creatorOid+1},
    {...row,serverVersionNum:160000},{...row,inRecovery:true},
  ];
  for(const value of badRows){
    const f=connection(value);
    await assert.rejects(collectBuyerWriterSourceV1Catalog({releaseSha,artifactDigest,
      credentialSourceDigest,creatorOid,target,managementConfiguration},{connect:f.connect}),
    /catalog collection failed/);
    assert.equal(f.ended(),1);
  }
  const f=connection();
  await assert.rejects(collectBuyerWriterSourceV1Catalog({releaseSha,artifactDigest,
    credentialSourceDigest,creatorOid,target,
    managementConfiguration:{...managementConfiguration,host:'other.example'}},{connect:f.connect}),
  /catalog collection failed/);
  assert.equal(f.queries.length,0);
});

test('owned catalog evidence proves fresh descriptor identity with a distinct protocol',async()=>{
 const {createHash}=await import('node:crypto');
 const {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest}=await import('../packages/buyer-writer/owned-postgres.js');
 const {OWNED_DATABASE_IDENTITY_SQL}=await import('../packages/buyer-writer/database-profile.js');
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16401,systemIdentifier:'123456789',caSha256:createHash('sha256').update(ca).digest('hex')};
 const profileDigest=ownedPostgresProfileDigest(profile),ownedTarget={host:profile.host,port:profile.port,database:'postgres',ca,backendProfile:'owned-postgres-v1',profileDigest};
 const credential={host:profile.host,password:'owned-only',ca,backendProfile:'owned-postgres-v1',profileDigest};
 const identity={systemIdentifier:profile.systemIdentifier,database:'postgres',actor:'postgres',creatorOid:profile.creatorOid,version:170006,recovery:false};
 const ownedRow={...row,creatorOid:profile.creatorOid,currentUserOid:profile.creatorOid,sessionUserOid:profile.creatorOid};
 let ended=0,queries=[];
 const run=async(patch={})=>collectBuyerWriterSourceV1Catalog({releaseSha,artifactDigest,credentialSourceDigest,creatorOid:profile.creatorOid,target:ownedTarget,managementConfiguration:credential},{readProfile:()=>profile,connect:async connection=>{
  assert.equal(connection.port,55432);assert.equal(connection.user,'postgres');
  return {query:async text=>{queries.push(text);return {rows:text===OWNED_DATABASE_IDENTITY_SQL?[{...identity,...patch}]:text===SOURCE_V1_CATALOG_SQL?[ownedRow]:[]};},end:async()=>{ended++;}};
 }});
 const result=await run();assert.equal(result.version,2);assert.equal(result.target.profileDigest,profileDigest);assert.equal(result.target.systemIdentifier,profile.systemIdentifier);
 assert.ok(queries.includes(OWNED_DATABASE_IDENTITY_SQL));assert.equal(ended,1);
 queries=[];await assert.rejects(()=>run({systemIdentifier:'987654321'}),/catalog collection failed/);
 assert.equal(queries.includes(SOURCE_V1_CATALOG_SQL),false);assert.equal(ended,2);
});
