import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileKnownCanary } from '../scripts/zola-routing-canary-reconcile.mjs';
const versionId = '2a1d0b0b-e755-4438-899e-0327dd69621e', nonce = '64f900b8de032db89be7d8a682070094', token = 'synthetic-secret-do-not-emit';
function fixture(mode) {
  let discarded = mode === 'already-absent', observations = 0; const calls = [], journal = [];
  const route = { id: 'the-route', name: `ZOLA routing canary ${nonce}`, enabled: true, route: { src: `^/zola-routing-canary-${nonce}$`, status: 418, headers: { 'x-zola-routing-canary': nonce, 'cache-control': 'no-store' } } };
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body });
    assert.equal(url.origin, 'https://api.vercel.com'); assert.equal(url.searchParams.get('teamId'), 'team_CaRyRaulJaFnCLSfTdyRYNIW'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, `Bearer ${token}`);
    const response = value => new Response(JSON.stringify(value));
    if (options.method === 'POST') {
      assert.equal(url.pathname.endsWith('/routes/versions'), true); assert.deepEqual(JSON.parse(options.body), { id: versionId, action: 'discard' });
      if (mode === 'uncertain-not-applied') throw new Error(token);
      discarded = true; if (mode === 'lost-discard') throw new Error(token); if (mode === 'no-content') return new Response(null, { status: 204 }); return response({});
    }
    assert.equal(options.method, 'GET');
    if (url.pathname.endsWith('/versions')) {
      const row = { id: versionId, isStaging: true, isLive: false };
      if (mode === 'ambiguous') delete row.isStaging;
      if (mode === 'live') { row.isLive = true; row.isStaging = false; }
      if (mode === 'drift' && observations > 1) row.ruleCount = 3;
      return response({ versions: discarded ? [] : [row] });
    }
    if (url.searchParams.has('versionId')) {
      assert.equal(url.searchParams.get('versionId'), versionId);
      if (discarded || mode === '404-only') return new Response(null, { status: 404 });
      const value = structuredClone(route);
      if (mode === 'extra-field') value.route.dest = 'https://attacker.test';
      if (mode === 'wrong-bytes') value.route.headers['x-zola-routing-canary'] = token;
      return response({ version: { id: versionId, ...(mode === 'contradictory-version' ? { isLive: true } : {}) }, routes: [value] });
    }
    observations++;
    return response({ routes: mode === 'live-default' ? [route] : [], version: mode === 'live-default' ? { id: versionId } : null });
  };
  return { fetchImpl, record: value => journal.push(value), calls, journal };
}
test('reads explicit versionId for staged bytes while default GET remains live; exact staged discard never promotes', async () => {
  const f = fixture(); const result = await reconcileKnownCanary({ token, discard: true, ...f });
  assert.equal(result.status, 'KNOWN_STAGE_DISCARDED'); assert.equal(result.routingPublished, false); assert.equal(result.applicationDenialProven, false);
  assert.equal(f.calls.filter(row => row.method === 'POST').length, 1); assert.equal(f.journal.filter(row => row.event === 'discard_intent').length, 1);
  assert.equal(f.calls.filter(row => new URL(row.url).searchParams.has('versionId')).length, 3);
});
test('inspection mode uses only GET and sanitized diagnostics exclude arbitrary values', async () => {
  for (const mode of [undefined, 'wrong-bytes']) {
    const f = fixture(mode); const result = await reconcileKnownCanary({ token, ...f });
    assert.equal(result.status, mode ? 'INCOMPLETE' : 'KNOWN_STAGE_VERIFIED'); assert.equal(f.calls.some(row => row.method !== 'GET'), false);
    assert.equal(JSON.stringify(f.journal).includes(token), false); assert.equal(JSON.stringify(result).includes(token), false);
  }
});
test('unknown staging identity, live stage, changed baseline, extra route fields and concurrent drift never discard', async () => {
  for (const mode of ['ambiguous','live','live-default','extra-field','wrong-bytes','drift','404-only','contradictory-version']) {
    const f = fixture(mode); const result = await reconcileKnownCanary({ token, discard: true, ...f });
    assert.equal(result.status, 'INCOMPLETE', mode); assert.equal(f.calls.some(row => row.method !== 'GET'), false, mode);
  }
});
test('lost discard acknowledgement and empty 204 response use read-only confirmation without POST retry', async () => {
  for (const mode of ['lost-discard', 'no-content']) {
    const f = fixture(mode); const result = await reconcileKnownCanary({ token, discard: true, ...f });
    assert.equal(result.status, 'KNOWN_STAGE_DISCARDED'); assert.equal(result.discardAttempted, true);
    assert.equal(result.discardResponseUnknown, mode === 'lost-discard' ? true : undefined);
    assert.equal(f.calls.filter(row => row.method === 'POST').length, 1); assert.equal(JSON.stringify(f.journal).includes(token), false);
  }
});
test('a replay proves stage absent through liveempty, complete history and explicit version404; 404 alone cannot pass', async () => {
  const f = fixture('already-absent'); const result = await reconcileKnownCanary({ token, discard: true, ...f });
  assert.equal(result.status, 'KNOWN_STAGE_ABSENT'); assert.equal(result.discardAttempted, false); assert.equal(f.calls.some(row => row.method !== 'GET'), false);
});

test('uncertain discard that did not apply remains incomplete after read-only reconciliation', async () => {
  const f = fixture('uncertain-not-applied'); const result = await reconcileKnownCanary({ token, discard: true, ...f });
  assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.code, 'DISCARD_NOT_CONFIRMED');
  assert.equal(f.calls.filter(row => row.method !== 'GET').length, 1);
});
