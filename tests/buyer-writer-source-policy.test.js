import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveBuyerSources } from '../packages/buyer-writer/source-policy.js';

const hash=s=>createHash('sha256').update(s).digest('hex');
const row={id:'00000000-0000-4000-8000-000000000001',state:'NC',county:'Ashe',source_type:'arcgis',
  source_url:'https://source.example.invalid/MapServer/0/query?f=json',active:true,cash_disabled:false,created_at:'2026-01-01T00:00:00Z'};
const approval={sourceId:row.id,state:'NC',county:'Ashe',registeredSourceType:'arcgis',sourceUrlSha256:hash(row.source_url),
  createdAt:row.created_at,cashDisabled:false,adapterId:'ashe-v1',sourceType:'arcgis_ashe',method:'GET',pathTransform:'strip_query',timeoutMs:20000};
const resolve=(rows=[row],approved=[approval],job={state:'NC',county:'Ashe'})=>resolveBuyerSources({rows,approved,job});
test('reviewed source snapshot binds exact registry identity, URL bytes and normalization policy',()=>{
  const result=resolve();
  assert.equal(result.sources[0].sourceType,'arcgis_ashe');
  assert.equal(result.sources[0].cashDisabled,false);
  assert.equal(result.sources[0].url,'https://source.example.invalid/MapServer/0/query');
  assert.match(result.sources[0].endpointConfigDigest,/^[a-f0-9]{64}$/);
  assert.notEqual(resolve([row],[{...approval,adapterId:'ashe-v2'}]).sources[0].endpointConfigDigest,result.sources[0].endpointConfigDigest);
  assert.ok(Object.isFrozen(result.sources[0]));
});
test('unapproved, inactive, wrong-owner-context and drifted registry rows fail closed',()=>{
  for(const change of [{source_url:row.source_url+'&token=DO_NOT_OUTPUT'},{source_type:'json'},{cash_disabled:true},
    {active:false},{id:'00000000-0000-4000-8000-000000000002'},{state:'SC'},{county:'Avery'},{created_at:'invalid'},{created_at:'2026-02-01T00:00:00Z'}]) {
    assert.throws(()=>resolve([{...row,...change}]),error=>error.code==='SOURCE_POLICY_REJECTED'&&!error.message.includes('DO_NOT_OUTPUT'));
  }
  assert.throws(()=>resolve([],[]),{code:'SOURCE_POLICY_REJECTED'});
  assert.throws(()=>resolve([row],[]),{code:'SOURCE_POLICY_REJECTED'});
  assert.throws(()=>resolve([row,row]),{code:'SOURCE_POLICY_REJECTED'});
});
test('multiple canonical sources retain deterministic date/ID order and global cash policy',()=>{
  const second={...row,id:'00000000-0000-4000-8000-000000000002',cash_disabled:true};
  const a2={...approval,sourceId:second.id,cashDisabled:true};
  const result=resolve([second,row],[a2,approval]);
  assert.deepEqual(result.sources.map(s=>s.sourceId),[row.id,second.id]);assert.equal(result.cashDisabled,true);
  assert.equal(result.sources[0].cashDisabled,false);
  assert.throws(()=>resolve([row],[approval,a2]),{code:'SOURCE_POLICY_REJECTED'});
});
test('even reviewed URL hashes cannot authorize unsafe URL forms or unsupported transformations',()=>{
  for(const url of ['http://source.example.invalid/query','https://user:pass@source.example.invalid/query',
    'https://127.0.0.1/query','https://source.example.invalid:8443/query','https://source.example.invalid/query#fragment']) {
    assert.throws(()=>resolve([{...row,source_url:url}],[{...approval,sourceUrlSha256:hash(url)}]),{code:'SOURCE_POLICY_REJECTED'});
  }
  for(const change of [{method:'DELETE'},{pathTransform:'arbitrary'},{timeoutMs:60000},{sourceType:'unsafe value'}])
    assert.throws(()=>resolve([row],[{...approval,...change}]),{code:'SOURCE_POLICY_REJECTED'});
});
test('source ordering and approval retain PostgreSQL microsecond timestamp precision',()=>{
  const later={...row,created_at:'2026-01-01T00:00:00.000002Z'};
  const earlier={...row,id:'00000000-0000-4000-8000-000000000002',created_at:'2026-01-01 00:00:00.000001+00:00'};
  const approvals=[{...approval,createdAt:later.created_at},{...approval,sourceId:earlier.id,createdAt:earlier.created_at}];
  assert.deepEqual(resolve([later,earlier],approvals).sources.map(s=>s.sourceId),[earlier.id,later.id]);
  assert.throws(()=>resolve([{...later,created_at:'2026-01-01T00:00:00.000003Z'}],[approvals[0]]),{code:'SOURCE_POLICY_REJECTED'});
});
