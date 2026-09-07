import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryProtection } from '../scripts/zola-vercel-protection-inventory.mjs';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const token = 'synthetic-inventory-secret-never-emit';
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fixture(override = () => undefined) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(url.origin, 'https://api.vercel.com');
    assert.equal(url.searchParams.get('teamId'), TEAM);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.body, undefined);
    const custom = override(url, options);
    if (custom !== undefined) return custom;
    if (url.pathname === `/v9/projects/${PROJECT}`) return response({ id: PROJECT, accountId: TEAM, passwordProtection: { password: token }, protectionBypass: { [token]: {} } });
    if (url.pathname === '/v6/deployments') return response({ deployments: [{ uid: 'dpl_one' }], pagination: { next: null } });
    if (url.pathname.startsWith('/v13/deployments/')) return response({ id: url.pathname.split('/').at(-1), projectId: PROJECT, url: 'fixture.vercel.app', alias: ['fixture.example.com'], readyState: 'READY', env: { TOKEN: token }, routes: [{ headers: { token } }] });
    if (url.pathname.endsWith('/domains')) return response({ domains: [{ name: 'fixture.example.com', verified: true }] });
    if (url.pathname === '/v4/aliases') return response({ aliases: [{ alias: 'branch.vercel.app', deploymentId: 'dpl_one', projectId: PROJECT }] });
    if (url.pathname.endsWith('/routes')) return response({ routes: [], version: { id: 'routes-version-one', isLive: true, ruleCount: 0 } });
    if (url.pathname.endsWith('/config/active')) return response({ firewallEnabled: true, rules: [{ active: true, action: { mitigate: { action: 'deny' } }, conditionGroup: [{ conditions: [{ value: token }] }] }] });
    if (url.pathname.endsWith('/bypass')) return response({ result: [{ ip: '192.0.2.1', note: token }] });
    throw new Error(token);
  };
  return { calls, fetchImpl };
}

test('inventory uses GET only and emits sanitized metadata without claiming denial', async () => {
  const { fetchImpl, calls } = fixture();
  const result = await inventoryProtection({ token, fetchImpl });
  assert.equal(result.status, 'INVENTORY_COMPLETE');
  assert.equal(result.denialProven, false);
  assert.equal(result.deployments.length, 1);
  assert.equal(result.observations.find((x) => x.name === 'firewall').value.rules[0].action, 'deny');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes('192.0.2.1'), false);
  assert.equal(calls.some(({ url }) => url.pathname.includes('/env')), false);
});

test('all deployment pages and bypass offset pages are collected', async () => {
  const { fetchImpl, calls } = fixture((url) => {
    if (url.pathname === '/v6/deployments') return response(url.searchParams.has('until') ? { deployments: [{ uid: 'dpl_two' }] } : { deployments: [{ uid: 'dpl_one' }], pagination: { next: 123 } });
    if (url.pathname.endsWith('/bypass')) return response(url.searchParams.has('offset') ? { result: [] } : { result: [{ ip: '192.0.2.1' }], pagination: { id: 'cursor-one', ownerId: TEAM } });
  });
  const result = await inventoryProtection({ token, fetchImpl });
  assert.equal(result.status, 'INVENTORY_COMPLETE');
  assert.equal(result.deployments.length, 2);
  assert.ok(calls.some(({ url }) => url.searchParams.get('offset') === 'cursor-one'));
});

test('pagination loops and inaccessible firewall fail closed with evidence', async () => {
  const { fetchImpl } = fixture((url) => {
    if (url.pathname === '/v6/deployments') return response({ deployments: [{ uid: 'dpl_one' }], pagination: { next: 123 } });
    if (url.pathname.endsWith('/config/active')) return response({ error: { message: token } }, 403);
  });
  const result = await inventoryProtection({ token, fetchImpl });
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.observations.find((x) => x.name === 'deployments').code, 'INVALID_PAGINATION');
  assert.equal(result.observations.find((x) => x.name === 'firewall').code, 'HTTP_403');
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('unknown schema, wrong project, network errors and total deadline cannot pass', async () => {
  for (const mode of ['schema', 'project', 'network', 'deadline']) {
    const { fetchImpl } = fixture((url) => {
      if (mode === 'network') throw new Error(token);
      if (mode === 'schema' && url.pathname === '/v4/aliases') return response({ aliases: 'invalid' });
      if (mode === 'project' && url.pathname.startsWith('/v13/')) return response({ id: 'dpl_one', projectId: 'other' });
    });
    let clock = 0;
    const result = await inventoryProtection({ token, fetchImpl, ...(mode === 'deadline' ? { now: () => clock++, deadlineMs: 1 } : {}) });
    assert.equal(result.status, 'INCOMPLETE', mode);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('oversized responses are rejected and missing credentials make zero requests', async () => {
  const { fetchImpl } = fixture((url) => url.pathname.endsWith('/config/active') ? response({ excess: 'a'.repeat(4 * 1024 * 1024) }) : undefined);
  const result = await inventoryProtection({ token, fetchImpl });
  assert.equal(result.observations.find((x) => x.name === 'firewall').code, 'RESPONSE_LIMIT');
  const missing = await inventoryProtection({ fetchImpl: () => assert.fail('unexpected request') });
  assert.equal(missing.code, 'CREDENTIAL_REQUIRED');
});


test('project-filtered alias response cannot import another project', async () => {
  const { fetchImpl } = fixture((url) => url.pathname === '/v4/aliases' ? response({ aliases: [{ alias: 'other.vercel.app', projectId: 'other', deploymentId: 'dpl_other' }] }) : undefined);
  const result = await inventoryProtection({ token, fetchImpl });
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.observations.find((x) => x.name === 'aliases').code, 'ALIAS_PROJECT_MISMATCH');
  assert.deepEqual(result.aliases, []);
});


test('project routing exposes control types while removing secret-bearing values', async () => {
  const { fetchImpl } = fixture((url) => url.pathname.endsWith('/routes') ? response({
    routes: [{ enabled: true, routeType: 'rewrite', rawSrc: '/api/search-jobs', srcSyntax: 'equals',
      route: { src: '/api/search-jobs', dest: `https://jarvis.blackspirehelix.com/private?token=${token}`, methods: ['POST'],
        has: [{ type: 'header', key: token, value: token }], transforms: [{ value: token }] } }],
    version: { id: 'routing-one', isStaging: true, isLive: false, ruleCount: 1 }, limit: { maxRoutes: 100, currentRoutes: 1 },
  }) : undefined);
  const result = await inventoryProtection({ token, fetchImpl });
  const routing = result.observations.find((x) => x.name === 'projectRouting').value;
  assert.equal(result.status, 'INVENTORY_COMPLETE');
  assert.equal(routing.isLive, false);
  assert.equal(routing.rules[0].destinationClass, 'canonical_gateway');
  assert.deepEqual(routing.rules[0].methods, ['POST']);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(routing.denialProven, false);
});

test('routing count drift and unknown empty schema remain incomplete', async () => {
  for (const body of [{}, { routes: [], version: { id: 'version', ruleCount: 1 } }]) {
    const { fetchImpl } = fixture((url) => url.pathname.endsWith('/routes') ? response(body) : undefined);
    const result = await inventoryProtection({ token, fetchImpl });
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.observations.find((x) => x.name === 'projectRouting').code, 'INCOMPLETE_ROUTING_SCHEMA');
  }
});
