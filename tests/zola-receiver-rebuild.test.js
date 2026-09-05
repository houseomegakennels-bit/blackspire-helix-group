import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildReceivers } from '../scripts/zola-receiver-rebuild.mjs';
const MAIN = '53adf74e05c607c0d296923bae05d7ac023ecb57';
const PREVIEW = 'a'.repeat(40);
const SECRET = 'test-only-never-log-this-secret';
function harness({ drift = false, productionDrift = false, canceled = false, badIdentity = false, badProbe = false, badNegative = false, thrown = false } = {}) {
  const writes = [], emitted = [];
  let current;
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    if (thrown) throw new Error(SECRET);
    if (url.startsWith('https://api.github.com/')) return Response.json({ object: { type: 'commit', sha: url.endsWith('/main') ? (drift ? PREVIEW : MAIN) : PREVIEW } });
    if (url.includes('/deployments/blackspirehelix.com')) return Response.json({ id: productionDrift ? 'dpl_unexpected' : 'dpl_2x5G4LjirPMvNcwLZ7ccyxMm7efA',
      projectId: 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou', target: 'production', meta: { githubCommitSha: MAIN } });
    if (url.includes('/api/internal/')) {
      const body = JSON.parse(options.body);
      assert.equal(body.limit, 0);
      const status = body.workspaceId !== 'blackspire-command' || options.headers.Authorization !== `Bearer ${SECRET}` ? 404 : 400;
      return Response.json({}, { status: (badProbe || (badNegative && status === 404)) ? 200 : status });
    }
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); writes.push(body);
      current = { id: `dpl_test${writes.length}`, projectId: body.project, gitSource: body.gitSource,
        target: body.target ?? null, url: 'frontend-test.vercel.app', readyState: 'BUILDING' };
      return Response.json({ ...current, ...(badIdentity ? { gitSource: { ...body.gitSource, sha: 'b'.repeat(40) } } : {}) });
    }
    return Response.json({ ...current, readyState: canceled ? 'CANCELED' : 'READY' });
  };
  return { writes, emitted, run: () => rebuildReceivers({ vercelToken: SECRET, capabilityToken: SECRET,
    githubToken: SECRET, previewSha: PREVIEW, fetchImpl, audit: async () => ({ status: 'READY' }), sleep: async () => {}, emit: (entry) => emitted.push(entry) }) };
}
test('pinned preview precedes only pinned-main production and targets cannot drift', async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.status, 'READY');
  assert.equal(h.writes.length, 2);
  assert.equal(Object.hasOwn(h.writes[0], 'target'), false);
  assert.equal(h.writes[0].gitSource.sha, PREVIEW);
  assert.equal(h.writes[1].target, 'production');
  assert.equal(h.writes[1].gitSource.sha, MAIN);
  assert.ok(h.writes.every((body) => !Object.hasOwn(body, 'projectSettings')));
});
test('main ref drift prevents all deployment writes', async () => {
  const h = harness({ drift: true }); assert.equal((await h.run()).status, 'GIT REF DRIFT'); assert.equal(h.writes.length, 0);
});
test('a changed live production deployment prevents all deployment writes', async () => {
  const h = harness({ productionDrift: true });
  assert.equal((await h.run()).status, 'PRODUCTION DEPLOYMENT DRIFT');
  assert.equal(h.writes.length, 0);
});
test('canceled candidate cannot start production', async () => {
  const h = harness({ canceled: true }); assert.equal((await h.run()).status, 'DEPLOYMENT CANCELED'); assert.equal(h.writes.length, 1);
});
test('wrong deployment identity and receiver auth mismatch stop before production', async () => {
  for (const options of [{ badIdentity: true }, { badProbe: true }, { badNegative: true }]) {
    const h = harness(options); assert.notEqual((await h.run()).status, 'READY'); assert.equal(h.writes.length, 1);
  }
});
test('reports and transport exceptions do not expose credentials', async () => {
  for (const options of [{}, { thrown: true }]) {
    const h = harness(options); const result = await h.run();
    assert.ok(!JSON.stringify({ result, emitted: h.emitted }).includes(SECRET));
  }
});
