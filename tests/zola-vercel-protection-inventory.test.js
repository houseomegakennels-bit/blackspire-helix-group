import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryProtection, deploymentPathMetadata } from '../scripts/zola-vercel-protection-inventory.mjs';

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
    if (url.pathname === '/v4/aliases') return response({ aliases: ['branch.vercel.app', 'frontend-c06ce2-routes-houseomegakennels-4825s-projects.vercel.app', 'frontend-tau-woad-73.vercel.app'].map(alias => ({ alias, deploymentId: 'dpl_one', projectId: PROJECT })) });
    if (url.pathname.startsWith('/v4/aliases/')) return response({ alias: url.pathname.split('/').at(-1), deploymentId: 'dpl_one', projectId: PROJECT, protectionBypass: { [token]: {} }, routes: [{ headers: { token } }] });
    if (url.pathname.endsWith('/routes/versions')) return response({ versions: [] });
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


test('routing schema diagnostics never emit arbitrary keys or values and never imply denial', async () => {
  for (const body of [null, [], {}, { [token]: token, routes: token, version: { id: token, ruleCount: token }, pagination: token },
    { routes: [], version: { id: token, ruleCount: 12 } }]) {
    const { fetchImpl } = fixture((url) => url.pathname.endsWith('/routes') ? response(body) : undefined);
    const result = await inventoryProtection({ token, fetchImpl });
    const observation = result.observations.find((row) => row.name === 'projectRouting');
    assert.equal(observation.code, 'INCOMPLETE_ROUTING_SCHEMA');
    assert.equal(typeof observation.diagnostic.routesPresent, 'boolean');
    assert.equal(result.denialProven, false);
    assert.equal(JSON.stringify(result).includes(token), false);
    if (body === null) assert.equal(observation.diagnostic.topLevelType, 'null');
    if (body?.version?.ruleCount === 12) assert.equal(observation.diagnostic.ruleCount, 12);
  }
});


test('routing history retains only typed control metadata and refuses partial/duplicate schemas', async () => {
  for (const invalid of [false, true, 'duplicate']) {
    const version = { id: 'version-one', isLive: true, ruleCount: 2, s3Key: token, createdBy: token, note: token };
    const { fetchImpl } = fixture((url) => url.pathname.endsWith('/routes/versions') ? response({ versions: invalid === 'duplicate' ? [version, version] : [version], ...(invalid === true ? { pagination: { next: 1 } } : {}) }) : undefined);
    const result = await inventoryProtection({ token, fetchImpl });
    const history = result.observations.find(row => row.name === 'projectRoutingVersions');
    assert.equal(history.status, invalid ? 'INCOMPLETE' : 'COMPLETE');
    assert.equal(JSON.stringify(result).includes(token), false);
    if (!invalid) { assert.equal(history.value.count, 1); assert.equal(history.value.denialProven, false); }
  }
});


test('coverage alias details require exact inventory binding and redact values', async () => {
  for (const drift of [false, true]) {
    const { fetchImpl } = fixture(url => url.pathname.startsWith('/v4/aliases/') && drift
      ? response({ alias: url.pathname.split('/').at(-1), deploymentId: 'dpl_other', projectId: PROJECT }) : undefined);
    const result = await inventoryProtection({ token, fetchImpl });
    const detail = result.observations.find(row => row.name === 'coverageGapAliases');
    assert.equal(detail.status, drift ? 'INCOMPLETE' : 'COMPLETE');
    assert.equal(JSON.stringify(result).includes(token), false);
    if (!drift) { assert.equal(detail.value.length, 2); assert.equal(detail.value[0].routesCount, 1); assert.equal(detail.value[0].denialProven, false); }
  }
});

test('alias targets omitted from deployment pagination are independently discovered once', async () => {
  const names = ['older.vercel.app', 'older-branch.vercel.app', 'frontend-c06ce2-routes-houseomegakennels-4825s-projects.vercel.app', 'frontend-tau-woad-73.vercel.app'];
  const {fetchImpl, calls} = fixture(url => url.pathname === '/v4/aliases'
    ? response({aliases: names.map(alias => ({alias, deploymentId: alias.startsWith('older') ? 'dpl_old' : 'dpl_one', projectId: PROJECT}))}) : undefined);
  const result = await inventoryProtection({token, fetchImpl});
  assert.equal(result.status, 'INVENTORY_COMPLETE');
  assert.equal(result.deployments.length, 2);
  assert.equal(calls.filter(({url}) => url.pathname === '/v13/deployments/dpl_old').length, 1);
  assert.deepEqual(result.aliasTargetDeployments, [{id: 'dpl_old', status: 'COMPLETE', denialProven: false}]);
  assert.equal(result.observations.find(row => row.name === 'aliasDeploymentClosure').value.additionalDeployments, 1);
  assert.equal(result.denialProven, false);
});

test('inaccessible or foreign-project historical targets never become containment proof', async () => {
  for (const mode of ['404', '410', 'foreign']) {
    const {fetchImpl} = fixture(url => {
      if (url.pathname === '/v4/aliases') return response({aliases: ['missing.vercel.app', 'other.vercel.app'].map((alias, i) => ({alias, projectId: PROJECT, deploymentId: `dpl_old_${i}`}))});
      if (url.pathname.startsWith('/v13/deployments/dpl_old_')) return mode === 'foreign'
        ? response({id: url.pathname.split('/').at(-1), projectId: 'other', url: 'other.vercel.app'})
        : response({message: token}, Number(mode));
    });
    const result = await inventoryProtection({token, fetchImpl});
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.aliasTargetDeployments.length, 2);
    assert.ok(result.aliasTargetDeployments.every(row => row.status === 'INCOMPLETE' && row.denialProven === false));
    assert.equal(result.observations.find(row => row.name === 'aliasDeploymentClosure').code, 'ALIAS_TARGETS_UNRESOLVED');
    assert.equal(result.deployments.length, 1);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('duplicate normalized aliases, missing targets and malformed DNS names cannot close discovery', async () => {
  for (const aliases of [
    [{alias: 'Same.vercel.app', deploymentId: 'dpl_one'}, {alias: 'same.vercel.app', deploymentId: 'dpl_one'}],
    [{alias: 'unknown.vercel.app', deploymentId: null}],
    ...['.vercel.app', '-bad.vercel.app', 'bad..vercel.app', `${'a'.repeat(64)}.vercel.app`].map(alias => [{alias, deploymentId: 'dpl_one'}]),
  ]) {
    const {fetchImpl} = fixture(url => url.pathname === '/v4/aliases'
      ? response({aliases: aliases.map(row => ({...row, projectId: PROJECT}))}) : undefined);
    const result = await inventoryProtection({token, fetchImpl});
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.observations.find(row => row.name === 'aliasDeploymentClosure').status, 'INCOMPLETE');
    assert.equal(result.denialProven, false);
  }
});

test('deployment path metadata binds ordered reviewed routes and builder declarations to source SHA without proving authority', async () => {
  const sha = 'a'.repeat(40);
  const {fetchImpl} = fixture(url => url.pathname.startsWith('/v13/deployments/') ? response({
    id: 'dpl_one', projectId: PROJECT, url: 'fixture.vercel.app', readyState: 'READY', meta: {githubCommitSha: sha},
    routes: [{src: '/api/nexus/trace', methods: ['POST'], headers: {authorization: token}},
      {src: '/api/internal/capabilities/buyer-profiles', methods: ['GET'], dest: `https://secret.invalid/${token}`}],
    builds: [{use: '@vercel/next', src: 'package.json', config: {token}}],
  }) : undefined);
  const result = await inventoryProtection({token, fetchImpl});
  const metadata = result.deployments[0].pathMetadata;
  assert.equal(metadata.sourceSha, sha);
  assert.equal(metadata.sourceShaEvidence, 'deployment_metadata_only');
  assert.equal(result.deployments[0].sha, sha);
  assert.equal(metadata.status, 'METADATA_CAPTURED');
  assert.deepEqual(metadata.routes.map(row => row.source.recognizedPath), ['/api/nexus/trace', '/api/internal/capabilities/buyer-profiles']);
  assert.deepEqual(metadata.routes.map(row => row.index), [0, 1]);
  assert.equal(metadata.builds[0].builder, '@vercel/next');
  assert.match(metadata.builds[0].source.expressionSha256, /^[a-f0-9]{64}$/);
  assert.equal(metadata.buildOutputVerified, false);
  assert.equal(metadata.authorityProven, false);
  assert.deepEqual(metadata.gaps, ['BUILD_OUTPUT_AUTHORITY_UNVERIFIED']);
  assert.equal(result.pathAuthority.status, 'INCOMPLETE');
  assert.deepEqual(result.pathAuthority.unresolvedDeploymentIds, ['dpl_one']);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(result).includes('secret.invalid'), false);
});

test('unknown expressions and delegated routes retain digest-only unresolved records', () => {
  const result = deploymentPathMetadata({meta: {githubCommitSha: 'b'.repeat(40)}, routes: [
    {src: `/private/${token}`, methods: ['POST'], has: [{key: token, value: token}], middlewarePath: token},
    {handle: 'filesystem'}, {src: '/api/nexus/trace', destination: {service: token, path: token}},
  ], builds: [{use: token, src: token, config: {[token]: token}}]});
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.routes[0].source.recognizedPath, null);
  assert.equal(result.routes[0].source.redacted, true);
  assert.match(result.routes[0].source.expressionSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.routes[1].handle, 'filesystem');
  assert.equal(result.routes[2].delegated, true);
  assert.equal(result.gaps.includes('UNREVIEWED_ROUTE_EXPRESSION'), true);
  assert.equal(result.gaps.includes('DELEGATED_ROUTE_REQUIRES_BUILD_OUTPUT'), true);
  assert.equal(result.gaps.includes('UNREVIEWED_BUILD_DECLARATION'), true);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('missing, empty, malformed and oversized path metadata never proves authority', () => {
  for (const detail of [
    null, undefined, [], {}, {routes: null, builds: null}, {routes: [], builds: []},
    {routes: [{src: '/api/nexus/trace'}], builds: [{use: '@vercel/next'}]},
    {routes: [{src: token, methods: token}]}, {routes: [{src: token, has: {token}}]},
    {routes: [{src: token, transforms: Array(129).fill({token})}]},
    {routes: [null]}, {routes: [{handle: token}]}, {routes: [{src: 'a'.repeat(8193)}]},
    {routes: Array(2049).fill({src: token})}, {routes: [{src: '/api/nexus/trace'}], builds: Array(257).fill({use: token})},
    {routes: [{src: '/api/nexus/trace'}], builds: [{use: {token}}]},
  ]) {
    const result = deploymentPathMetadata(detail);
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.denialProven, false);
    assert.equal(result.authorityProven, false);
    assert.equal(result.buildOutputVerified, false);
    assert.equal(result.gaps.includes('BUILD_OUTPUT_AUTHORITY_UNVERIFIED'), true);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('conflicting source metadata refuses capture completion and resolved alias targets retain path gaps', async () => {
  const meta = deploymentPathMetadata({meta: {githubCommitSha: 'a'.repeat(40)}, gitSource: {sha: 'b'.repeat(40)},
    routes: [{src: '/api/nexus/trace'}], builds: [{use: '@vercel/next', src: 'package.json'}]});
  assert.equal(meta.status, 'INCOMPLETE');
  assert.equal(meta.gaps.includes('SOURCE_SHA_METADATA_CONFLICT'), true);
  assert.equal(meta.authorityProven, false);
  const {fetchImpl} = fixture(url => url.pathname === '/v4/aliases'
    ? response({aliases: [{alias: 'old.vercel.app', projectId: PROJECT, deploymentId: 'dpl_old'}]}) : undefined);
  const result = await inventoryProtection({token, fetchImpl});
  assert.equal(result.pathAuthority.deploymentCount, 2);
  assert.deepEqual(result.pathAuthority.unresolvedDeploymentIds, ['dpl_one', 'dpl_old']);
  assert.deepEqual(result.pathAuthority.unresolvedAliasTargetIds, []);
});

test('path metadata failure preserves host discovery and missing-target authority gaps', async () => {
  const {fetchImpl} = fixture(url => {
    if (url.pathname === '/v4/aliases') return response({aliases: [{alias: 'missing.vercel.app', deploymentId: 'dpl_missing', projectId: PROJECT}]});
    if (url.pathname === '/v13/deployments/dpl_missing') return response({message: token}, 404);
  });
  const result = await inventoryProtection({token, fetchImpl});
  assert.equal(result.deployments[0].url, 'fixture.vercel.app');
  assert.equal(result.deployments[0].pathMetadata.status, 'INCOMPLETE');
  assert.deepEqual(result.pathAuthority.unresolvedDeploymentIds, ['dpl_one']);
  assert.deepEqual(result.pathAuthority.unresolvedAliasTargetIds, ['dpl_missing']);
  assert.equal(result.pathAuthority.authorityProven, false);
  assert.equal(result.pathAuthority.status, 'INCOMPLETE');
});
