import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync(new URL('../frontend/src/lib/deal-engine-server.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function getDealEngineDealDetail(');
const end = source.indexOf('\nexport async function getDealEngineDealRoomBySlug', start);
assert.ok(start >= 0 && end > start);
const helper = stripTypeScriptTypes(source.slice(start, end).replace('export async function', 'async function'));

// Execute the real detail helper; only database and presentation dependencies are synthetic.
// The target is deliberately below the historical top-100 cutoff.
function fixture({ enabled = true, failTable = null, missing = false, missingAnalysis = false } = {}) {
  const target = { id: 'DE-9999', motivation_score: 1 };
  const rows = [...Array.from({ length: 100 }, (_, i) => ({ id: `DE-${1000 + i}`, motivation_score: 1000 - i })), target];
  const reads = [];
  let listCalls = 0;
  let mutations = 0;
  const mutate = () => { mutations += 1; throw new Error('unexpected mutation'); };
  const client = {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; }, eq(column, value) { filters.push([column, value]); return query; },
        in() { return query; }, order() { return query; }, maybeSingle() { return query; },
        insert: mutate, update: mutate, upsert: mutate, delete: mutate,
        then(resolve, reject) {
          reads.push({ table, filters });
          const data = table === 'deal_leads'
            ? (missing ? null : rows.find((row) => filters.every(([key, value]) => row[key] === value)) ?? null)
            : table === 'deal_analysis' && !missingAnalysis ? { maximum_allowable_offer: 123456 } : null;
          return Promise.resolve({ data, error: table === failTable ? { message: `synthetic ${table} failure` } : null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const dependencies = {
    getSupabaseAdmin: () => enabled ? client : null,
    listDealEngineLeads: async (limit) => { listCalls += 1; return missing ? [] : rows.slice(0, limit); },
    toLead: (row) => ({ ...row, propertyAddress: 'Synthetic address' }),
    listDealEngineSellerSignals: async () => [], listDealEngineBuyerSignals: async () => [], listOutreachDraftRecords: async () => [],
    findSellerSignalForLead: () => null, rankBuyerSignalsForLead: () => [], buildContractDrafts: () => [],
    buildUnderwritingSnapshot: (_lead, analysis) => ({ maximumAllowableOffer: analysis?.maximum_allowable_offer ?? 0 }),
    buildSellerContactProfile: () => ({}), buildSellerContactWorkflow: () => ({}), buildSellerOutreach: () => ({}),
    buildFallbackCoordination: () => ({}), buildFallbackPacket: () => ({}), buildFallbackRoom: () => ({}),
    findNexusContactForDeal: async () => null, mergeNexusContactProfile: (profile) => profile,
    enrichPacketWithSellerContactStatus: (packet) => packet,
    syncDealBuyerMatches: mutate, ensureDealExecutionScaffold: mutate,
    buildDefaultContactOperatorTask: () => ({ title: 'Synthetic contact task' }), buildDealAutomationWorkflow: () => ({}),
  };
  return { detail: vm.runInNewContext(`${helper}\ngetDealEngineDealDetail`, dependencies), reads, listCalls: () => listCalls, mutations: () => mutations };
}

test('read-only Deal detail resolves an exact persisted ID beyond the top 100 without mutation', async () => {
  const f = fixture();
  const result = await f.detail('DE-9999', { persistScaffold: false });
  assert.equal(result?.lead.id, 'DE-9999');
  assert.equal(result.underwriting.maximumAllowableOffer, 123456);
  assert.equal(f.listCalls(), 0);
  assert.deepEqual(f.reads.find((read) => read.table === 'deal_leads').filters, [['id', 'DE-9999']]);
  assert.equal(f.mutations(), 0);
});

test('read-only Deal detail distinguishes a genuinely absent persisted ID from unavailable storage', async () => {
  const absent = fixture({ missing: true });
  assert.equal(await absent.detail('DE-9999', { persistScaffold: false }), null);
  assert.equal(absent.listCalls(), 0);
});

test('read-only Deal detail rejects missing configuration before synthetic fallback', async () => {
  await assert.rejects(fixture({ enabled: false }).detail('DE-9999', { persistScaffold: false }), /unavailable/i);
});

test('read-only Deal detail preserves computed underwriting when persisted analysis is absent', async () => {
  const f = fixture({ missingAnalysis: true });
  const result = await f.detail('DE-9999', { persistScaffold: false });
  assert.equal(result.lead.id, 'DE-9999');
  assert.equal(result.underwriting.maximumAllowableOffer, 0);
  assert.equal(f.mutations(), 0);
});

for (const table of ['deal_leads', 'deal_packets', 'deal_analysis', 'contracts', 'deal_rooms', 'disposition_logs']) {
  test(`read-only Deal detail rejects ${table} errors without synthetic success or writes`, async () => {
    const f = fixture({ failTable: table });
    await assert.rejects(f.detail('DE-9999', { persistScaffold: false }), /unavailable/i);
    assert.equal(f.mutations(), 0);
  });
}
