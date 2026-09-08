import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectSixReads, collectAdmissionDenial, readCases, validateCollectorConfig, verifyCollectedTask, digest } from '../packages/zola-six-reads/collector.js';
import { openCollectorJournal } from '../packages/zola-six-reads/collector-host.js';
import { createOfflineFixture, cases } from '../packages/zola-six-reads/offline.js';
import { blackspireCapabilityRegistry } from '../packages/capabilities/index.js';
import { validateCapabilityInput } from '../packages/capabilities/contract.js';
import { observationForResult } from '../packages/capabilities/read-observation.js';

const config = { version: 1, releaseSha: 'a'.repeat(40), frontendOrigin: 'https://frontend.invalid', workspace: 'six-read-fixture', principal: 'reader', deniedPrincipal: 'other', dealId: 'DE-0001', apiPid: 100, workerPid: 101, port: 8789, databasePath: '/does/not/exist.sqlite', credentialPath: '/does/not/exist.json', journalDirectory: '/does/not/exist', runId: 'fixture-run' };
const generation = { apiGeneration: 'b'.repeat(32), workerGeneration: 'c'.repeat(32), workerId: 'canonical-worker', apiPid: 100, workerPid: 101, apiStartTime: '1', workerStartTime: '2' };
const denialSnapshot=()=>({databaseIdentity:{device:1,inode:1},tables:['tasks','unified_inputs','provider_attempts','provider_usage'].map(name=>({name,rows:0,digest:'0'.repeat(64)}))});
async function fixture() {
  const offline = createOfflineFixture(), records = new Map(), events = []; let posts = 0;
  const store = { events: () => structuredClone(events), append: e => events.push(structuredClone(e)) };
  const host = {
    generation: async () => structuredClone(generation), deniedIdentity: async () => {}, lookup: key => records.get(key) ?? null,
    pause: async () => {}, disclosure: async () => {},
    denialSnapshot,denyAdmission:async()=>({authorityDenied:true,status:404}),
    async admit(body) {
      posts++;
      const index = readCases(config.dealId).findIndex(e => e.text === body.text), entry = cases[index], capability = blackspireCapabilityRegistry.get(entry.id);
      assert.equal(events.at(-1).type, 'intent', 'journal precedes admission');
      assert.deepEqual(Object.keys(body).sort(), ['channel','executionIntent','idempotencyKey','text','workspaceId']);
      const result = await capability.execute({ adapters: offline.adapters, workspace: { id: config.workspace }, signal: AbortSignal.timeout(2000) }, validateCapabilityInput(capability, entry.input));
      const task = { id: `task-${index}`, workspace_id: config.workspace, actor_id: config.principal, source_channel: 'jarvis', authority_class: 'authenticated_admin', execution_intent: 'read_only', idempotency_key: `unified:jarvis:${body.idempotencyKey}`, request: body.text, status: 'completed', worker_id: generation.workerId, claim_token: 'fixture-claim',
        evidence: JSON.stringify({ capabilityId: entry.id, readOnly: true, changedFiles: [], resultCount: 1, readObservation: observationForResult(result) }) };
      const attempts = [{ id: `receipt-${index}`, task_id: task.id, provider: 'blackspire-capability', mode: entry.id, status: 'completed', request_packet: JSON.stringify({ workspaceId: config.workspace, principalId: config.principal, workerId: generation.workerId, claimDigest: digest('fixture-claim') }), response_packet: JSON.stringify({ result }) }];
      records.set(body.idempotencyKey, { task, attempts }); return { taskId: task.id };
    },
  };
  return { host, store, events, records, posts: () => posts };
}

test('strict plan rejects arbitrary objectives, same-principal denial and unsafe frontend origin', () => {
  assert.equal(validateCollectorConfig(config).releaseSha, config.releaseSha);
  for (const change of [{ deniedPrincipal: config.principal }, { frontendOrigin: 'http://example.com' }, { frontendOrigin: 'https://example.com/path' }, { dealId: 'DE-0001; paid search' }, { text: 'arbitrary command' }, { releaseSha: 'main' }]) assert.throws(() => validateCollectorConfig({ ...config, ...change }));
  assert.equal(readCases(config.dealId).length, 6);
});
test('six actual synthetic route observations are collected; rerun never admits again; incomplete global evidence cannot PASS', async () => {
  const f = await fixture(); const report = await collectSixReads(config, f.host, f.store);
  assert.equal(report.results.length, 6); assert.equal(report.livePass, false); assert.equal(f.posts(), 6);
  assert.equal(report.results[5].nexusStoredContact, 'PRESENT');
  assert.equal(report.results.every(r => r.observedForbiddenAttempts === 0 && r.frontendSha === config.releaseSha), true);
  await collectSixReads(config, f.host, f.store); assert.equal(f.posts(), 6);
});
test('authenticated negative admission journals intent first and never repeats an uncertain POST',async()=>{
  for(const fault of ['lost','csrf','mutation','generation','confirmation']){
    const f=await fixture();let calls=0,snapshots=0,changed=false;
    f.host.denyAdmission=async()=>{calls++;assert.equal(f.events.at(-1).type,'denial_intent');if(fault==='lost')throw new Error('SECRET');changed=true;return{authorityDenied:true,status:fault==='csrf'?403:404};};
    f.host.denialSnapshot=()=>{const v=denialSnapshot();if(++snapshots>1&&fault==='mutation')v.tables[0].digest='1'.repeat(64);return v;};
    f.host.generation=async()=>changed&&fault==='generation'?{...generation,workerGeneration:'d'.repeat(32)}:generation;
    const append=f.store.append;f.store.append=e=>{if(fault==='confirmation'&&e.type==='denial_confirmed')throw new Error('disk');append(e);};
    await assert.rejects(collectAdmissionDenial(config,f.host,f.store,generation),/DENIAL_UNKNOWN_NO_RETRY/);
    await assert.rejects(collectAdmissionDenial(config,f.host,f.store,generation),/DENIAL_UNKNOWN_NO_RETRY/);
    assert.equal(calls,1);assert.equal(f.posts(),0);
  }
});
test('negative admission refuses missing observer, malformed state or unwritten intent before POST',async()=>{
  for(const fault of ['missing','malformed','journal']){
    const f=await fixture();let calls=0;f.host.denyAdmission=async()=>{calls++;return{authorityDenied:true,status:404};};
    if(fault==='missing')delete f.host.denialSnapshot;
    if(fault==='malformed')f.host.denialSnapshot=()=>({});
    if(fault==='journal')f.store.append=()=>{throw new Error('journal');};
    await assert.rejects(collectAdmissionDenial(config,f.host,f.store,generation));assert.equal(calls,0);
  }
});
test('retained negative admission cannot attest a principal that gained authority; no POST is repeated',async()=>{
  const f=await fixture();let posts=0;
  f.host.denyAdmission=async()=>{posts++;return{authorityDenied:true,status:404};};
  await collectAdmissionDenial(config,f.host,f.store,generation);
  f.host.denialSnapshot=()=>{throw new Error('DENIAL_PRINCIPAL_HAS_AUTHORITY');};
  await assert.rejects(collectAdmissionDenial(config,f.host,f.store,generation),/DENIAL_PRINCIPAL_HAS_AUTHORITY/);
  assert.equal(posts,1);
});
test('lost POST with durable task reconciles without redispatch', async () => {
  const f = await fixture(), admit = f.host.admit;
  f.host.admit = async body => { await admit(body); throw new Error('simulated lost response with secret text'); };
  const report = await collectSixReads(config, f.host, f.store);
  assert.equal(report.results.length, 6); assert.equal(f.posts(), 6);
  assert.equal(f.events.filter(e => e.type === 'admission_unknown').length, 6);
});
test('uncertain POST with absent exact key never retries, including safe rerun', async () => {
  const f = await fixture(); let calls = 0;
  f.host.admit = async () => { calls++; throw new Error('lost'); };
  await assert.rejects(collectSixReads(config, f.host, f.store), /ADMISSION_UNKNOWN_NO_RETRY/);
  await assert.rejects(collectSixReads(config, f.host, f.store), /ADMISSION_UNKNOWN_NO_RETRY/);
  assert.equal(calls, 1);
});
test('existing unjournaled task and altered binding are refused', async () => {
  const f = await fixture(); f.records.set(`zola-six:${config.runId}:0`, { task: {} });
  await assert.rejects(collectSixReads(config, f.host, f.store), /UNJOURNALED_EXISTING_TASK/); assert.equal(f.posts(), 0);
  await assert.rejects(collectSixReads({ ...config, workspace: 'foreign' }, f.host, f.store), /JOURNAL_CONFIG_MISMATCH/);
});
test('missing real denied principal refuses before any admission', async () => {
  const f = await fixture(); f.host.deniedIdentity = async () => { throw new Error('DENIAL_PRINCIPAL_UNAVAILABLE'); };
  await assert.rejects(collectSixReads(config, f.host, f.store), /DENIAL_PRINCIPAL_UNAVAILABLE/); assert.equal(f.posts(), 0);
});
test('changed worker generation refuses before admission', async () => {
  const f = await fixture(); let call = 0;
  f.host.generation = async () => ({ ...generation, workerGeneration: (++call === 1 ? 'c' : 'e').repeat(32) });
  await assert.rejects(collectSixReads(config, f.host, f.store), /GENERATION_CHANGED/); assert.equal(f.posts(), 0);
});
test('wrong frontend, principal, permission evidence, unbounded results or duplicate receipt cannot pass', async () => {
  const f = await fixture(); await collectSixReads(config, f.host, f.store);
  const key = `zola-six:${config.runId}:0`, record = f.records.get(key), entry = readCases(config.dealId)[0];
  for (const mutate of [
    r => { r.task.actor_id = 'foreign'; }, r => { r.attempts.push(r.attempts[0]); },
    r => { const e = JSON.parse(r.task.evidence); e.readObservation.releaseSha = 'e'.repeat(40); r.task.evidence = JSON.stringify(e); },
    r => { const e = JSON.parse(r.task.evidence); e.resultCount = 100; r.task.evidence = JSON.stringify(e); },
    r => { const e = JSON.parse(r.task.evidence); e.readObservation.forbiddenAttempts = 1; r.task.evidence = JSON.stringify(e); },
    r => { const p = JSON.parse(r.attempts[0].request_packet); p.workerId = 'e'.repeat(32); r.attempts[0].request_packet = JSON.stringify(p); },
  ]) { const bad = structuredClone(record); mutate(bad); assert.throws(() => verifyCollectedTask(bad, config, entry, key, generation)); }
});
test('durable journal rejects concurrent run, preserves intents across reopen, and refuses corruption', () => {
  const directory = fs.mkdtempSync(path.join(process.getuid() === 0 ? '/root' : os.tmpdir(), 'zola-collector-test-')); fs.chmodSync(directory, 0o700);
  try {
    let journal = openCollectorJournal(directory, 'run', { owner: process.getuid() });
    journal.append({ type: 'run', binding: digest(config) }); journal.append({ type: 'intent', key: 'stable-key' });
    assert.throws(() => openCollectorJournal(directory, 'run', { owner: process.getuid() }));
    assert.equal(fs.statSync(path.join(directory, 'run.jsonl')).mode & 0o777, 0o600); journal.close();
    journal = openCollectorJournal(directory, 'run', { owner: process.getuid() }); assert.equal(journal.events()[1].key, 'stable-key'); journal.close();
    fs.appendFileSync(path.join(directory, 'run.jsonl'), '{');
    assert.throws(() => openCollectorJournal(directory, 'run', { owner: process.getuid() }), /JOURNAL_TORN_WRITE/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('exact-key SQLite reconciliation reads a task beyond latest-50 and rejects changed input actor without writes', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
  const { openCollectorDatabaseReader } = await import('../packages/zola-six-reads/collector-host.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zola-collector-sqlite-'));
  const filename = path.join(root, 'command.sqlite'); let writer, reader;
  try {
    prepareDisposableDatabase(filename);
    writer = new DatabaseSync(filename);
    const stamp = new Date().toISOString();
    // Fixture-only persisted rows use the repository's approved disposable schema.
    writer.prepare('INSERT INTO workspaces(id,name,github_repository,root_path,provider_policy,budget_cents,created_at) VALUES(?,?,?,?,?,?,?)').run(config.workspace, 'fixture', 'owner/repo', '/fixture', '{}', 0, stamp);
    writer.prepare('INSERT INTO conversations(id,workspace_id,status,created_at,updated_at) VALUES(?,?,?,?,?)').run('fixture-conversation', config.workspace, 'active', stamp, stamp);
    writer.prepare('INSERT INTO unified_inputs(id,conversation_id,channel,actor_id,text,idempotency_key,policy_status,created_at) VALUES(?,?,?,?,?,?,?,?)').run('fixture-input', 'fixture-conversation', 'jarvis', config.principal, 'Show seller opportunities', 'exact-key', 'allowed', stamp);
    const insert = writer.prepare('INSERT INTO tasks(id,workspace_id,request,status,idempotency_key,budget_cents,retry_count,created_at,updated_at,actor_id,source_channel,authority_class,execution_intent,input_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    insert.run('exact-task', config.workspace, 'Show seller opportunities', 'queued', 'unified:jarvis:exact-key', 0, 0, stamp, stamp, config.principal, 'jarvis', 'authenticated_admin', 'read_only', 'fixture-input');
    for (let i = 0; i < 55; i++) insert.run(`newer-${i}`, config.workspace, 'fixture newer task', 'completed', `newer-key-${i}`, 0, 0, stamp, stamp, config.principal, 'jarvis', 'authenticated_admin', 'read_only', null);
    const dataVersion = writer.prepare('PRAGMA data_version').get().data_version;
    reader = openCollectorDatabaseReader({ ...config, databasePath: filename });
    assert.equal(reader.lookup('exact-key').task.id, 'exact-task');
    assert.equal(reader.lookup('not-present'), null);
    assert.equal(writer.prepare('PRAGMA data_version').get().data_version, dataVersion);
    writer.prepare("UPDATE unified_inputs SET actor_id='different' WHERE id='fixture-input'").run();
    assert.throws(() => reader.lookup('exact-key'), /INPUT_BINDING_MISMATCH/);
  } finally { reader?.close(); writer?.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('v2 database observation precedes admission, persists baseline, checks after and never overclaims attempt/egress evidence', async () => {
  const { DIVISION_TABLES } = await import('../packages/zola-six-reads/database-observer.js');
  const v2 = { ...config, version: 2, observerDatabaseConfigPath: '/protected/explicit.json' };
  assert.equal(validateCollectorConfig(v2).version, 2);
  const observed = phase => ({ snapshot: { version:1, releaseSha:config.releaseSha, runId:config.runId, phase,capturedAt:'2026-09-08T00:00:00Z',database:'postgres',role:'postgres',readOnly:true,primary:true,bypassRls:true,ordinaryTables:15,
    tables:DIVISION_TABLES.map(name=>({name,rows:1,digest:'a'.repeat(64),version_digest:'b'.repeat(64)})) },
    owner:{version:1,releaseSha:config.releaseSha,runId:config.runId,phase,capturedAt:'2026-09-08T00:00:00Z',database:'postgres',role:'authenticated',readOnly:true,witness:'e'.repeat(64),realDistinctUsers:true,ownVisible:1,foreignVisible:0} });
  const f=await fixture(), phases=[];
  f.host.observeDatabase=async phase=>{phases.push(phase);if(phase==='before')assert.equal(f.posts(),0);return observed(phase);};
  const report=await collectSixReads(v2,f.host,f.store);
  assert.equal(report.databaseEvidence.netMutationDelta,0);assert.equal(report.livePass,false);assert.deepEqual(phases,['before','after']);
  assert.equal(f.events.findIndex(e=>e.type==='database_before')<f.events.findIndex(e=>e.type==='intent'),true);
  await collectSixReads(v2,f.host,f.store);assert.deepEqual(phases,['before','after','after']);assert.equal(f.posts(),6);
  const misplaced=await fixture();misplaced.host.observeDatabase=async phase=>observed(phase);
  await collectSixReads(v2,misplaced.host,misplaced.store);
  const position=misplaced.events.findIndex(e=>e.type==='database_before');const [baseline]=misplaced.events.splice(position,1);misplaced.events.push(baseline);
  await assert.rejects(collectSixReads(v2,misplaced.host,misplaced.store),/DATABASE_OBSERVATION_AFTER_ADMISSION/);
  const extra=await fixture();extra.host.observeDatabase=async phase=>({...observed(phase),private:'must not persist'});
  await assert.rejects(collectSixReads(v2,extra.host,extra.store),/DATABASE_OBSERVATION_ENVELOPE/);assert.equal(extra.events.some(e=>e.type==='database_before'),false);
  const denied=await fixture();denied.host.observeDatabase=async phase=>{const v=observed(phase);v.owner.foreignVisible=1;return v;};
  await assert.rejects(collectSixReads(v2,denied.host,denied.store),/DATABASE_OWNER_DENIAL_FAILED/);assert.equal(denied.posts(),0);
  const mutated=await fixture();mutated.host.observeDatabase=async phase=>{const v=observed(phase);if(phase==='after')v.snapshot.tables[0].version_digest='f'.repeat(64);return v;};
  await assert.rejects(collectSixReads(v2,mutated.host,mutated.store),/DIVISION_ROWS_CHANGED/);
});

for (const version of [3,4]) test(`v${version} connected queries durably bracket six synthetic dispatches; replay preserves baseline and never claims release acceptance`, async () => {
  const { createJournaledConnectedObserver } = await import('../packages/zola-six-reads/database-connected.js');
  const { DIVISION_TABLES } = await import('../packages/zola-six-reads/database-observer.js');
  const v3 = validateCollectorConfig({ ...config, version, observerDatabaseConfigPath:'/explicit/protected/management-token.json', ...(version===4?{denialReceiptPath:'/explicit/protected/denial-receipt.json'}:{}) });
  const f = await fixture();let queries=0;
  f.host.observeDatabase=createJournaledConnectedObserver(v3,async query=>{
    queries++;
    const phase=query.includes("'phase','before'")?'before':'after';
    assert.equal(f.posts(),phase==='before'?0:6);
    const common={version:1,releaseSha:config.releaseSha,runId:config.runId,phase,capturedAt:new Date().toISOString(),database:'postgres',readOnly:true,
      collectorBinding:query.match(/'collectorBinding','([a-f0-9]{64})'/)[1]};
    return query.includes('AS version_digest')?{...common,role:'postgres',primary:true,bypassRls:true,ordinaryTables:15,
      tables:DIVISION_TABLES.map(name=>({name,rows:1,digest:'b'.repeat(64),version_digest:'c'.repeat(64)}))}:
      {...common,role:'authenticated',witness:'d'.repeat(64),realDistinctUsers:true,ownVisible:1,foreignVisible:0};
  });
  const report=await collectSixReads(v3,f.host,f.store);
  assert.equal(report.livePass,false);assert.equal(report.results.length,6);assert.equal(report.databaseEvidence.netMutationDelta,0);
  assert.equal(queries,4);assert.equal(f.posts(),6);
  const baseline=f.events.find(e=>e.type==='database_before');
  const queryResults=f.events.filter(e=>e.type==='database_query_result');assert.equal(queryResults.length,4);
  assert.ok(f.events.indexOf(baseline)<f.events.findIndex(e=>e.type==='intent'));
  const previousEvents=f.events.length;
  await assert.rejects(collectSixReads(v3,f.host,f.store),/CONNECTED_OBSERVER_INTERVAL_CLOSED/);assert.equal(queries,4);assert.equal(f.posts(),6);assert.equal(f.events.length,previousEvents);
  // A baseline altered before the after interval opens also fails restoration.
  f.events.splice(f.events.findIndex(e=>e.type==='database_query_intent' && e.binding.phase==='after'));
  baseline.observation.snapshot.tables[0].rows=2;
  await assert.rejects(collectSixReads(v3,f.host,f.store),/CONNECTED_OBSERVER_BASELINE_MISMATCH/);assert.equal(f.posts(),6);
});
