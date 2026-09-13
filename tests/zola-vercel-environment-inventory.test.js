import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryFrontendEnvironment, isProhibitedFrontendDatabaseKey } from '../scripts/zola-vercel-environment-inventory.mjs';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const TOKEN = 'v'.repeat(32);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fixture(pages, { project = { id: PROJECT, accountId: TEAM } } = {}) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname === `/v9/projects/${PROJECT}`) return json(project);
    if (url.pathname !== `/v10/projects/${PROJECT}/env`) return json({}, 404);
    const cursor = url.searchParams.get('until');
    return pages(cursor, calls.length);
  };
  return { calls, fetchImpl };
}

test('Vercel environment inventory is fixed-project GET-only, non-decrypting and value-free', async () => {
  const marker = 'secret-value-must-never-escape';
  const { calls, fetchImpl } = fixture(() => json([
    { id: 'env_one', key: 'NEXT_PUBLIC_API_ORIGIN', target: ['production', 'preview'], type: 'encrypted', value: marker, decrypted: false },
    { id: 'env_two', key: 'BLACKSPIRE_CAPABILITY_TOKEN', target: 'production', legacyValue: marker, internalContentHint: { encryptedValue: marker } },
  ]));
  const result = await inventoryFrontendEnvironment({ token: TOKEN, fetchImpl });
  assert.equal(result.status, 'ISOLATED');
  assert.equal(result.prohibitedKeyCount, 0);
  assert.equal(result.paginationComplete, true);
  assert.deepEqual(result.entries, [
    { key: 'BLACKSPIRE_CAPABILITY_TOKEN', targets: ['production'], gitBranchScoped: false, customEnvironmentCount: 0 },
    { key: 'NEXT_PUBLIC_API_ORIGIN', targets: ['preview', 'production'], gitBranchScoped: false, customEnvironmentCount: 0 },
  ]);
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://api.vercel.com');
    assert.equal(url.searchParams.get('teamId'), TEAM);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
  }
  assert.equal(calls[1].url.searchParams.get('decrypt'), 'false');
});

test('canonical and frontend-prefixed direct database keys fail isolation', async () => {
  for (const key of ['DATABASE_URL', 'POSTGRES_PASSWORD', 'PGPASSWORD', 'SUPABASE_DB_URL',
    'BUYER_WRITER_DATABASE_URL', 'BUYER_WRITER_RUNTIME_PASSWORD', 'BUYER_WRITER_ISSUER_PASSWORD',
    'NEXT_PUBLIC_DATABASE_URL', 'VITE_SUPABASE_DB_PASSWORD', 'ZOLA_POSTGRES_URL']) {
    assert.equal(isProhibitedFrontendDatabaseKey(key), true, key);
  }
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_API_ORIGIN', 'BLACKSPIRE_CAPABILITY_TOKEN']) {
    assert.equal(isProhibitedFrontendDatabaseKey(key), false, key);
  }
  const { fetchImpl } = fixture(() => json([{ id: 'env_bad', key: 'NEXT_PUBLIC_DATABASE_URL', target: ['production'], value: 'redacted', decrypted: false }]));
  const result = await inventoryFrontendEnvironment({ token: TOKEN, fetchImpl });
  assert.equal(result.status, 'PROHIBITED_DATABASE_KEYS_PRESENT');
  assert.deepEqual(result.prohibitedKeys, ['NEXT_PUBLIC_DATABASE_URL']);
});

test('inventory follows bounded pagination and reports only scopes', async () => {
  const { calls, fetchImpl } = fixture((cursor) => cursor === null
    ? json({ envs: [{ id: 'env_a', key: 'SAFE_A', target: ['preview'], gitBranch: 'private-branch', value: 'one', decrypted: false }], pagination: { next: 123 } })
    : json({ envs: [{ id: 'env_b', key: 'SAFE_B', target: ['production'], customEnvironmentIds: ['env_custom'], value: 'two', decrypted: false }], pagination: { next: null } }));
  const result = await inventoryFrontendEnvironment({ token: TOKEN, fetchImpl });
  assert.equal(result.status, 'ISOLATED');
  assert.equal(result.paginationComplete, true);
  assert.equal(calls[2].url.searchParams.get('until'), '123');
  assert.deepEqual(result.entries, [
    { key: 'SAFE_A', targets: ['preview'], gitBranchScoped: true, customEnvironmentCount: 0 },
    { key: 'SAFE_B', targets: ['production'], gitBranchScoped: false, customEnvironmentCount: 1 },
  ]);
  assert.equal(JSON.stringify(result).includes('private-branch'), false);
  assert.equal(JSON.stringify(result).includes('env_custom'), false);
  assert.equal(JSON.stringify(result).includes('one'), false);
  assert.equal(JSON.stringify(result).includes('two'), false);
});

test('missing credentials, missing inventory and authentication failures fail closed', async () => {
  assert.equal((await inventoryFrontendEnvironment({ token: '' })).code, 'CREDENTIAL_REQUIRED');
  const missing = fixture(() => json({}));
  assert.equal((await inventoryFrontendEnvironment({ token: TOKEN, fetchImpl: missing.fetchImpl })).code, 'INVALID_ENV_SCHEMA');
  const unauthorized = fixture(() => json({ error: 'private provider detail' }, 401));
  const result = await inventoryFrontendEnvironment({ token: TOKEN, fetchImpl: unauthorized.fetchImpl });
  assert.equal(result.code, 'HTTP_401');
  assert.equal(JSON.stringify(result).includes('private provider detail'), false);
});

test('malformed pagination, duplicate rows and decrypted responses fail closed', async () => {
  for (const page of [
    { envs: [], pagination: { next: {} } },
    { envs: [{ id: 'env_one', key: 'SAFE', target: ['production'], decrypted: true }], pagination: { next: null } },
    { envs: [{ id: 'env_one', key: 'SAFE', target: ['production'] }, { id: 'env_one', key: 'SAFE_TWO', target: ['production'] }], pagination: { next: null } },
  ]) {
    const { fetchImpl } = fixture(() => json(page));
    const result = await inventoryFrontendEnvironment({ token: TOKEN, fetchImpl });
    assert.equal(result.status, 'INCOMPLETE');
    assert.notEqual(result.code, undefined);
  }
});

test('project ownership mismatch fails closed before environment inventory', async () => {
  const { calls, fetchImpl } = fixture(() => json([]), { project: { id: PROJECT, accountId: 'team_other' } });
  const result = await inventoryFrontendEnvironment({ token: TOKEN, fetchImpl });
  assert.equal(result.code, 'PROJECT_MISMATCH');
  assert.equal(calls.length, 1);
});
