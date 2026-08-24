import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..');
const waiter = path.join(repo, 'scripts', 'wait-production-ready.sh');
const generation = 'a'.repeat(32);
const oldGeneration = 'b'.repeat(32);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-activation-ready-'));
  const systemctl = path.join(root, 'systemctl');
  fs.writeFileSync(systemctl, `#!/bin/sh
unit="$2"
key=worker
case "$unit" in *api*) key=api;; esac
state="$(sed -n '1p' "$BLACKSPIRE_TEST_STATE/$key")"
invocation="$(sed -n '2p' "$BLACKSPIRE_TEST_STATE/$key")"
printf 'ActiveState=%s\\nInvocationID=%s\\n' "$state" "$invocation"
`);
  fs.chmodSync(systemctl, 0o755);
  const setUnit = (unit, active, invocation = generation) => fs.writeFileSync(path.join(root, unit), `${active}\n${invocation}\n`);
  setUnit('api', 'active');
  setUnit('worker', 'active');
  return { root, systemctl, setUnit };
}

async function startApi(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, url: `http://127.0.0.1:${port}` };
}

function json(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function runWait({ url, host, timeout = 2, poll = 0.1, waiterPath = waiter }) {
  const child = spawn('bash', [waiterPath, url, 'fixture-api.service', 'fixture-worker.service', String(timeout), String(poll)], {
    cwd: repo,
    env: { ...process.env, BLACKSPIRE_GATE4_SYSTEMCTL: host.systemctl, BLACKSPIRE_TEST_STATE: host.root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.once('close', (code) => resolve({ code, stdout, stderr })));
}

test('slow API startup is polled and current worker generation eventually enables readiness', async (t) => {
  const host = fixture();
  let requests = 0;
  const { server, url } = await startApi((req, res) => {
    requests += 1;
    if (requests < 3) return json(res, { ok: false, service: 'blackspire-command-api' });
    if (req.url === '/health') return json(res, { ok: true, service: 'blackspire-command-api' });
    return json(res, { ok: true, service: 'blackspire-command-api', dependencies: { worker: { generationId: generation } } });
  });
  t.after(() => server.close());
  const result = await runWait({ url, host });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(requests >= 4, 'the waiter must retry startup instead of failing on the first response');
});

test('slow worker startup is polled until its unit and current heartbeat generation agree', async (t) => {
  const host = fixture();
  host.setUnit('worker', 'inactive');
  const { server, url } = await startApi((req, res) => {
    if (req.url === '/health') return json(res, { ok: true, service: 'blackspire-command-api' });
    return json(res, { ok: true, service: 'blackspire-command-api', dependencies: { worker: { generationId: generation } } });
  });
  t.after(() => server.close());
  setTimeout(() => host.setUnit('worker', 'active'), 250);
  assert.equal((await runWait({ url, host })).code, 0);
});

test('fresh heartbeat from the previous stable worker ID cannot satisfy a new activation', async (t) => {
  const host = fixture();
  const { server, url } = await startApi((req, res) => {
    if (req.url === '/health') return json(res, { ok: true, service: 'blackspire-command-api' });
    return json(res, { ok: true, service: 'blackspire-command-api', dependencies: { worker: { generationId: oldGeneration } } });
  });
  t.after(() => server.close());
  const result = await runWait({ url, host, timeout: 1 });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /timed out/);
});

test('worker death after a current heartbeat is refused by the final unit-state proof', async (t) => {
  const host = fixture();
  const { server, url } = await startApi((req, res) => {
    if (req.url === '/health') return json(res, { ok: true, service: 'blackspire-command-api' });
    json(res, { ok: true, service: 'blackspire-command-api', dependencies: { worker: { generationId: generation } } });
    host.setUnit('worker', 'inactive');
  });
  t.after(() => server.close());
  assert.equal((await runWait({ url, host, timeout: 1 })).code, 1);
});

test('API death before final proof is refused', async (t) => {
  const host = fixture();
  const { server, url } = await startApi((req, res) => {
    if (req.url === '/health') return json(res, { ok: true, service: 'blackspire-command-api' });
    json(res, { ok: true, service: 'blackspire-command-api', dependencies: { worker: { generationId: generation } } });
    host.setUnit('api', 'inactive');
  });
  t.after(() => server.close());
  assert.equal((await runWait({ url, host, timeout: 1 })).code, 1);
});

test('stale-generation regression is load-bearing under generation-comparison ablation', async (t) => {
  const host = fixture();
  const mutant = path.join(host.root, 'wait-production-ready-mutant.sh');
  fs.mkdirSync(path.join(host.root, 'lib'));
  fs.copyFileSync(path.join(repo, 'scripts', 'lib', 'node-bin.sh'), path.join(host.root, 'lib', 'node-bin.sh'));
  const source = fs.readFileSync(waiter, 'utf8');
  const guard = 'ready.dependencies?.worker?.generationId !== process.env.EXPECTED_GENERATION';
  assert.ok(source.includes(guard), 'mutation target must exist');
  fs.writeFileSync(mutant, source.replace(guard, 'false'));
  fs.chmodSync(mutant, 0o755);
  const { server, url } = await startApi((req, res) => {
    if (req.url === '/health') return json(res, { ok: true, service: 'blackspire-command-api' });
    return json(res, { ok: true, service: 'blackspire-command-api', dependencies: { worker: { generationId: oldGeneration } } });
  });
  t.after(() => server.close());
  const mutantResult = await runWait({ url, host, timeout: 1, waiterPath: mutant });
  assert.equal(mutantResult.code, 0, 'removing the generation comparison must recreate stale-heartbeat acceptance');
});

for (const [name, response] of [
  ['unhealthy health', { health: { ok: false, service: 'blackspire-command-api' } }],
  ['unhealthy readiness', { ready: { ok: false, service: 'blackspire-command-api' } }],
  ['wrong service identity', { health: { ok: true, service: 'other' } }],
  ['malformed readiness JSON', { malformed: true }],
]) test(`${name} is refused until the bounded timeout`, async (t) => {
  const host = fixture();
  const { server, url } = await startApi((req, res) => {
    if (req.url === '/health') return json(res, response.health || { ok: true, service: 'blackspire-command-api' });
    if (response.malformed) { res.writeHead(200); return res.end('{'); }
    return json(res, response.ready || { ok: true, service: 'blackspire-command-api', dependencies: { worker: { generationId: generation } } });
  });
  t.after(() => server.close());
  assert.equal((await runWait({ url, host, timeout: 1 })).code, 1);
});

test('an inactive API or worker unit fails closed without exposing environment values', async (t) => {
  const host = fixture();
  host.setUnit('api', 'inactive');
  const secret = 'should-never-appear';
  const { server, url } = await startApi((req, res) => json(res, { ok: true, service: 'blackspire-command-api' }));
  t.after(() => server.close());
  process.env.ACTIVATION_TEST_SECRET = secret;
  t.after(() => { delete process.env.ACTIVATION_TEST_SECRET; });
  const result = await runWait({ url, host, timeout: 1 });
  assert.equal(result.code, 1);
  assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
});

test('timeout is bounded', async () => {
  const host = fixture();
  host.setUnit('worker', 'inactive');
  const started = Date.now();
  const result = await runWait({ url: 'http://127.0.0.1:9', host, timeout: 1 });
  const elapsed = Date.now() - started;
  assert.equal(result.code, 1);
  assert.ok(elapsed >= 850 && elapsed < 2500, `elapsed=${elapsed}`);
});

test('a hung systemctl probe is killed within the total readiness budget', async () => {
  const host = fixture();
  fs.writeFileSync(host.systemctl, '#!/bin/sh\nexec sleep 30\n');
  fs.chmodSync(host.systemctl, 0o755);
  const started = Date.now();
  const result = await runWait({ url: 'http://127.0.0.1:9', host, timeout: 1 });
  const elapsed = Date.now() - started;
  assert.equal(result.code, 1);
  assert.ok(elapsed >= 850 && elapsed < 2500, `elapsed=${elapsed}`);
});
