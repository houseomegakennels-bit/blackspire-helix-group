import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync('frontend/src/lib/deal-engine-server.ts', 'utf8');
const start = source.indexOf('export async function listWorkspaceDealPage(');
const end = source.indexOf('\n// Division totals', start);
const functionSource = stripTypeScriptTypes(source.slice(start, end).replace('export ', ''));

function reader({ count = 31, failure, missing = false } = {}) {
  const ranges = [], orders = [];
  const rows = Array.from({ length: count }, (_, index) => ({ id: `DE-${index}`, status: index < 6 ? 'Closed' : 'Needs Analysis' }));
  const db = { from(table) {
    assert.equal(table, 'deal_leads');
    const q = {
      select(fields, options) { q.head = options?.head; return q; },
      order(field, options) { orders.push([field, options.ascending]); return q; },
      range(first, last) { ranges.push([first, last]); q.slice = rows.slice(first, last + 1); return q; },
      then(resolve) { return Promise.resolve(q.head
        ? { count: failure === 'count' ? null : count, error: failure === 'count' ? {} : null }
        : { data: q.slice, error: failure === 'rows' ? {} : null }).then(resolve); },
    }; return q;
  } };
  const list = vm.runInNewContext(functionSource + '\nlistWorkspaceDealPage', {
    getSupabaseAdmin: () => missing ? null : db, toLead: row => row,
  });
  return { list, ranges, orders };
}

test('workspace pagination reaches active properties beyond the old six-record summary', async () => {
  const { list, ranges, orders } = reader();
  const first = await list(1), second = await list(2);
  assert.equal(first.leads.length, 24);
  assert.ok(first.leads.some(row => row.status === 'Needs Analysis'));
  assert.equal(first.pagination.total, 31);
  assert.equal(second.leads.length, 7);
  assert.equal(second.leads[0].id, 'DE-24');
  assert.deepEqual(ranges, [[0, 23], [24, 47]]);
  assert.deepEqual(orders.slice(0, 2), [['motivation_score', false], ['id', true]]);
});

test('invalid pages start at one and an out-of-range page clamps before querying rows', async () => {
  for (const page of [NaN, -1, 1.5, Infinity, 1_000_001]) {
    assert.equal((await reader().list(page)).pagination.page, 1);
  }
  const { list, ranges } = reader();
  assert.equal((await list(99)).pagination.page, 2);
  assert.deepEqual(ranges, [[24, 47]]);
});

test('empty results and unavailable reads are distinct', async () => {
  const empty = await reader({ count: 0 }).list();
  assert.equal(empty.pagination.available, true);
  assert.equal(empty.pagination.total, 0);
  for (const options of [{ failure: 'count' }, { failure: 'rows' }, { missing: true }]) {
    const unavailable = await reader(options).list();
    assert.equal(unavailable.pagination.available, false);
    assert.equal(unavailable.pagination.total, null);
    assert.equal(unavailable.leads.length, 0);
  }
});

const summaryStart = source.indexOf('async function loadDealEnginePipelineSummary(');
const summaryEnd = source.indexOf('// A public dashboard', summaryStart);
const summarySource = stripTypeScriptTypes(source.slice(summaryStart, summaryEnd).replace('export ', ''));

test('division totals include properties and fees past both UI and database page boundaries', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: `DE-${index}`, status: index === 1000 ? 'Marketed' : 'Needs Analysis', deal_analysis: [{ assignment_fee_target: index >= 24 ? 1 : null }] }));
  const ranges = [];
  let failSecondPage = false;
  const db = { from() { const q = {
    select(fields, options) { q.head = options?.head; return q; }, order() { return q; },
    then(resolve) { return Promise.resolve({ count: rows.length, error: null }).then(resolve); },
    async range(first, last) { ranges.push([first, last]); return failSecondPage && first > 0 ? { error: {} } : { data: rows.slice(first, last + 1), error: null }; },
  }; return q; } };
  const summary = vm.runInNewContext(summarySource + '\nloadDealEnginePipelineSummary', {
    getSupabaseAdmin: () => db, normalizeStage: status => status === 'Marketed' ? 'Buyer Follow-Up' : 'Underwriting',
    asSingle: value => value[0], nullableMoney: value => value == null ? null : Number(value),
    formatCurrency: value => value == null ? 'Not entered' : `$${value}`,
  });
  const result = await summary();
  assert.equal(result.totalDeals, 1001);
  assert.equal(result.projectedAssignmentFees, '$977');
  assert.equal(result.buyerFollowUps, 1);
  assert.deepEqual(ranges, [[0, 999], [1000, 1000]]);
  failSecondPage = true;
  assert.equal(await summary(), null, 'never publish partial totals when a later page fails');
});

test('division dashboard consumes pipeline totals independently of the operator page', async () => {
  const divisionSource = fs.readFileSync('frontend/src/lib/real-estate-intelligence.ts', 'utf8');
  const body = stripTypeScriptTypes(divisionSource.slice(divisionSource.indexOf('export async function getRealEstateDivisionSnapshot(')).replace('export ', ''));
  let totals = { totalDeals: 31, projectedAssignmentFees: '$500', buyerFollowUps: 7 };
  const dashboard = vm.runInNewContext(body + '\ngetRealEstateDivisionSnapshot', {
    getHarvesterWorkspaceSnapshot: async () => null, listSellerLeads: async () => [], getNexusSnapshot: async () => null,
    getDealEnginePipelineSummary: async () => totals, listAllBuyerReports: async () => ({ reports: [] }), realEstateEngines: [], ecosystemProjects: [],
  });
  const values = () => dashboard().then(result => Object.fromEntries(result.metrics.map(metric => [metric.label, metric.value])));
  let metrics = await values();
  assert.equal(metrics['Properties in Deal Engine'], '31');
  assert.equal(metrics['Projected Assignment Fees'], '$500');
  assert.equal(metrics['Buyer Follow-Ups'], '07');
  totals = null;
  metrics = await values();
  assert.equal(metrics['Properties in Deal Engine'], 'Unavailable');
  assert.equal(metrics['Projected Assignment Fees'], 'Unavailable');
});

test('public summary rejects oversized pipelines and has a strict query budget', async () => {
  let count = 5001, reads = 0;
  const db = { from() { const q = {
    select() { return q; }, order() { return q; },
    then(resolve) { return Promise.resolve({ count, error: null }).then(resolve); },
    async range() { reads += 1; return { data: [{ status: 'Needs Analysis', deal_analysis: null }], error: null }; },
  }; return q; } };
  const summary = vm.runInNewContext(summarySource + '\nloadDealEnginePipelineSummary', {
    getSupabaseAdmin: () => db, normalizeStage: () => 'Underwriting', asSingle: () => null,
    nullableMoney: () => null, formatCurrency: () => 'Not entered',
  });
  assert.equal(await summary(), null);
  assert.equal(reads, 0, 'oversized pipeline must not start transferring rows');
  count = 20;
  assert.equal(await summary(), null);
  assert.equal(reads, 5, 'a reduced server row cap must not cause unbounded requests');
});

test('public summary configures a five-minute cache scoped to its data source', async () => {
  const start = source.indexOf('export async function getDealEnginePipelineSummary(');
  const end = source.indexOf('\nexport async function listDealEngineSellerSignals(', start);
  let options, keys;
  const loader = async () => ({ totalDeals: 12 });
  const summary = vm.runInNewContext(stripTypeScriptTypes(source.slice(start, end).replace('export ', '')) + '\ngetDealEnginePipelineSummary', {
    process: { env: { SUPABASE_URL: 'https://fictional.invalid' } }, loadDealEnginePipelineSummary: loader,
    unstable_cache: (fn, cacheKeys, config) => { assert.equal(fn, loader); keys = cacheKeys; options = config; return fn; },
  });
  assert.equal((await summary()).totalDeals, 12);
  assert.equal(options.revalidate, 300);
  assert.equal(keys[1], 'https://fictional.invalid');
});
