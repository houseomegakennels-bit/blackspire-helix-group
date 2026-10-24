import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute actual server modules with synthetic auth and an in-memory service
// transport. No database connection or production credentials are used.
function load(name, dependencies) {
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  const context = vm.createContext({ exports, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, process: { env: { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', VERCEL: '1' }, cwd: () => '/synthetic' }, Buffer, console });
  new vm.Script(js, { filename: name }).runInContext(context);
  return exports;
}
function setup() {
  let operator = null;
  const rows = new Map();
  const calls = [];
  const clients = [];
  const client = {
    from(table) {
      calls.push(table);
      return {
        async insert(row) {
          rows.set(table, [row]);
          return { error: null };
        },
      };
    },
  };
  const dependencies = {
    'server-only': {},
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
    'next/navigation': { redirect: () => { throw new Error('Unexpected page redirect'); } },
    '@/lib/buyer-engine-auth': { getAuthenticatedOperator: async () => operator, listAuthUsers: async () => [{ id: 'first-admin' }] },
    '@supabase/supabase-js': { createClient(url, key, options) {
      clients.push(url);
      assert.equal(url, 'https://fixture.invalid'); assert.equal(key, 'synthetic-service-key');
      assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false);
      return client;
    } },
  };
  const access = load('operator-access', dependencies);
  return { rows, calls, clients, access, dependencies: { ...dependencies, '@/lib/operator-access': access },
    setRole(role, id = 'other-user') { operator = role === null ? null : { id, app_metadata: { ...(role ? { blackspire_role: role } : {}), demo_expires_at: '2099-01-01' } }; },
  };
}
test('beta feedback route denies excluded callers before reading the body or creating a storage client', async () => {
  const s = setup();
  const beta = load('beta-server', s.dependencies);
  const route = load('../app/api/beta/feedback/route', { ...s.dependencies, '@/lib/beta-server': beta });
  for (const role of [null, '', 'client_only', 'demo_viewer', 'demo_operator']) {
    s.setRole(role);
    const response = await route.POST({ json: async () => { assert.fail('Unauthorized body must not be read'); } });
    assert.equal(response.status, role === null ? 401 : 403);
    assert.equal(response.body.ok, false);
  }
  assert.equal(s.clients.length, 0);
  assert.equal(s.calls.length, 0);
});

test('beta feedback service independently rejects excluded callers without storage access', async () => {
  const s = setup(); const beta = load('beta-server', s.dependencies);
  for (const role of [null, '', 'client_only', 'demo_viewer', 'demo_operator']) {
    s.setRole(role);
    const result = await beta.submitBetaFeedback({ message: 'synthetic' });
    assert.equal(result.ok, false);
    assert.equal(result.status, role === null ? 401 : 403);
  }
  assert.equal(s.clients.length, 0);
  assert.equal(s.calls.length, 0);
});

test('beta feedback preserves admin, beta and verified first-admin fallback submissions', async () => {
  const s = setup(); const beta = load('beta-server', s.dependencies);
  const route = load('../app/api/beta/feedback/route', { ...s.dependencies, '@/lib/beta-server': beta });
  for (const [role, id] of [['admin', 'admin-user'], ['beta_tester', 'beta-user'], ['', 'first-admin']]) {
    s.setRole(role, id);
    const response = await route.POST({ json: async () => ({ message: '  synthetic feedback  ', category: 'bug', user_id: 'spoofed' }) });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(s.rows.get('beta_feedback')[0].user_id, id);
    assert.equal(s.rows.get('beta_feedback')[0].message, 'synthetic feedback');
    assert.equal(s.rows.get('beta_feedback')[0].category, 'bug');
  }
});

test('beta feedback service denial after route admission is propagated without a write', async () => {
  const s = setup(); const beta = load('beta-server', s.dependencies);
  const route = load('../app/api/beta/feedback/route', { ...s.dependencies, '@/lib/beta-server': beta });
  for (const role of [null, 'client_only']) {
    s.setRole('beta_tester');
    const response = await route.POST({ json: async () => { s.setRole(role); return { message: 'synthetic' }; } });
    assert.equal(response.status, role === null ? 401 : 403);
    assert.equal(response.body.ok, false);
  }
  assert.equal(s.clients.length, 0);
  assert.equal(s.calls.length, 0);
});
