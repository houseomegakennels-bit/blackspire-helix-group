import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = fs.readFileSync('frontend/src/lib/deal-engine-server.ts', 'utf8');
const start = source.indexOf('export async function listWorkspaceDealPage(');
const end = source.indexOf('\nexport async function listDealEngineSellerSignals(', start);
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
