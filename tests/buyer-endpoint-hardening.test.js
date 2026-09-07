import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

import { createDivisionAdapters } from '../packages/capabilities/http-adapters.js';

const routeSource = fs.readFileSync(new URL('../frontend/src/app/api/internal/capabilities/buyer-profiles/route.ts', import.meta.url), 'utf8');
const dealRouteSource = fs.readFileSync(new URL('../frontend/src/app/api/internal/capabilities/deal-analysis/route.ts', import.meta.url), 'utf8');
const engineSource = fs.readFileSync(new URL('../frontend/src/lib/buyer-engine-server.ts', import.meta.url), 'utf8');

// Execute the actual server helpers with synthetic database dependencies. Node's
// built-in type stripping keeps this behavioral lane independent of Next/npm installs.
function loadHelper(name, nextDeclaration, dependencies) {
  const start = engineSource.indexOf(`export async function ${name}(`);
  const end = engineSource.indexOf(nextDeclaration, start);
  assert.ok(start >= 0 && end > start, `missing source boundary for ${name}`);
  const source = engineSource.slice(start, end).replace('export async function', 'async function');
  return vm.runInNewContext(`${stripTypeScriptTypes(source)}\n${name}`, dependencies);
}

function buyerFixture({ enabled = true, profileError = null, countError = null, registryError = null, profiles = [], registry = [] } = {}) {
  let seedCalls = 0;
  const reads = [];
  const supabase = {
    from(table) {
      let countOnly = false;
      const orders = [];
      let limit = Infinity;
      const query = {
        select(_columns, options) { countOnly = options?.head === true; return query; },
        order(column, options) { orders.push({ column, ...options }); return query; },
        limit(value) { limit = value; return query; },
        ilike() { return query; }, eq() { return query; }, contains() { return query; },
        then(resolve, reject) {
          reads.push(table);
          const orderedProfiles = [...profiles].sort((a, b) => {
            for (const { column, ascending = true, nullsFirst = false } of orders) {
              const left = a[column]; const right = b[column];
              if (left === right) continue;
              if (left == null) return nullsFirst ? -1 : 1;
              if (right == null) return nullsFirst ? 1 : -1;
              return (left < right ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          }).slice(0, limit);
          return Promise.resolve(table === 'buyer_group_registry'
            ? { data: registry, error: registryError }
            : countOnly ? { count: profiles.length, error: countError } : { data: orderedProfiles, error: profileError }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const dependencies = {
    getEnvState: () => ({ enabled }),
    getSupabaseAdmin: () => { if (!enabled) throw new Error('synthetic missing configuration'); return supabase; },
    normalizeCountyName: (value) => value.toLowerCase(),
    resolveBuyerCounty: () => ({ core: 'forsyth', display: 'Forsyth' }),
    resolvePropertyTypeBucket: () => 'residential',
    scoreBuyerProfile: () => ({ score: 80, reasons: ['Synthetic persisted buyer'] }),
    classifyBuyerType: () => 'cash_buyer',
    mapBuyerGroupRow: (row) => row,
    isMissingRelationError: (message) => message.includes('does not exist'),
    seedBuyerGroupRows: () => { seedCalls += 1; return []; },
    ensureBuyerGroupRegistrySeeded: async (_db, rows) => { seedCalls += 1; return rows; },
  };
  dependencies.listBuyerGroupRegistry = loadHelper('listBuyerGroupRegistry', '\nexport async function importBuyerGroupRegistryCsv', dependencies);
  return {
    profiles: loadHelper('listBuyerProfilesForCapability', '\nfunction classifyBuyerType', dependencies),
    matches: loadHelper('matchBuyersForProperty', '\nconst getCachedCountyCapabilities', dependencies),
    registry: dependencies.listBuyerGroupRegistry,
    seedCalls: () => seedCalls,
    reads,
  };
}

test('Buyer capability profiles reject missing configuration and query failure', async () => {
  await assert.rejects(buyerFixture({ enabled: false }).profiles({ limit: 5 }), /unavailable/);
  await assert.rejects(buyerFixture({ profileError: { message: 'synthetic query failure' } }).profiles({ limit: 5 }), /synthetic query failure/);
  assert.equal((await buyerFixture().profiles({ limit: 5 })).length, 0);
});

test('Buyer capability profile limits select stable IDs across purchase-count ties', async () => {
  const tied = Array.from({ length: 14 }, (_, index) => ({
    id: `buyer-${String(index + 1).padStart(2, '0')}`, purchase_count: 3,
  }));
  const highest = { id: 'buyer-highest', purchase_count: 9 };
  const unknown = { id: 'buyer-00', purchase_count: null };
  const expected = ['buyer-highest', 'buyer-01', 'buyer-02', 'buyer-03'];
  for (const profiles of [
    [unknown, ...tied.toReversed(), highest],
    [...tied.slice(7), highest, ...tied.slice(0, 7), unknown],
  ]) {
    const fixture = buyerFixture({ profiles });
    const result = await fixture.profiles({ limit: 4 });
    assert.deepEqual(Array.from(result, (row) => row.id), expected);
    assert.equal(fixture.seedCalls(), 0);
  }
});

test('read-only Buyer matching rejects each failed persisted data source', async () => {
  for (const options of [
    { enabled: false },
    { profileError: { message: 'synthetic profile failure' } },
    { countError: { message: 'synthetic count failure' } },
    { registryError: { message: 'synthetic registry failure' } },
    { registryError: { message: 'relation buyer_group_registry does not exist' } },
  ]) {
    const fixture = buyerFixture(options);
    await assert.rejects(fixture.matches({ county: 'Forsyth', limit: 5 }, { readOnly: true }));
    assert.equal(fixture.seedCalls(), 0);
  }
});

test('read-only Buyer registry rejects missing configuration without synthetic fallback', async () => {
  const fixture = buyerFixture({ enabled: false });
  await assert.rejects(fixture.registry(false, { readOnly: true }), /unavailable/);
  assert.equal(fixture.seedCalls(), 0);
});

test('read-only Buyer matching accepts empty persisted rows without seeding', async () => {
  const fixture = buyerFixture();
  const result = await fixture.matches({ county: 'Forsyth', limit: 5 }, { readOnly: true });
  assert.equal(result.matches.length, 0);
  assert.equal(result.buyerCount, 0);
  assert.equal(fixture.seedCalls(), 0);
  assert.ok(fixture.reads.includes('buyer_group_registry'));
});

test('read-only Buyer matching returns persisted profiles and institutional groups without seeding', async () => {
  const fixture = buyerFixture({
    profiles: [{ id: 'buyer-1', buyer_name: 'Persisted buyer', purchase_count: 3 }],
    registry: [{ id: 'group-1', canonicalName: 'Persisted group', counties: ['Forsyth'], active: true }],
  });
  const result = await fixture.matches({ county: 'Forsyth', limit: 5 }, { readOnly: true });
  assert.deepEqual(Array.from(result.matches, (row) => row.buyerId), ['buyer-1', 'group-1']);
  assert.equal(result.buyerCount, 1);
  assert.equal(fixture.seedCalls(), 0);
});

test('existing UI Buyer registry keeps its seeding behavior outside read-only mode', async () => {
  const fixture = buyerFixture();
  await fixture.registry(false);
  assert.equal(fixture.seedCalls(), 1);
});

function reportFixture(operatorId = 'operator-a', queryError = null) {
  const rows = [
    { id: 'foreign', search_job_id: 'job-b', mailing_address_snapshot: 'foreign private address', owner: 'operator-b' },
    { id: 'own-1', search_job_id: 'job-a', owner: 'operator-a' },
    { id: 'own-2', search_job_id: 'job-a', owner: 'operator-a' },
    { id: 'orphan', search_job_id: null, owner: null },
  ];
  let reads = 0;
  const dependencies = {
    getEnvState: () => ({ enabled: true }),
    getAuthenticatedOperator: async () => operatorId ? { id: operatorId } : null,
    getSupabaseAdmin: () => ({ from() {
      let selection = ''; const filters = []; let start = 0; let end = rows.length;
      const query = {
        select(value) { selection = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order() { return query; },
        range(first, last) { start = first; end = last + 1; return query; },
        limit(limit) { end = limit; return query; },
        then(resolve, reject) {
          reads += 1;
          const visible = rows.filter((row) => filters.every(([key, value]) => {
            // Embedded filters without !inner do not restrict parent rows.
            if (key === 'SearchJob.user_id') return !selection.includes('SearchJob!inner(user_id)') || row.owner === value;
            return row[key] === value;
          }));
          return Promise.resolve({ data: visible.slice(start, end), count: visible.length, error: queryError }).then(resolve, reject);
        },
      };
      return query;
    } }),
  };
  return {
    list: loadHelper('listBuyerReports', '\nexport async function listAllBuyerReports', dependencies),
    page: loadHelper('listAllBuyerReports', '\nexport async function listExports', dependencies),
    reads: () => reads,
  };
}

test('Buyer report reads deny foreign jobs while preserving own reports', async () => {
  const fixture = reportFixture();
  assert.equal((await fixture.list('job-b')).length, 0);
  assert.deepEqual(Array.from(await fixture.list('job-a'), (row) => row.id), ['own-1', 'own-2']);
  const deniedPage = await fixture.page({ searchJobId: 'job-b' });
  assert.equal(deniedPage.reports.length, 0);
  assert.equal(deniedPage.total, 0);
});

test('Buyer report ownership applies before exact counts and pagination', async () => {
  const result = await reportFixture().page({ limit: 1, offset: 1 });
  assert.deepEqual(Array.from(result.reports, (row) => row.id), ['own-2']);
  assert.equal(result.total, 2);
  assert.equal(result.limit, 1);
  assert.equal(result.offset, 1);
});

test('Buyer report helpers deny anonymous reads before service-role query', async () => {
  const fixture = reportFixture(null);
  assert.equal((await fixture.list('job-a')).length, 0);
  const page = await fixture.page();
  assert.equal(page.total, 0);
  assert.equal(page.reports.length, 0);
  assert.equal(fixture.reads(), 0);
});

test('Buyer report query failures propagate rather than return success', async () => {
  const fixture = reportFixture('operator-a', { message: 'synthetic report failure' });
  await assert.rejects(fixture.list('job-a'), /synthetic report failure/);
  await assert.rejects(fixture.page(), /synthetic report failure/);
});

test('Buyer internal endpoint is server-only, authorized, bounded, and read-only', () => {
  assert.match(routeSource, /import "server-only"/);
  assert.match(routeSource, /authorizeInternalCapability\(request, input\.workspaceId\)/);
  assert.match(routeSource, /limit < 1 \|\| limit > 10/);
  assert.doesNotMatch(routeSource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.doesNotMatch(routeSource, /primary_phone|primary_email|mailing_address_snapshot/);
  assert.match(routeSource, /\.from\("deal_leads"\)[\s\S]*\.eq\("id", opportunityId\.toUpperCase\(\)\)[\s\S]*\.limit\(1\)/);
  assert.match(routeSource, /matchBuyersForProperty/);
  assert.match(routeSource, /matchBuyersForProperty\([^\n]*\{ readOnly: true \}\)/);
});

test('Deal analysis capability disables UI scaffold persistence on its read path', () => {
  assert.match(dealRouteSource, /getDealEngineDealDetail\(dealId, \{ persistScaffold: false \}\)/);
});

test('Buyer adapter preserves bounded profile and match inputs over HTTP', async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ profiles: [], matches: [], sourceSnapshotAt: new Date().toISOString() }));
  };
  const adapter = createDivisionAdapters({ BLACKSPIRE_BUYER_CAPABILITY_URL: 'https://buyer.example', BLACKSPIRE_BUYER_CAPABILITY_TOKEN: 'x' }, fetchImpl).buyerProfiles;
  await adapter({ workspaceId: 'ws', county: 'Forsyth', limit: 4, signal: null });
  await adapter({ workspaceId: 'ws', opportunityId: 'DE-2417', matchesOnly: true, limit: 3, signal: null });
  assert.deepEqual(bodies, [
    { workspaceId: 'ws', county: 'Forsyth', limit: 4 },
    { workspaceId: 'ws', opportunityId: 'DE-2417', matchesOnly: true, limit: 3 },
  ]);
});
