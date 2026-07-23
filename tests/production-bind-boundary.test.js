import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  resolveBindTarget,
  validateProductionHost,
  validateProductionPort,
  probePortAvailable,
  selectProductionPort,
  isProductionProfile,
  PRODUCTION_BIND_HOST,
  PROTECTED_PORTS,
  PRODUCTION_PORT_CANDIDATES,
} from '../packages/shared/bind.js';
import { verifyVpsRuntime } from '../packages/shared/security.js';
import { prepareDisposableDatabase } from './helpers/prepare-disposable-database.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-bind-boundary-'));
const node = process.execPath;

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    BLACKSPIRE_RUNTIME_MODE: 'production',
    BLACKSPIRE_STATE_OWNER: 'vps-production',
    BLACKSPIRE_PROVIDER_MODE: 'manual',
    BLACKSPIRE_HERMES_MODE: 'restricted',
    TELEGRAM_MODE: 'dry-run',
    UNIFIED_IPHONE_TEST_MODE: 'false',
    BIND_HOST: '127.0.0.1',
    PORT: '8789',
    BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '30',
    BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '5',
    BLACKSPIRE_RUNTIME_USER: 'blackspire',
    BLACKSPIRE_DB_PATH: '/opt/blackspire-command/shared/database/command.sqlite',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Canonical host contract
// ---------------------------------------------------------------------------

test('production requires the canonical loopback BIND_HOST', () => {
  const resolved = resolveBindTarget(productionEnv());
  assert.equal(resolved.ok, true, resolved.errors.join('; '));
  assert.equal(resolved.production, true);
  assert.equal(resolved.host, PRODUCTION_BIND_HOST);
  assert.equal(resolved.host, '127.0.0.1');
});

test('production rejects wildcard, unspecified, and non-loopback bind hosts', () => {
  for (const host of ['0.0.0.0', '::', '*']) {
    const resolved = resolveBindTarget(productionEnv({ BIND_HOST: host }));
    assert.equal(resolved.ok, false, `${host} must be rejected`);
    assert.equal(resolved.host, null);
    assert.match(resolved.errors.join('; '), /wildcard/);
  }
  for (const host of ['10.0.0.5', '0.0.0.0 ', 'localhost', '::1', '127.0.0.2', 'command.example.invalid']) {
    const resolved = resolveBindTarget(productionEnv({ BIND_HOST: host }));
    assert.equal(resolved.ok, false, `${host} must be rejected`);
    assert.equal(resolved.host, null);
  }
});

test('production rejects a missing or blank BIND_HOST', () => {
  for (const value of [undefined, '', '   ']) {
    const env = productionEnv();
    if (value === undefined) delete env.BIND_HOST; else env.BIND_HOST = value;
    const resolved = resolveBindTarget(env);
    assert.equal(resolved.ok, false);
    assert.match(resolved.errors.join('; '), /BIND_HOST must be set/);
  }
});

// ---------------------------------------------------------------------------
// Canonical port contract
// ---------------------------------------------------------------------------

test('production requires an explicit port and never falls back to 8787', () => {
  const env = productionEnv();
  delete env.PORT;
  const resolved = resolveBindTarget(env);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.port, null, 'no default port may be produced in production');
  assert.match(resolved.errors.join('; '), /no default and no fallback to 8787/);
});

test('production rejects the ports owned by the existing API/worker and restricted staging', () => {
  assert.deepEqual([...PROTECTED_PORTS], [8787, 8788]);
  for (const port of PROTECTED_PORTS) {
    const resolved = resolveBindTarget(productionEnv({ PORT: String(port) }));
    assert.equal(resolved.ok, false, `port ${port} must be rejected`);
    assert.equal(resolved.port, null);
    assert.match(resolved.errors.join('; '), /reserved/);
  }
});

test('production rejects malformed, privileged, and out-of-range ports', () => {
  const malformed = ['', '  ', 'abc', '80x', '0x1f91', '8789.0', '8789 ', ' 8789', '+8789', '-8789', '08789', '1e4', '８７８９'];
  for (const value of malformed) {
    const resolved = resolveBindTarget(productionEnv({ PORT: value }));
    assert.equal(resolved.ok, false, `${JSON.stringify(value)} must be rejected`);
    assert.equal(resolved.port, null);
  }
  for (const value of ['1', '80', '443', '1023']) {
    const resolved = resolveBindTarget(productionEnv({ PORT: value }));
    assert.equal(resolved.ok, false, `privileged port ${value} must be rejected`);
    assert.match(resolved.errors.join('; '), /unprivileged/);
  }
  for (const value of ['65536', '99999']) {
    const resolved = resolveBindTarget(productionEnv({ PORT: value }));
    assert.equal(resolved.ok, false, `out-of-range port ${value} must be rejected`);
  }
  assert.equal(validateProductionPort('8789').port, 8789);
  assert.equal(validateProductionHost('127.0.0.1').host, '127.0.0.1');
});

// ---------------------------------------------------------------------------
// Profile detection and preserved non-production behavior
// ---------------------------------------------------------------------------

test('a partially populated production environment is still treated as production', () => {
  assert.equal(isProductionProfile({ BLACKSPIRE_RUNTIME_MODE: 'production' }), true);
  assert.equal(isProductionProfile({ BLACKSPIRE_STATE_OWNER: 'vps-production' }), true);
  assert.equal(isProductionProfile({ NODE_ENV: 'production' }), false);
});

test('restricted staging keeps its loopback host and port 8788', () => {
  // Staging is not the production profile, so 8788 stays available to it unchanged.
  const staging = resolveBindTarget({ BIND_HOST: '127.0.0.1', PORT: '8788' });
  assert.equal(staging.ok, true);
  assert.equal(staging.production, false);
  assert.equal(staging.host, '127.0.0.1');
  assert.equal(staging.port, 8788);
});

test('development behavior is preserved', () => {
  const dev = resolveBindTarget({});
  assert.equal(dev.ok, true);
  assert.equal(dev.production, false);
  assert.equal(dev.host, undefined, 'development keeps its historical default host');
  assert.equal(dev.port, 8787);
});

// ---------------------------------------------------------------------------
// Read-only availability probe and reviewed port selection
// ---------------------------------------------------------------------------

test('the availability probe reports an occupied port without disturbing its listener', async () => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve));
  const { port } = listener.address();
  try {
    const busy = await probePortAvailable('127.0.0.1', port);
    assert.equal(busy.free, false);
    assert.equal(busy.code, 'EADDRINUSE');
    assert.equal(listener.listening, true, 'the existing listener must remain healthy');
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
  const free = await probePortAvailable('127.0.0.1', port);
  assert.equal(free.free, true);
});

test('8789 is preferred and 8790-8799 are the only fallbacks', async () => {
  assert.deepEqual([...PRODUCTION_PORT_CANDIDATES], [8789, 8790, 8791, 8792, 8793, 8794, 8795, 8796, 8797, 8798, 8799]);
  for (const protectedPort of PROTECTED_PORTS) {
    assert.equal(PRODUCTION_PORT_CANDIDATES.includes(protectedPort), false, `${protectedPort} must never be a candidate`);
  }
  const allFree = await selectProductionPort({ probe: async () => ({ free: true }) });
  assert.equal(allFree.port, 8789, '8789 is preferred when free');

  const busy = new Set([8789, 8790]);
  const fallback = await selectProductionPort({ probe: async (host, port) => ({ free: !busy.has(port), code: busy.has(port) ? 'EADDRINUSE' : null }) });
  assert.equal(fallback.port, 8791, 'the first verified free candidate is selected');

  const exhausted = await selectProductionPort({ probe: async () => ({ free: false, code: 'EADDRINUSE' }) });
  assert.equal(exhausted.ok, false, 'an exhausted range fails closed rather than reusing a protected port');
  assert.equal(exhausted.port, null);
});

// ---------------------------------------------------------------------------
// Runtime verifier and shell preflight enforce the same contract
// ---------------------------------------------------------------------------

test('verifyVpsRuntime enforces the loopback host and explicit port', () => {
  const opts = {
    uid: 1001, username: 'blackspire', nodeVersion: '22.23.1',
    isWritable: () => true, dirOwnerUid: () => 1001, dirExists: () => true,
  };
  assert.equal(verifyVpsRuntime(productionEnv(), opts).ok, true);
  for (const overrides of [{ BIND_HOST: '0.0.0.0' }, { BIND_HOST: '::' }, { PORT: '8787' }, { PORT: '8788' }, { PORT: '80' }]) {
    const r = verifyVpsRuntime(productionEnv(overrides), opts);
    assert.equal(r.ok, false, `${JSON.stringify(overrides)} must fail closed`);
  }
  const missingHost = productionEnv();
  delete missingHost.BIND_HOST;
  assert.equal(verifyVpsRuntime(missingHost, opts).ok, false);
  const missingPort = productionEnv();
  delete missingPort.PORT;
  assert.equal(verifyVpsRuntime(missingPort, opts).ok, false);
});

test('verifyVpsRuntime never leaks env values in bind errors', () => {
  const leaked = JSON.stringify(verifyVpsRuntime(productionEnv({ BIND_HOST: '10.1.2.3', COMMAND_ADMIN_TOKEN: 'super-secret-value' }), {
    uid: 1001, username: 'blackspire', nodeVersion: '22.23.1',
    isWritable: () => true, dirOwnerUid: () => 1001, dirExists: () => true,
  }));
  assert.doesNotMatch(leaked, /super-secret-value/);
  assert.doesNotMatch(leaked, /10\.1\.2\.3/);
});

test('verify-environment.sh vps-production rejects unsafe bind hosts and ports', () => {
  const base = {
    NODE_ENV: 'production', BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_STATE_OWNER: 'vps-production',
    BLACKSPIRE_PROVIDER_MODE: 'manual', BLACKSPIRE_HERMES_MODE: 'restricted', TELEGRAM_MODE: 'dry-run',
    BLACKSPIRE_DB_PATH: '/opt/blackspire-command/shared/database/command.sqlite',
    COMMAND_ADMIN_TOKEN: 'x'.repeat(32), SESSION_SECRET: 'y'.repeat(40),
    BIND_HOST: '127.0.0.1', PORT: '8789', BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '30',
    BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '5', BLACKSPIRE_RUNTIME_USER: 'blackspire',
  };
  const cases = [
    [{ BIND_HOST: '0.0.0.0' }, /wildcard/],
    [{ BIND_HOST: '::' }, /wildcard/],
    [{ BIND_HOST: '10.0.0.5' }, /exactly 127\.0\.0\.1/],
    [{ BIND_HOST: '' }, /BIND_HOST must be set/],
    [{ PORT: '8787' }, /8787 is reserved/],
    [{ PORT: '8788' }, /8788 is reserved/],
    [{ PORT: '80' }, /unprivileged/],
    [{ PORT: 'abc' }, /explicit decimal integer/],
    [{ PORT: '' }, /PORT must be set explicitly/],
    [{ PORT: '70000' }, /no greater than 65535/],
  ];
  for (const [overrides, expected] of cases) {
    const r = spawnSync('bash', ['scripts/verify-environment.sh', 'vps-production'], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ...base, ...overrides },
    });
    assert.notEqual(r.status, 0, `${JSON.stringify(overrides)} must fail closed`);
    assert.match(r.stderr, expected, `${JSON.stringify(overrides)}: ${r.stderr}`);
  }
});

// ---------------------------------------------------------------------------
// The real listener: BIND_HOST reaches server.listen and conflicts fail closed
// ---------------------------------------------------------------------------

function bootApi(env, { waitForExit = false } = {}) {
  prepareDisposableDatabase(env.BLACKSPIRE_DB_PATH);
  return new Promise((resolve) => {
    const child = spawn(node, ['apps/api/server.js'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ exited: false, code: null, stdout, stderr, child });
    }, waitForExit ? 4000 : 2000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ exited: true, code, stdout, stderr, child });
    });
  });
}

function devEnv(name, overrides = {}) {
  return {
    NODE_ENV: 'test',
    BLACKSPIRE_DB_PATH: path.join(root, name, 'command.sqlite'),
    TELEGRAM_TMP_DIR: path.join(root, name, 'attachments'),
    COMMAND_ADMIN_TOKEN: 'a'.repeat(32),
    SESSION_SECRET: 'b'.repeat(40),
    ...overrides,
  };
}

test('BIND_HOST reaches the real server.listen call', async () => {
  const result = await bootApi(devEnv('bound-loopback', { BIND_HOST: '127.0.0.1', PORT: '8793' }));
  assert.equal(result.exited, false, `API should have stayed up: ${result.stderr}`);
  const line = result.stdout.split('\n').find((entry) => entry.includes('"service":"api"'));
  assert.ok(line, `expected a startup line, got: ${result.stdout}`);
  const startup = JSON.parse(line);
  assert.equal(startup.host, '127.0.0.1', 'the configured BIND_HOST must reach the listener');
  assert.equal(startup.port, 8793);
});

test('an occupied port fails closed and leaves the existing listener healthy', async () => {
  const listener = net.createServer((socket) => socket.end());
  await new Promise((resolve) => listener.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve));
  const { port } = listener.address();
  try {
    const result = await bootApi(devEnv('occupied', { BIND_HOST: '127.0.0.1', PORT: String(port) }), { waitForExit: true });
    assert.equal(result.exited, true, 'the API must exit rather than serve on a conflicting port');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /already in use/);
    assert.match(result.stderr, /refusing to start without a fallback/);
    assert.doesNotMatch(result.stdout, /"service":"api"/, 'no listener may be announced after a conflict');
    assert.equal(listener.listening, true, 'the pre-existing listener must be untouched and healthy');
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});

test('the production supervisor and the API server agree on host and port', async () => {
  // The supervisor resolves the contract once and hands the exact values to both children.
  const source = fs.readFileSync('scripts/production-supervisor.js', 'utf8');
  assert.match(source, /resolveBindTarget/, 'the supervisor must use the canonical contract');
  assert.match(source, /probePortAvailable/, 'the supervisor must preflight the port');
  assert.match(source, /BIND_HOST: bind\.host/, 'the supervisor must propagate the exact host');
  assert.match(source, /PORT: String\(bind\.port\)/, 'the supervisor must propagate the exact port');

  const server = fs.readFileSync('apps/api/server.js', 'utf8');
  assert.match(server, /resolveBindTarget/, 'the server must resolve the same contract');
  assert.doesNotMatch(server, /listen\(port, host/, 'the server must not bind unresolved arguments');
});

test('the production supervisor refuses an occupied port without touching the listener', async () => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve));
  const { port } = listener.address();
  try {
    const r = spawnSync(node, ['scripts/production-supervisor.js'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, ...productionEnv({ PORT: String(port) }) },
    });
    assert.notEqual(r.status, 0, 'the supervisor must fail closed');
    assert.equal(listener.listening, true, 'the existing listener must remain healthy');
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Deployment tooling uses the same explicit port
// ---------------------------------------------------------------------------

test('monitoring health check has no 8787 default and fails closed without a port', () => {
  const env = { ...process.env };
  delete env.PORT;
  delete env.BLACKSPIRE_HEALTH_URL;
  const r = spawnSync('bash', ['ops/blackspire-command-healthcheck.sh'], { cwd: process.cwd(), encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /requires PORT/);
  const script = fs.readFileSync('ops/blackspire-command-healthcheck.sh', 'utf8');
  assert.doesNotMatch(script, /127\.0\.0\.1:8787/, 'the health check must not default to the existing 8787 listener');
});

test('the reverse-proxy template targets the loopback production port and never 8787 or 8788', () => {
  const conf = fs.readFileSync('ops/reverse-proxy/blackspire-command.nginx.conf', 'utf8');
  const upstream = conf.match(/^\s*server\s+(\S+);/m);
  assert.ok(upstream, 'the upstream server directive must exist');
  assert.equal(upstream[1], '127.0.0.1:8789');
  assert.doesNotMatch(conf, /^\s*server\s+\S*:878[78];/m, 'the proxy must never target a protected port');
  // Nothing in the template publishes the application port itself.
  assert.doesNotMatch(conf, /listen\s+8789/, 'the production application port must never be opened publicly');
  assert.doesNotMatch(conf, /listen\s+0\.0\.0\.0:8789/);
});

test('the systemd unit runs the preflight and the supervisor, and documents the port boundary', () => {
  const unit = fs.readFileSync('ops/runtime-ownership/blackspire-command.service', 'utf8');
  assert.match(unit, /ExecStartPre=.*verify-environment\.sh vps-production/);
  assert.match(unit, /ExecStart=.*production-supervisor\.js/);
  assert.match(unit, /BIND_HOST=127\.0\.0\.1/);
  assert.match(unit, /8788/, 'the unit must document that restricted staging keeps 8788');
});

test('the approved production profile pins loopback and an explicit non-conflicting port', () => {
  const profile = fs.readFileSync('scripts/production-profile.env.example', 'utf8');
  assert.match(profile, /^BIND_HOST=127\.0\.0\.1$/m);
  const port = profile.match(/^PORT=(\d+)$/m);
  assert.ok(port, 'the profile must set an explicit port');
  assert.equal(PROTECTED_PORTS.includes(Number(port[1])), false, 'the profile must not use a protected port');
  assert.equal(port[1], '8789');
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
