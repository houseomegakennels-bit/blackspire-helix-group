import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { supervise } from '../packages/zola-six-reads/supervise.js';
import { createOfflineFixture, runOffline, cases } from '../packages/zola-six-reads/offline.js';

function request(fixture, entry) {
  return fixture.transport(`https://offline.invalid${entry.route}`, { method: 'POST', headers: {
    'content-type': 'application/json', authorization: `Bearer ${fixture.token}`,
  }, body: JSON.stringify({ ...entry.input, ...(entry.id === 'buyer.matches.search' ? { matchesOnly: true } : {}), workspaceId: fixture.workspace }) });
}

test('six actual adapter/route contracts have typed bounded synthetic witnesses and honest scope', async () => {
  const report = await runOffline();
  assert.equal(report.evidence.length, 6);
  assert.equal(report.productionReady, false);
  assert.equal(report.paidProviderCalls, 0);
  assert.equal(report.enrichmentWrites, 0);
  for (const entry of report.evidence) {
    assert.equal(entry.status, 'PASS_OFFLINE_CONTRACT');
    assert.equal(entry.crossWorkspaceDenial, 'PASS');
    assert.equal(entry.invalidCredentialDenial, 'PASS');
    assert.match(entry.crossOwnerDenial, /^UNVERIFIED/);
    assert.ok(entry.boundedResultCount > 0 && entry.boundedResultCount <= 5);
  }
});

test('six actual SQL-backed handlers fail closed on fixture database failure', async () => {
  for (const entry of cases) {
    assert.equal((await request(createOfflineFixture({ databaseError: true }), entry)).status, 503, entry.id);
  }
});

test('database mutation attempts are observed even when the caller catches denial', () => {
  const fixture = createOfflineFixture();
  for (const operation of ['insert', 'update', 'upsert', 'delete']) {
    assert.throws(() => fixture.db.from('BuyerProfile')[operation]({}), /forbidden/);
  }
  assert.throws(() => fixture.db.rpc('unexpected'), /forbidden/);
  assert.equal(fixture.events.filter((event) => event.kind === 'database_mutation_attempt').length, 5);
  assert.throws(() => fixture.db.storage.from('unexpected'), /forbidden/);
  assert.equal(fixture.events.filter((event) => event.kind === 'storage_attempt').length, 1);
});

test('transport rejects unexpected origins, methods, and routes without network', async () => {
  const fixture = createOfflineFixture();
  for (const [url, method] of [['https://example.com', 'POST'], ['https://offline.invalid', 'DELETE'], ['https://offline.invalid/unexpected', 'POST']]) {
    await assert.rejects(fixture.transport(url, { method }));
  }
  assert.equal(fixture.events.length, 0);
});

test('strict Deal records rejects missing configuration, ordinary SQL errors and missing relation, preserving UI fallback', async () => {
  const source = fs.readFileSync(new URL('../frontend/src/lib/deal-engine-server.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function listDealEngineLeads(');
  const end = source.indexOf('\nexport async function listDealEngineSellerSignals', start);
  const body = stripTypeScriptTypes(source.slice(start, end).replace('export ', ''));
  for (const scenario of ['unconfigured', 'query-error', 'missing-relation', 'empty', 'rows']) {
    let fallbackCalls = 0;
    const error = ['query-error', 'missing-relation'].includes(scenario) ? { message: scenario } : null;
    const query = { select() { return query; }, order() { return query; }, limit: async () => ({ error, data: scenario === 'rows' ? [{ id: 'DE-0001' }] : [] }) };
    const helper = vm.runInNewContext(`${body}\nlistDealEngineLeads`, {
      getSupabaseAdmin: () => scenario === 'unconfigured' ? null : { from: () => query },
      listSellerLeads: async () => { fallbackCalls += 1; return []; },
      toDealLeadFromSellerHandoff: (row) => row, toLead: (row) => row,
      isMissingDealTableError: (value) => value?.message === 'missing-relation',
    });
    if (['unconfigured', 'query-error', 'missing-relation'].includes(scenario)) await assert.rejects(helper(5, { readOnly: true }), /unavailable/);
    else assert.equal((await helper(5, { readOnly: true })).length, scenario === 'rows' ? 1 : 0);
    assert.equal(fallbackCalls, 0);
    await helper(5);
    assert.equal(fallbackCalls, ['unconfigured', 'missing-relation'].includes(scenario) ? 1 : 0);
  }
});

test('one-command offline report is sanitized and rejects live arguments with nonzero status', () => {
  const script = new URL('../scripts/zola-six-read-offline.js', import.meta.url);
  const options = { encoding: 'utf8', timeout: 20_000, maxBuffer: 100_000, env: { PATH: '/usr/bin:/bin' } };
  const result = spawnSync(process.execPath, [script.pathname], options);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.productionReady, false);
  assert.equal(report.authority.evidence.length, 6);
  assert.equal(report.authority.lostResponseNotReplayed, 'PASS');
  for (const entry of report.authority.evidence) {
    for (const key of ['durableReceipt', 'attemptPersistedBeforeAdapter', 'duplicateDispatchPrevented', 'missingPermissionDenied', 'foreignWorkspaceDenied']) assert.equal(entry[key], 'PASS');
  }
  assert.doesNotMatch(result.stdout, /synthetic-capability-fixture-value|synthetic-offline-placeholder/);
  const rejected = spawnSync(process.execPath, [script.pathname, '--live'], options);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
});


test('actual analysis helper reads exact persisted inputs only, with no UI/Storage work', async () => {
  const entry = cases.find((item) => item.id === 'deal.analysis.get');
  const fixture = createOfflineFixture();
  const response = await request(fixture, entry);
  const result = await response.json();
  assert.equal(result.found, true);
  assert.equal(result.maximumAllowableOffer, 150000);
  assert.equal(result.estimatedArv, 230000);
  assert.equal(result.assignmentFeeTarget, 10000);
  const reads = fixture.events.filter((event) => event.kind === 'database_read');
  assert.deepEqual(reads.map((event) => event.table), ['deal_leads', 'deal_analysis']);
  assert.ok(reads.every((event) => event.limit === 1));
  assert.equal(fixture.events.filter((event) => /attempt$/.test(event.kind)).length, 0);
  for (const errorTable of ['deal_leads', 'deal_analysis']) {
    assert.equal((await request(createOfflineFixture({ errorTable }), entry)).status, 503);
  }
});

test('parent supervisor kills a synchronous infinite child and rejects excess output', async () => {
  const started = performance.now();
  await assert.rejects(supervise(['--eval', 'for (;;) {}'], { timeoutMs: 100 }), /deadline/);
  assert.ok(performance.now() - started < 3000);
  await assert.rejects(supervise(['--eval', 'process.stdout.write("x".repeat(10000))'], { maxBytes: 100 }), /output bound/);
  await assert.rejects(supervise(['--eval', 'process.exit(2)']), /failed/);
  assert.equal(await supervise(['--eval', 'process.stdout.write(String(process.env.COMMAND_ADMIN_TOKEN))']), 'undefined');
});
