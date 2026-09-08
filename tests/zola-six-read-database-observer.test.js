import test from 'node:test';
import assert from 'node:assert/strict';
import { DIVISION_TABLES, divisionSnapshotSQL, ownerWitnessSQL, validateDivisionSnapshot, validateOwnerWitness, compareDivisionSnapshots, queryObservation } from '../packages/zola-six-reads/database-observer.js';
const config = { releaseSha: 'a'.repeat(40), runId: 'fixture' };
const snapshot = phase => ({ version:1,...config,phase,capturedAt: phase==='before'?'2026-09-08T00:00:00Z':'2026-09-08T00:00:01Z',database:'postgres',role:'postgres',readOnly:true,primary:true,bypassRls:true,ordinaryTables:15,
  tables:DIVISION_TABLES.map(name=>({name,rows:1,digest:'a'.repeat(64),version_digest:'b'.repeat(64)})) });
const owner = phase => ({version:1,...config,phase,capturedAt:'2026-09-08T00:00:00Z',database:'postgres',role:'authenticated',readOnly:true,witness:'e'.repeat(64),realDistinctUsers:true,ownVisible:1,foreignVisible:0});

test('fixed observer SQL binds identifiers, timeouts, read-only rollback and hashes, with no row/identity output',()=>{
  const sql=divisionSnapshotSQL(config,'before');
  assert.match(sql,/REPEATABLE READ READ ONLY/);assert.match(sql,/statement_timeout = '15s'/);assert.match(sql,/LIMIT 250001/);assert.match(sql,/xmin::text/);assert.ok(sql.endsWith('ROLLBACK;'));
  assert.equal((sql.match(/FROM public\./g)??[]).length,15);
  const witness=ownerWitnessSQL(config,'after');assert.match(witness,/SET LOCAL ROLE authenticated/);assert.match(witness,/JOIN auth.users/);
  assert.equal(witness.split('\n').some(line=>line.startsWith('SELECT set_config(')),false);
  for(const change of [{releaseSha:"';COMMIT;"},{runId:"bad'"}]) assert.throws(()=>divisionSnapshotSQL({...config,...change},'before'));
  assert.throws(()=>ownerWitnessSQL(config,'arbitrary'));
});
test('full-row snapshot accepts equal multiset and tuple versions; rejects row/version/coverage/binding/overflow drift',()=>{
  assert.equal(compareDivisionSnapshots(snapshot('before'),snapshot('after'),config).netMutationDelta,0);
  for(const mutate of [v=>v.tables.pop(),v=>v.tables[0].rows=250001,v=>v.tables[0].name=v.tables[1].name,v=>v.readOnly=false,v=>v.bypassRls=false,v=>v.primary=false,v=>v.phase='before',v=>v.extra='private',v=>v.tables[0].extra='private',v=>v.capturedAt=123,v=>v.releaseSha='c'.repeat(40)]) {
    const v=snapshot('after');mutate(v);assert.throws(()=>validateDivisionSnapshot(v,config,'after'));
  }
  for(const mutate of [v=>v.tables[0].rows++,v=>v.tables[0].digest='c'.repeat(64),v=>v.tables[0].version_digest='c'.repeat(64)]) {
    const v=snapshot('after');mutate(v);assert.throws(()=>compareDivisionSnapshots(snapshot('before'),v,config),/DIVISION_ROWS_CHANGED/);
  }
  const old=snapshot('after');old.capturedAt='2026-09-07T00:00:00Z';assert.throws(()=>compareDivisionSnapshots(snapshot('before'),old,config),/TIME_ORDER/);
});
test('owner witness requires positive real owner, distinct actual user, real role and exact foreign denial',()=>{
  assert.equal(validateOwnerWitness(owner('before'),config,'before').foreignVisible,0);
  for(const change of [{ownVisible:0},{foreignVisible:1},{role:'postgres'},{realDistinctUsers:false},{readOnly:false},{witness:'x'}]) assert.throws(()=>validateOwnerWitness({...owner('before'),...change},config,'before'));
});
test('native observation selects one final allowlisted result; uncertainty is sanitized and rolled back',async()=>{
  const calls=[];const client={query:async sql=>{calls.push(sql);return [{rows:[{configured:true}]},{rows:[{observation:snapshot('before')}]},{rows:[]}];}};
  assert.equal((await queryObservation(client,'fixed query')).phase,'before');assert.deepEqual(calls,['fixed query','ROLLBACK']);
  const failure=[];await assert.rejects(queryObservation({query:async sql=>{failure.push(sql);throw new Error('private password and row');}},'fixed query'),/DATABASE_OBSERVATION_FAILED/);assert.deepEqual(failure,['fixed query','ROLLBACK']);
  await assert.rejects(queryObservation({query:async()=>({rows:[{observation:{},raw:'private'}]})},'fixed query'),/DATABASE_OBSERVATION_FAILED/);
});
