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
