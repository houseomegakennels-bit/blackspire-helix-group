import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCanary, runCanary } from '../scripts/zola-routing-canary.mjs';
const sha = 'a'.repeat(40), nonce = 'b'.repeat(32), token = 'synthetic-secret-never-print';
const inventory = { projectId: 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou', teamId: 'team_CaRyRaulJaFnCLSfTdyRYNIW', observations: ['deployments','domains','aliases'].map(name => ({ name, status: 'COMPLETE', value: { paginationComplete: true } })), deployments: [{ url: 'candidate.vercel.app', state: 'READY', sha }, { url: 'recovery.vercel.app', state: 'READY', sha: '2c0b600c268faa0571f08322e16d7f81f37789be' }], domains: [{ name: 'example.com' }], aliases: [{ alias: 'alias.vercel.app' }] };
const plan = prepareCanary({ inventory, sha, nonce });
function fixture(mode) {
  let rows = [], version = null;
  if (mode === 'existing-canary') { rows = [{ ...structuredClone(plan.add.route), id: 'route-one' }]; version = { id: 'version-one', isLive: true, isStaging: false }; }
  const calls = [], journal = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body });
    if (url.origin !== 'https://api.vercel.com') {
      assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Authorization, undefined);
      assert.equal(url.pathname, plan.path);
      if (mode === 'probe-error') throw new Error(token);
      const active = rows.length && version?.isLive;
      return new Response('', { status: active && mode !== 'miss' ? 418 : 404, headers: active && mode !== 'marker-missing' ? { 'x-zola-routing-canary': nonce } : {} });
    }
    assert.equal(options.headers.Authorization, `Bearer ${token}`); assert.equal(options.redirect, 'error'); assert.equal(url.searchParams.get('teamId'), inventory.teamId);
    const response = data => new Response(JSON.stringify(data));
    if (options.method === 'GET') {
      if (url.pathname.endsWith('/versions')) return response({ versions: mode === 'staged' || (mode === 'late-staging' && rows.length) ? [{ id: 'foreign', isStaging: true }] : version ? [version] : [] });
      if (mode === 'baseline-nonempty' && rows.length === 0) return response({ routes: [{ id: 'foreign' }], version: null });
      return response({ routes: rows, version });
    }
    if (options.method === 'POST' && !url.pathname.endsWith('/versions')) {
      assert.deepEqual(JSON.parse(options.body), plan.add);
      if (mode === 'post-lost') throw new Error(token);
      rows = [{ ...structuredClone(plan.add.route), id: 'route-one' }]; if (mode === 'route-extra') rows[0].route.methods = ['POST']; version = { id: 'version-one', isStaging: true };
      if (mode === 'add-response-lost') throw new Error(token);
      return response({ route: rows[0], version });
    }
    if (options.method === 'DELETE') {
      assert.deepEqual(JSON.parse(options.body), { routeIds: ['route-one'] }); rows = []; version = { id: 'version-two', isStaging: true }; return response({ version });
    }
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body); assert.equal(body.id, version.id);
    if (body.action === 'discard') { rows = []; version = null; }
    else { version = { ...version, isLive: true, isStaging: false }; if (mode === 'drift') rows.push({ id: 'foreign' }); if (mode === 'promote-response-lost' && version.id === 'version-one') throw new Error(token); }
    return response({ version });
  };
  return { fetchImpl, record: event => journal.push(event), journal, calls };
}
test('one exact random path, complete deployment/domain/alias union; rejects partial/foreign inventories', () => {
  assert.equal(plan.hosts.length, 4); assert.equal(plan.applicationDenialProven, false);
  assert.equal(new RegExp(plan.add.route.route.src).test('/api/nexus/trace'), false);
  for (const input of [{ ...inventory, projectId: 'other' }, { ...inventory, observations: [] }, { ...inventory, deployments: [] }, { ...inventory, aliases: [{ alias: 'example.com@attacker.test' }] }]) assert.throws(() => prepareCanary({ inventory: input, sha, nonce }));
});
test('actual management state machine stages, verifies, promotes, probes all host classes, deletes ONLY canary and verifies restore', async () => {
  const f = fixture(); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.status, 'CANARY_COVERAGE_PASS'); assert.equal(result.restored, true); assert.equal(result.probes.length, 12); assert.equal(result.applicationDenialProven, false);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET').map(c => c.method), ['POST','POST','DELETE','POST']);
  assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(f.journal).includes(token), false);
  assert.equal(f.journal.filter(e => e.event === 'mutation_intent').length, 4);
});
test('404, missing nonce marker and inaccessible hosts cannot pass; successfully published failed probes still restore', async () => {
  for (const mode of ['miss','marker-missing','probe-error']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f }); assert.equal(result.status, 'INCOMPLETE');
    if (mode !== 'probe-error') assert.equal(result.restored, true);
    else assert.equal(f.calls.some(c => c.method === 'POST'), false);
  }
});
test('foreign staging or existing routing stops before mutation; concurrent drift is never overwritten', async () => {
  for (const mode of ['staged','baseline-nonempty','drift']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f }); assert.equal(result.status, 'INCOMPLETE');
    assert.equal(f.calls.some(c => ['PUT','DELETE'].includes(c.method)), false);
    if (mode !== 'drift') assert.equal(f.calls.some(c => c.method === 'POST'), false);
  }
});
test('uncertain POST is never retried; errors sanitized and authority plan cannot broaden', async () => {
  const f = fixture('post-lost'); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.status, 'INCOMPLETE'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1); assert.equal(JSON.stringify(result).includes(token), false);
  const widened = structuredClone(plan); widened.add.route.route.src = '.*';
  await assert.rejects(runCanary({ plan: widened, token, ...fixture() }), /PLAN_SCOPE_MISMATCH/);
});

test('lost add and promote responses reconcile staged/live metadata and never discard a live version', async () => {
  for (const mode of ['add-response-lost', 'promote-response-lost']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f });
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.restored, true);
    const mutations = f.calls.filter(c => c.method !== 'GET');
    assert.equal(mutations.filter(c => new URL(c.url).pathname.endsWith('/routes') && c.method === 'POST').length, 1);
    if (mode === 'promote-response-lost') { assert.ok(mutations.some(c => c.method === 'DELETE')); assert.ok(mutations.every(c => !c.body.includes('discard'))); }
    else assert.ok(mutations.some(c => c.body.includes('discard')));
  }
});
test('unrecognized route fields and late concurrent staging stop before promotion or destructive cleanup', async () => {
  for (const mode of ['route-extra', 'late-staging']) {
    const f = fixture(mode); const result = await runCanary({ plan, token, ...f });
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.restored, false);
    assert.equal(f.calls.filter(c => c.method !== 'GET').length, 1);
  }
});

test('explicit crash cleanup only removes exact prior canary and cannot introduce or promote a canary', async () => {
  const f = fixture('existing-canary'); const result = await runCanary({ plan, token, ...f, cleanupOnly: true });
  assert.equal(result.status, 'CANARY_RESTORED'); assert.equal(result.applicationDenialProven, false);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET').map(c => c.method), ['DELETE','POST']);
  const absent = fixture(); const stopped = await runCanary({ plan, token, ...absent, cleanupOnly: true });
  assert.equal(stopped.status, 'INCOMPLETE'); assert.equal(absent.calls.filter(c => c.method !== 'GET').length, 0);
});

test('same-head normal rerun only recovers prior exact canary and stops without another experiment', async () => {
  const f = fixture('existing-canary'); const result = await runCanary({ plan, token, ...f });
  assert.equal(result.status, 'RECOVERED_PRIOR_CANARY'); assert.equal(result.restored, true);
  assert.equal(result.coveragePass, undefined); assert.equal(result.applicationDenialProven, false);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET').map(c => c.method), ['DELETE','POST']);
  assert.ok(result.probes.every(row => row.phase === 'after'));
});
