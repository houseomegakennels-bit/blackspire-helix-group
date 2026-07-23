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
  isStagingProfile,
  PRODUCTION_BIND_HOST,
  PROTECTED_PORTS,
  PRODUCTION_PORT_CANDIDATES,
} from '../packages/shared/bind.js';
import { verifyVpsRuntime } from '../packages/shared/security.js';
import { prepareDisposableDatabase } from './helpers/prepare-disposable-database.js';

const node = process.execPath;

// Real host locations this suite must never read, create, chmod, chown, or remove. The production
// runtime verifier calls mkdir on whatever release root it is handed, so a fixture pointing at a
// real path would create production state on any host where the test user can write there.
const REAL_PRODUCTION_PATHS = ['/opt/blackspire-command', '/etc/blackspire', '/var/lib/blackspire'];

// scripts/verify-environment.sh rejects a /tmp database as non-persistent, so the disposable root
// has to live outside /tmp while staying entirely throwaway. /var/tmp is world-writable and sticky
// on every supported host, and RUNNER_TEMP covers hosted CI.
const disposableBase = ['/var/tmp', process.env.RUNNER_TEMP, os.tmpdir()]
  .filter((base) => typeof base === 'string' && base.length > 0)
  .find((base) => {
    try {
      fs.accessSync(base, fs.constants.W_OK);
      return !`${path.resolve(base)}${path.sep}`.startsWith(`${path.sep}tmp${path.sep}`);
    } catch {
      return false;
    }
  });
assert.ok(disposableBase, 'no writable disposable base directory outside /tmp is available');

const root = fs.mkdtempSync(path.join(disposableBase, 'blackspire-bind-boundary-'));
const disposableReleaseRoot = path.join(root, 'release-root');
const disposableShared = path.join(disposableReleaseRoot, 'shared');
const disposableDbPath = path.join(disposableShared, 'database', 'command.sqlite');
const disposablePersistentDirs = ['database', 'evidence', 'backups', 'logs'].map((name) => path.join(disposableShared, name));
for (const dir of disposablePersistentDirs) fs.mkdirSync(dir, { recursive: true });

// The runtime refuses to run as root. A test process that starts as root spawns production children
// under an unprivileged identity so they reach the check under test rather than the root refusal.
const UNPRIVILEGED_UID = 65534;

function usernameForUid(uid) {
  const resolved = spawnSync('id', ['-nu', String(uid)], { encoding: 'utf8' });
  assert.equal(resolved.status, 0, `unable to resolve the unprivileged test user: ${resolved.stderr}`);
  return resolved.stdout.trim();
}

function productionChildIdentity() {
  if (process.getuid() !== 0) return { uid: process.getuid(), username: os.userInfo().username, spawnOptions: {} };
  return { uid: UNPRIVILEGED_UID, username: usernameForUid(UNPRIVILEGED_UID), spawnOptions: { uid: UNPRIVILEGED_UID, gid: UNPRIVILEGED_UID } };
}

// Ownership of the disposable tree only — never of a real path. The runtime requires every
// persistent directory to be owned by the runtime user, so the fixture has to satisfy that too.
function grantDisposableRootTo(uid) {
  if (uid === process.getuid()) return;
  for (const dir of [root, disposableReleaseRoot, disposableShared, ...disposablePersistentDirs]) {
    fs.chmodSync(dir, 0o755);
    fs.chownSync(dir, uid, uid);
  }
}

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
    BLACKSPIRE_RELEASE_ROOT: disposableReleaseRoot,
    BLACKSPIRE_DB_PATH: disposableDbPath,
    TELEGRAM_TMP_DIR: path.join(root, 'attachments'),
    ...overrides,
  };
}

// The shell preflight fixture. It carries the same disposable paths plus the credentials the
// production profile requires, so a failure can only come from the value under test.
function productionShellEnv(overrides = {}) {
  return {
    ...productionEnv(),
    COMMAND_ADMIN_TOKEN: 'x'.repeat(32),
    SESSION_SECRET: 'y'.repeat(40),
    ...overrides,
  };
}

// Forbidden inherited values are stripped so an inherited credential cannot turn a targeted
// assertion into a different fail-closed reason.
function productionChildEnv(overrides = {}) {
  const env = { ...process.env, ...productionEnv(overrides) };
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'CODEX_API_ENDPOINT',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'BLACKSPIRE_RUN_MIGRATIONS']) delete env[key];
  return env;
}

function assertNoRealProductionPaths(env, label) {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    for (const real of REAL_PRODUCTION_PATHS) {
      assert.equal(value.startsWith(real), false, `${label}.${key} must not reference the real production path ${real}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Host isolation: nothing here may touch real production state
// ---------------------------------------------------------------------------

test('every fixture environment resolves to disposable paths and never a real production path', () => {
  assertNoRealProductionPaths(productionEnv(), 'productionEnv()');
  assertNoRealProductionPaths(productionShellEnv(), 'productionShellEnv()');
  assertNoRealProductionPaths(devEnv('path-isolation'), 'devEnv()');

  for (const [label, env] of [['productionEnv()', productionEnv()], ['productionShellEnv()', productionShellEnv()]]) {
    assert.equal(env.BLACKSPIRE_RELEASE_ROOT, disposableReleaseRoot, `${label} must use the disposable release root`);
    assert.ok(env.BLACKSPIRE_DB_PATH.startsWith(`${root}${path.sep}`), `${label} database must live inside the disposable root`);
    assert.ok(env.TELEGRAM_TMP_DIR.startsWith(`${root}${path.sep}`), `${label} attachments must live inside the disposable root`);
  }

  // The runtime derives shared/database, shared/evidence, and shared/backups from the release
  // root, so pinning the release root is what keeps mkdir off the real host.
  for (const dir of disposablePersistentDirs) {
    assert.ok(dir.startsWith(`${disposableShared}${path.sep}`));
    assert.equal(fs.statSync(dir).isDirectory(), true);
  }
  assert.ok(root.startsWith(`${disposableBase}${path.sep}`), 'the disposable root must live under the chosen disposable base');
  for (const real of REAL_PRODUCTION_PATHS) {
    assert.equal(root.startsWith(real), false, 'the disposable root must never sit inside a real production path');
  }
});

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

// The markers the deployed restricted-staging unit actually sets, from its EnvironmentFile:
// NODE_ENV and BLACKSPIRE_RUNTIME_MODE are production for hardened behavior, the state owner is
// vps-staging, the port is 8788, and BIND_HOST is absent. The previous fixture supplied only
// BIND_HOST and PORT, which is not a profile any deployment uses - that is why a classifier that
// let the runtime mode outrank the state owner passed its tests while breaking staging startup.
function deployedStagingEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    BLACKSPIRE_RUNTIME_MODE: 'production',
    BLACKSPIRE_STATE_OWNER: 'vps-staging',
    BLACKSPIRE_PROVIDER_MODE: 'manual',
    BLACKSPIRE_HERMES_MODE: 'restricted',
    TELEGRAM_MODE: 'dry-run',
    UNIFIED_IPHONE_TEST_MODE: 'false',
    PORT: '8788',
    ...overrides,
  };
}

test('the deployed restricted-staging profile resolves loopback 8788 and is never production', () => {
  const env = deployedStagingEnv();
  assert.equal(Object.hasOwn(env, 'BIND_HOST'), false, 'the deployed staging profile sets no BIND_HOST');

  assert.equal(isProductionProfile(env), false, 'an explicit vps-staging owner is never the production profile');
  assert.equal(isStagingProfile(env), true);

  const staging = resolveBindTarget(env);
  assert.equal(staging.ok, true, staging.errors.join('; '));
  assert.equal(staging.production, false);
  assert.equal(staging.staging, true);
  assert.equal(staging.host, '127.0.0.1', 'restricted staging resolves the private loopback host without one being passed');
  assert.equal(staging.port, 8788, 'staging keeps its own port');
  assert.deepEqual(staging.errors, [], 'the production reserved-port rule must not apply to vps-staging');

  // An explicit loopback host is still honored, matching the launcher that passes one today.
  const explicit = resolveBindTarget(deployedStagingEnv({ BIND_HOST: '127.0.0.1' }));
  assert.equal(explicit.ok, true);
  assert.equal(explicit.host, '127.0.0.1');
  assert.equal(explicit.port, 8788);
});

test('vps-production with the same missing BIND_HOST and port 8788 still fails closed', () => {
  const production = resolveBindTarget(deployedStagingEnv({ BLACKSPIRE_STATE_OWNER: 'vps-production' }));
  assert.equal(production.ok, false, 'production must not inherit the staging relaxation');
  assert.equal(production.production, true);
  assert.equal(production.host, null);
  assert.equal(production.port, null);
  assert.match(production.errors.join('; '), /BIND_HOST must be set/);
  assert.match(production.errors.join('; '), /8788 is reserved/);
});

test('an explicit state owner outranks the runtime mode when classifying the profile', () => {
  // vps-production + runtime production: production.
  assert.equal(isProductionProfile({ BLACKSPIRE_STATE_OWNER: 'vps-production', BLACKSPIRE_RUNTIME_MODE: 'production' }), true);
  // vps-staging + runtime production: not production. This is the deployed staging case.
  assert.equal(isProductionProfile({ BLACKSPIRE_STATE_OWNER: 'vps-staging', BLACKSPIRE_RUNTIME_MODE: 'production' }), false);
  // Any other explicit owner + runtime production: not production here, and never silently
  // authorized either - the runtime requires the owner to be exactly vps-production, asserted below.
  for (const owner of ['codespace-disposable', 'development', 'vps-prod', 'VPS-PRODUCTION', 'vps-production-2']) {
    assert.equal(isProductionProfile({ BLACKSPIRE_STATE_OWNER: owner, BLACKSPIRE_RUNTIME_MODE: 'production' }), false, `${owner} must not be the production profile`);
  }
  // Absent or blank owner + runtime production: the runtime mode decides, so a partially
  // populated production environment stays fail-closed.
  assert.equal(isProductionProfile({ BLACKSPIRE_RUNTIME_MODE: 'production' }), true);
  assert.equal(isProductionProfile({ BLACKSPIRE_STATE_OWNER: '', BLACKSPIRE_RUNTIME_MODE: 'production' }), true);
  assert.equal(isProductionProfile({ BLACKSPIRE_STATE_OWNER: '   ', BLACKSPIRE_RUNTIME_MODE: 'production' }), true);
  // Missing owner + non-production runtime: not production.
  assert.equal(isProductionProfile({}), false);
  assert.equal(isProductionProfile({ NODE_ENV: 'production' }), false);
  assert.equal(isProductionProfile({ BLACKSPIRE_RUNTIME_MODE: 'development' }), false);
});

test('an unrecognized state owner cannot obtain the production runtime', () => {
  // The classifier alone would treat these as non-production and skip the bind contract, so the
  // runtime itself refuses them: an unknown owner never reaches a listener.
  const opts = {
    uid: 1001, username: 'blackspire', nodeVersion: '22.23.1',
    isWritable: () => true, dirOwnerUid: () => 1001, dirExists: () => true,
  };
  for (const owner of ['vps-staging', 'vps-prod', 'VPS-PRODUCTION', 'codespace-disposable', '']) {
    const r = verifyVpsRuntime(productionEnv({ BLACKSPIRE_STATE_OWNER: owner }), opts);
    assert.equal(r.ok, false, `owner ${JSON.stringify(owner)} must be refused by the production runtime`);
    assert.match(r.errors.join('; '), /BLACKSPIRE_STATE_OWNER must be exactly vps-production/);
  }
  assert.equal(verifyVpsRuntime(productionEnv(), opts).ok, true, 'the approved owner still passes');

  // The shell preflight enforces the same value as the systemd ExecStartPre.
  const preflight = spawnSync('bash', ['scripts/verify-environment.sh', 'vps-production'], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ...productionShellEnv({ BLACKSPIRE_STATE_OWNER: 'vps-prod' }) },
  });
  assert.notEqual(preflight.status, 0, `an unrecognized owner must fail the preflight: ${preflight.stderr}`);
  assert.match(preflight.stderr, /production state owner must be vps-production/);
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
  const base = productionShellEnv();
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

// Disposable port allocation. The kernel picks an ephemeral port, the test owns it outright, and
// the value is proven to be outside the protected range before anything binds it — so no test can
// contact, disturb, or depend on the real 8787 and 8788 listeners.
async function occupyDisposablePort() {
  const listener = net.createServer((socket) => socket.end());
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  const { port } = listener.address();
  assert.equal(PROTECTED_PORTS.includes(port), false, `a disposable test port must never collide with ${PROTECTED_PORTS.join(' or ')}`);
  assert.ok(port >= 1024 && port <= 65535, 'a disposable test port must be unprivileged and in range');
  return { listener, port };
}

async function reserveFreePort() {
  const { listener, port } = await occupyDisposablePort();
  await new Promise((resolve) => listener.close(resolve));
  const availability = await probePortAvailable('127.0.0.1', port);
  assert.equal(availability.free, true, 'the reserved disposable port must be verified free before use');
  return port;
}

function closeListener(listener) {
  return new Promise((resolve) => (listener.listening ? listener.close(resolve) : resolve()));
}

function bootApi(env, { waitForExit = false } = {}) {
  prepareDisposableDatabase(env.BLACKSPIRE_DB_PATH);
  return new Promise((resolve) => {
    const child = spawn(node, ['apps/api/server.js'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, waitForExit ? 4000 : 2000);
    // Always resolve on the real exit so the child is reaped rather than left behind.
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ exited: !killed, code, stdout, stderr, child });
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

// The restricted staging unit does not run apps/api/server.js as an entry point: it imports the
// module and calls start(port, '127.0.0.1'). Exiting only for an entry point therefore left an
// imported startup logging a listen failure and staying alive with no listener. This boots the
// server exactly the way that unit does.
function bootImportedApi(env, port, host = '127.0.0.1') {
  prepareDisposableDatabase(env.BLACKSPIRE_DB_PATH);
  const moduleUrl = new URL('../apps/api/server.js', import.meta.url).href;
  const launcher = `import(${JSON.stringify(moduleUrl)})`
    + `.then((m) => m.start(Number(process.env.PORT), ${JSON.stringify(host)}))`
    + `.catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });`;
  return new Promise((resolve) => {
    const child = spawn(node, ['-e', launcher], {
      env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 8000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ exited: !killed, code, stdout, stderr, child });
    });
  });
}

test('an imported non-production startup exits on an occupied port', async (t) => {
  const { listener, port } = await occupyDisposablePort();
  t.after(() => closeListener(listener));

  const env = devEnv('imported-occupied');
  const result = await bootImportedApi(env, port);
  t.after(() => { if (result.child.exitCode === null) result.child.kill('SIGKILL'); });

  // The profile under test really is non-production: this proves the exit does not come from the
  // production branch, which is exactly the gap the entry-point-only condition left open.
  assert.equal(resolveBindTarget(env).production, false, 'this fixture must exercise the non-production path');
  assert.equal(result.exited, true, `an imported startup must exit rather than linger: ${result.stderr}`);
  assert.equal(result.code, 1, `the exit must be nonzero: ${result.stderr}`);
  assert.match(result.stderr, new RegExp(`port ${port} is already in use; refusing to start without a fallback`));
  assert.doesNotMatch(result.stdout, /"service":"api"/, 'no listener may be announced after a conflict');

  // The listener the test owns is untouched and still holds the port.
  assert.equal(listener.listening, true, 'the existing listener must remain healthy');
  const stillBusy = await probePortAvailable('127.0.0.1', port);
  assert.equal(stillBusy.free, false);
  assert.equal(stillBusy.code, 'EADDRINUSE');
});

test('the imported staging launcher starts and stops cleanly on a free port', async (t) => {
  // The same import path must still work, so the exit-on-error default cannot be mistaken for
  // "imported startup always dies".
  const port = await reserveFreePort();
  const result = await new Promise((resolve) => {
    const env = devEnv('imported-free');
    prepareDisposableDatabase(env.BLACKSPIRE_DB_PATH);
    const moduleUrl = new URL('../apps/api/server.js', import.meta.url).href;
    const child = spawn(node, ['-e', `import(${JSON.stringify(moduleUrl)}).then((m) => m.start(Number(process.env.PORT), '127.0.0.1'));`], {
      env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('"service":"api"')) resolve({ stdout, child });
    });
    setTimeout(() => resolve({ stdout, child }), 6000);
  });
  t.after(() => new Promise((resolve) => {
    if (result.child.exitCode !== null) return resolve();
    result.child.once('exit', () => resolve());
    result.child.kill('SIGKILL');
  }));
  const line = result.stdout.split('\n').find((entry) => entry.includes('"service":"api"'));
  assert.ok(line, `the imported startup must announce its listener: ${result.stdout}`);
  const startup = JSON.parse(line);
  assert.equal(startup.host, '127.0.0.1');
  assert.equal(startup.port, port);
});

test('BIND_HOST reaches the real server.listen call', async (t) => {
  // The port is allocated by the kernel and verified free rather than hardcoded, so this test
  // can never race another runtime or silently reuse a candidate production port.
  const port = await reserveFreePort();
  const result = await bootApi(devEnv('bound-loopback', { BIND_HOST: '127.0.0.1', PORT: String(port) }));
  t.after(() => { if (result.child.exitCode === null) result.child.kill('SIGKILL'); });
  assert.equal(result.exited, false, `API should have stayed up: ${result.stderr}`);
  const line = result.stdout.split('\n').find((entry) => entry.includes('"service":"api"'));
  assert.ok(line, `expected a startup line, got: ${result.stdout}`);
  const startup = JSON.parse(line);
  assert.equal(startup.host, '127.0.0.1', 'the configured BIND_HOST must reach the listener');
  assert.equal(startup.port, port);
});

test('an occupied port fails closed and leaves the existing listener healthy', async (t) => {
  const { listener, port } = await occupyDisposablePort();
  t.after(() => closeListener(listener));
  const result = await bootApi(devEnv('occupied', { BIND_HOST: '127.0.0.1', PORT: String(port) }), { waitForExit: true });
  t.after(() => { if (result.child.exitCode === null) result.child.kill('SIGKILL'); });
  assert.equal(result.exited, true, `the API must exit rather than serve on a conflicting port: ${result.stderr}`);
  assert.equal(result.code, 1);
  // The exact documented conflict, not merely a nonzero exit: a generic failure would otherwise
  // pass this test for an unrelated reason.
  assert.match(result.stderr, new RegExp(`port ${port} is already in use`));
  assert.match(result.stderr, /refusing to start without a fallback/);
  assert.doesNotMatch(result.stderr, /Cannot find module|SQLITE|not writable|ENOENT/, 'the failure must be the port conflict, not a broken fixture');
  assert.doesNotMatch(result.stdout, /"service":"api"/, 'no listener may be announced after a conflict');
  assert.equal(listener.listening, true, 'the pre-existing listener must be untouched and healthy');
  // The listener the test owns is still the one serving that port after the conflict.
  const stillBusy = await probePortAvailable('127.0.0.1', port);
  assert.equal(stillBusy.free, false, 'the original test listener must still hold the port');
  assert.equal(stillBusy.code, 'EADDRINUSE');
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

// The supervisor verifies the whole runtime before it ever probes the port, and reports every
// failed requirement together. A fixture that trips an earlier requirement would therefore exit
// nonzero without reaching the check under test, so each supervisor test below states which
// documented reason it expects and rejects the others by name.
function runSupervisor(env, spawnOptions = {}) {
  return spawnSync(node, ['scripts/production-supervisor.js'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 20000, env, ...spawnOptions,
  });
}

const SUPERVISOR_REASONS = {
  root: 'The production runtime must not run as root.',
  dbParent: 'The persistent database parent directory does not exist.',
  conflict: 'refusing to start without a fallback port',
};

function assertOnlyReason(stderr, expected, context) {
  assert.match(stderr, new RegExp(escapeForRegExp(SUPERVISOR_REASONS[expected])), `${context}: ${stderr}`);
  for (const [name, reason] of Object.entries(SUPERVISOR_REASONS)) {
    if (name === expected) continue;
    assert.doesNotMatch(stderr, new RegExp(escapeForRegExp(reason)), `${context} must not also fail for ${name}: ${stderr}`);
  }
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('the production supervisor refuses to run as root with the exact documented reason', (t) => {
  if (process.getuid() !== 0) {
    t.skip('this host does not run the suite as root, so the root refusal cannot be exercised here');
    return;
  }
  // Deliberately not dropping privilege: root is the condition under test. Every other
  // requirement is satisfied so the root refusal is the only reason the supervisor can give.
  const r = runSupervisor(productionChildEnv({ BLACKSPIRE_RUNTIME_USER: os.userInfo().username }));
  assert.equal(r.status, 1, `the supervisor must fail closed as root: ${r.stderr}`);
  assert.match(r.stderr, /fatal: production runtime verification failed/);
  assertOnlyReason(r.stderr, 'root', 'the root refusal');
});

test('the production supervisor refuses a missing persistent database parent directory', () => {
  const identity = productionChildIdentity();
  grantDisposableRootTo(identity.uid);
  // The absent parent is inside the disposable root, so the refusal is provoked without any
  // real host path being read or created.
  const absentParent = path.join(root, 'absent-database-parent');
  assert.equal(fs.existsSync(absentParent), false, 'the fixture must start from a genuinely absent directory');
  const r = runSupervisor(productionChildEnv({
    BLACKSPIRE_RUNTIME_USER: identity.username,
    BLACKSPIRE_DB_PATH: path.join(absentParent, 'command.sqlite'),
  }), identity.spawnOptions);
  assert.equal(r.status, 1, `the supervisor must fail closed: ${r.stderr}`);
  assert.match(r.stderr, /fatal: production runtime verification failed/);
  assertOnlyReason(r.stderr, 'dbParent', 'the missing database parent refusal');
  assert.ok(absentParent.startsWith(`${root}${path.sep}`), 'the provoked path must be disposable');
});

test('the production supervisor refuses an occupied port without touching the listener', async (t) => {
  const identity = productionChildIdentity();
  grantDisposableRootTo(identity.uid);
  const { listener, port } = await occupyDisposablePort();
  t.after(() => closeListener(listener));

  const r = runSupervisor(productionChildEnv({
    BLACKSPIRE_RUNTIME_USER: identity.username,
    PORT: String(port),
  }), identity.spawnOptions);

  // Everything before the port preflight is expected to pass, so the supervisor must have
  // reached the conflict itself rather than exiting for an unrelated reason.
  assert.doesNotMatch(r.stderr, /production runtime verification failed/, `runtime verification should have passed: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /production bind verification failed/, `bind verification should have passed: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /Cannot find module|SQLITE|ENOENT|EACCES/, `the failure must be the port conflict, not a broken fixture: ${r.stderr}`);
  assert.equal(r.status, 1, `the supervisor must fail closed: ${r.stderr}`);
  assert.match(r.stderr, /fatal: production port conflict/);
  assert.match(r.stderr, new RegExp(`127\\.0\\.0\\.1:${port} is already in use`));
  assertOnlyReason(r.stderr, 'conflict', 'the port conflict refusal');

  // The listener the test owns is the one still holding the port, untouched and unsignalled.
  assert.equal(listener.listening, true, 'the existing listener must remain healthy');
  const stillBusy = await probePortAvailable('127.0.0.1', port);
  assert.equal(stillBusy.free, false, 'the original test listener must still hold the port');
  assert.equal(stillBusy.code, 'EADDRINUSE');
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

// scripts/health-check.sh runs the same contract: an explicit target or a clean refusal. Its
// former ${PORT:-8790} fallback would have contacted a production-candidate port nobody asked for.
function runHealthCheck(overrides = {}, args = []) {
  const env = { ...process.env, PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH}` };
  delete env.PORT;
  delete env.BLACKSPIRE_HEALTH_URL;
  delete env.BIND_HOST;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]; else env[key] = value;
  }
  return spawnSync('bash', ['scripts/health-check.sh', ...args], { cwd: process.cwd(), encoding: 'utf8', env, timeout: 20000 });
}

// The health listener runs in its own process: spawnSync blocks this process's event loop, so an
// in-process server could never answer the very request under test.
const HEALTH_STUB = `
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'blackspire-command-api' }));
  });
  server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => process.stdout.write(String(server.address().port) + '\\n'));
`;

function serveDisposableHealth() {
  return new Promise((resolve, reject) => {
    const child = spawn(node, ['-e', HEALTH_STUB], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the disposable health listener never reported a port')); }, 10000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (!out.includes('\n')) return;
      clearTimeout(timer);
      resolve({ child, port: Number(out.trim()) });
    });
  });
}

function stopDisposableHealth(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

test('health-check.sh has no implicit port fallback and fails closed without a target', () => {
  const script = fs.readFileSync('scripts/health-check.sh', 'utf8');
  const executable = script.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  // ${PORT:-} is the explicit "no default" form; ${PORT:-8790} is the fallback that was removed.
  assert.doesNotMatch(executable, /\$\{PORT:-[^}]/, 'PORT must never carry a default value');
  assert.doesNotMatch(executable, /8790/, 'the removed production-candidate fallback must not return');
  for (const protectedPort of PROTECTED_PORTS) {
    assert.doesNotMatch(executable, new RegExp(String(protectedPort)), `${protectedPort} must never be reachable implicitly`);
  }

  const missing = runHealthCheck();
  assert.equal(missing.status, 2, `a missing target must fail closed: ${missing.stderr}`);
  assert.match(missing.stderr, /health-check requires PORT \(or an explicit health URL\); there is no default/);
  assert.equal(missing.stdout, '', 'no health result may be reported without a target');
});

test('health-check.sh rejects a malformed port without leaking values', () => {
  for (const value of ['abc', '0', '08790', ' 8790', '8790 ', '-1', '87.90', '999999']) {
    const r = runHealthCheck({ PORT: value, COMMAND_ADMIN_TOKEN: 'super-secret-value' });
    assert.equal(r.status, 2, `${JSON.stringify(value)} must be rejected: ${r.stderr}`);
    assert.match(r.stderr, /health-check PORT must be an explicit decimal integer|health-check requires PORT/);
    assert.doesNotMatch(r.stderr, /super-secret-value/, 'errors must never contain secrets');
    assert.doesNotMatch(r.stderr, new RegExp(escapeForRegExp(value.trim() || 'unset')), 'errors must not echo the rejected value');
  }
});

test('health-check.sh succeeds against an explicit disposable loopback port', async (t) => {
  const { child, port } = await serveDisposableHealth();
  t.after(() => stopDisposableHealth(child));
  assert.equal(PROTECTED_PORTS.includes(port), false, 'the disposable health listener must not hold a protected port');

  const r = runHealthCheck({ PORT: String(port), BIND_HOST: '127.0.0.1' });
  assert.equal(r.status, 0, `an explicit loopback port must succeed: ${r.stderr}`);
  assert.match(r.stdout, /BLACKSPIRE HEALTH OK: mode=health/);

  // The same target given as an explicit URL is accepted too, matching the monitoring contract.
  const viaUrl = runHealthCheck({ BLACKSPIRE_HEALTH_URL: `http://127.0.0.1:${port}` });
  assert.equal(viaUrl.status, 0, `an explicit health URL must succeed: ${viaUrl.stderr}`);
  assert.match(viaUrl.stdout, /BLACKSPIRE HEALTH OK: mode=health/);
});

test('the shared config exposes no second port source of truth', () => {
  const config = fs.readFileSync('packages/shared/config.js', 'utf8');
  const executable = config.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(executable, /export const PORT/, 'the unused PORT export must not return');
  assert.doesNotMatch(executable, /process\.env\.PORT/, 'the port must come from the canonical bind contract only');
  assert.doesNotMatch(executable, /8787/, 'no second 8787 default may exist outside packages/shared/bind.js');
  assert.match(executable, /resolveBindTarget/, 'the base URL must derive from the canonical contract');
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

test('the systemd unit pins an absolute Node interpreter that satisfies the node:sqlite requirement', () => {
  // systemd's manager PATH does not include /opt/nodejs, so `/usr/bin/env node` resolves to the
  // distribution node (18.x on the durable VPS). The control plane imports node:sqlite, which does
  // not exist before Node 22.5, so an unpinned ExecStart fails every start and exhausts
  // StartLimitBurst. This asserts the unit names the interpreter absolutely and that the pinned
  // version still matches the repository's own Node pin.
  const unit = fs.readFileSync('ops/runtime-ownership/blackspire-command.service', 'utf8');
  const execStart = unit.match(/^ExecStart=(\S+)/m);
  assert.ok(execStart, 'the unit must declare ExecStart');
  const interpreter = execStart[1];
  assert.ok(interpreter.startsWith('/'), 'ExecStart must name the interpreter by absolute path');
  assert.doesNotMatch(unit, /^ExecStart=\/usr\/bin\/env\s+node\b/m, 'ExecStart must not resolve node through PATH');
  assert.doesNotMatch(interpreter, /^\/usr\/bin\/node$/, 'ExecStart must not use the distribution node');

  const pinned = fs.readFileSync('.node-version', 'utf8').trim();
  assert.ok(interpreter.includes(pinned), `ExecStart must run the pinned Node ${pinned}, got ${interpreter}`);

  const [major, minor] = pinned.split('.').map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 5), `the pinned Node ${pinned} must provide node:sqlite`);
});

test('the systemd unit pins PATH so no startup helper can resolve the distribution node', () => {
  // ExecStartPre runs bash, which resolves `node` through PATH. systemd's manager PATH excludes
  // /opt/nodejs, so without a pinned PATH the preflight would validate /usr/bin/node (18.x) while
  // ExecStart runs the pinned 22.x interpreter -- validating a different binary than it runs.
  const unit = fs.readFileSync('ops/runtime-ownership/blackspire-command.service', 'utf8');
  const pathLine = unit.match(/^Environment=PATH=(\S+)/m);
  assert.ok(pathLine, 'the unit must pin PATH for its startup helpers');
  const execStart = unit.match(/^ExecStart=(\S+)/m);
  assert.ok(execStart, 'the unit must declare ExecStart');
  const nodeDirectory = path.dirname(execStart[1]);
  assert.equal(pathLine[1].split(':')[0], nodeDirectory, 'the pinned interpreter directory must come first on PATH');
  assert.equal(pathLine[1].split(':').includes('/usr/sbin'), false, 'the pinned PATH must stay minimal');
});

test('every production startup-path script resolves Node deterministically, never through PATH', () => {
  // A bare `node` in any of these silently becomes the distribution's Node 18 under systemd.
  const scripts = [
    'scripts/verify-environment.sh',
    'scripts/start-production.sh',
    'scripts/health-check.sh',
    'scripts/with-node.sh',
    'ops/blackspire-command-healthcheck.sh',
    'ops/runtime-ownership/verify-ownership.sh',
  ];
  for (const relative of scripts) {
    const body = fs.readFileSync(relative, 'utf8');
    assert.match(body, /node-bin\.sh/, `${relative} must source the shared Node resolver`);
    body.split('\n').forEach((line, index) => {
      if (/^\s*#/.test(line)) return;
      for (const pattern of [/(^|[^\w./$"'-])node\s+(-|--|<|scripts\/|apps\/)/, /\benv\s+node\b/, /command\s+-v\s+node/, /\bwhich\s+node\b/]) {
        assert.doesNotMatch(line, pattern, `${relative}:${index + 1} must not resolve node through PATH`);
      }
    });
  }
});

// The resolver is exercised as a program rather than asserted as source text, so a cosmetic
// reformat cannot false-fail and a real behavioural regression cannot pass unnoticed.
function resolveNode(environment) {
  return spawnSync('bash', ['-c', '. scripts/lib/node-bin.sh; blackspire_resolve_node'], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

function stubInterpreter(directory, name, output) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `#!/bin/sh\n${output}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

test('the shared Node resolver accepts only a real interpreter at or above the node:sqlite floor', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-resolver-'));
  try {
    const ok = resolveNode({ BLACKSPIRE_STATE_OWNER: '' });
    assert.equal(ok.status, 0, 'the reviewed interpreter must resolve');
    assert.match(ok.stdout.trim(), /node$/, 'the resolver must print the interpreter path');

    // Exit status alone is not evidence: /bin/true exits 0 and is not an interpreter.
    const nonInterpreter = resolveNode({ BLACKSPIRE_NODE_BIN: '/bin/true', BLACKSPIRE_STATE_OWNER: '' });
    assert.equal(nonInterpreter.status, 1, '/bin/true must be rejected');

    const malformed = stubInterpreter(directory, 'garbage', 'echo not-a-version');
    assert.equal(resolveNode({ BLACKSPIRE_NODE_BIN: malformed, BLACKSPIRE_STATE_OWNER: '' }).status, 1,
      'malformed version output must be rejected');

    const silent = stubInterpreter(directory, 'silent', 'exit 0');
    assert.equal(resolveNode({ BLACKSPIRE_NODE_BIN: silent, BLACKSPIRE_STATE_OWNER: '' }).status, 1,
      'empty version output must be rejected');

    const belowFloor = stubInterpreter(directory, 'old', 'echo v22.4.0');
    assert.equal(resolveNode({ BLACKSPIRE_NODE_BIN: belowFloor, BLACKSPIRE_STATE_OWNER: '' }).status, 1,
      'an interpreter below 22.5 must be rejected');

    const atFloor = stubInterpreter(directory, 'floor', 'echo v22.5.0');
    assert.equal(resolveNode({ BLACKSPIRE_NODE_BIN: atFloor, BLACKSPIRE_STATE_OWNER: '' }).status, 0,
      'the floor itself must be accepted outside production');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the resolver refuses any interpreter substitution under vps-production', () => {
  // /etc/blackspire/command.env is operator-managed and outside git. Without this rule an entry
  // there could make the ExecStartPre helpers validate one binary while ExecStart runs another.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-resolver-prod-'));
  try {
    const impostor = stubInterpreter(directory, 'impostor', 'echo v22.23.9');
    const substituted = resolveNode({ BLACKSPIRE_STATE_OWNER: 'vps-production', BLACKSPIRE_NODE_BIN: impostor });
    assert.equal(substituted.status, 1, 'a foreign BLACKSPIRE_NODE_BIN must be refused under vps-production');
    assert.match(substituted.stderr, /may not substitute/);

    const pathOnly = resolveNode({ BLACKSPIRE_STATE_OWNER: 'vps-production', BLACKSPIRE_REVIEWED_NODE_BIN: '/nonexistent/node' });
    assert.equal(pathOnly.status, 1, 'PATH lookup must be refused under vps-production');
    assert.match(pathOnly.stderr, /PATH lookup is refused/);

    const wrongVersion = resolveNode({ BLACKSPIRE_STATE_OWNER: 'vps-production', BLACKSPIRE_REVIEWED_NODE_BIN: impostor });
    assert.equal(wrongVersion.status, 1, 'production must require the exact reviewed version');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the unit pins the same interpreter the helpers resolve, after the operator EnvironmentFile', () => {
  const unit = fs.readFileSync('ops/runtime-ownership/blackspire-command.service', 'utf8');
  const execStart = unit.match(/^ExecStart=(\S+)/m);
  const pinned = unit.match(/^Environment=BLACKSPIRE_NODE_BIN=(\S+)$/m);
  assert.ok(execStart, 'the unit must declare ExecStart');
  assert.ok(pinned, 'the unit must pin BLACKSPIRE_NODE_BIN so ExecStartPre validates what ExecStart runs');
  assert.equal(pinned[1], execStart[1], 'the pinned interpreter and ExecStart must be the same binary');
  // systemd applies Environment= and EnvironmentFile= in file order, so the reviewed value must be
  // declared after the operator-managed file to take precedence over it.
  assert.ok(unit.indexOf('Environment=BLACKSPIRE_NODE_BIN=') > unit.indexOf('EnvironmentFile='),
    'the pinned interpreter must be declared after EnvironmentFile to override it');
});

test('activation package scripts never resolve Node through PATH', () => {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const name of ['db:migrate', 'db:backup', 'db:restore', 'start:production']) {
    const command = manifest.scripts[name];
    assert.ok(command, `${name} must exist`);
    assert.doesNotMatch(command, /(^|[^\w./$"'-])node\s/, `${name} must not invoke a PATH-resolved node`);
  }
});

test('the approved production profile pins loopback and an explicit non-conflicting port', () => {
  const profile = fs.readFileSync('scripts/production-profile.env.example', 'utf8');
  assert.match(profile, /^BIND_HOST=127\.0\.0\.1$/m);
  const port = profile.match(/^PORT=(\d+)$/m);
  assert.ok(port, 'the profile must set an explicit port');
  assert.equal(PROTECTED_PORTS.includes(Number(port[1])), false, 'the profile must not use a protected port');
  assert.equal(port[1], '8789');
});

test('the production preflight passes the source contract and is machine-readable', () => {
  const result = spawnSync(process.execPath, ['scripts/production-preflight-check.js', '--json'], { encoding: 'utf8' });
  const report = JSON.parse(result.stdout);
  assert.equal(report.sourceFailed, 0, `source contract must hold: ${JSON.stringify(report.findings.filter((f) => !f.ok && f.class === 'source'))}`);
  assert.ok(report.checked >= 15, 'the preflight must cover the whole source contract');
  assert.equal(result.status, 0, 'the preflight must exit zero when the source contract holds');
  // The installed-unit drift check is deployment-class, so host state never fails the source run.
  assert.ok(report.findings.some((finding) => finding.id === 'installed-unit' && finding.class === 'deployment'));
});

test('the production preflight is read-only and exposes no secret values', () => {
  const body = fs.readFileSync('scripts/production-preflight-check.js', 'utf8');
  for (const forbidden of ['execSync', 'spawnSync', 'spawn(', 'writeFileSync', 'mkdirSync', 'rmSync', 'unlinkSync', 'symlinkSync', 'chmodSync', 'chownSync']) {
    assert.equal(body.includes(forbidden), false, `the preflight must never call ${forbidden}`);
  }
  const result = spawnSync(process.execPath, ['scripts/production-preflight-check.js'], { encoding: 'utf8' });
  assert.doesNotMatch(result.stdout, /SESSION_SECRET=|COMMAND_ADMIN_TOKEN=\S/, 'the preflight must never print secret values');
});

test('the production preflight discovers scripts rather than trusting a hardcoded list', () => {
  const body = fs.readFileSync('scripts/production-preflight-check.js', 'utf8');
  assert.match(body, /readdirSync/, 'the preflight must discover shell scripts on disk');
  assert.match(body, /DEVELOPMENT_ONLY_SCRIPTS/, 'exclusions must be explicit and documented');
  // Indirect lookups must be detected, not just a bare `node` invocation.
  for (const indirect of ['command\\s+-v\\s+node', 'which\\s+node', 'env\\s+node']) {
    assert.ok(body.includes(indirect.replace(/\\\\s\+/g, '\\s+')) || new RegExp(indirect).test(body),
      `the preflight must detect the indirect pattern ${indirect}`);
  }
});

test('the production preflight checks the pinned interpreter exists on the host', () => {
  const result = spawnSync(process.execPath, ['scripts/production-preflight-check.js', '--json'], { encoding: 'utf8' });
  const report = JSON.parse(result.stdout);
  const interpreter = report.findings.find((finding) => finding.id === 'host-interpreter');
  assert.ok(interpreter, 'the preflight must verify the pinned interpreter on the host');
  assert.equal(interpreter.class, 'deployment', 'host interpreter presence is host state, not a source defect');
  const tooling = report.findings.find((finding) => finding.id === 'activation-tooling');
  assert.match(tooling.detail, /non-empty/, 'zero-byte tooling must be treated as missing');
  const packageScripts = report.findings.find((finding) => finding.id === 'package-scripts-pinned');
  assert.ok(packageScripts, 'activation package scripts must be covered');
});

test('the production preflight detects a stale installed unit as a deployment finding', () => {
  const result = spawnSync(process.execPath, ['scripts/production-preflight-check.js', '--json'], { encoding: 'utf8' });
  const report = JSON.parse(result.stdout);
  const installed = report.findings.find((finding) => finding.id === 'installed-unit');
  assert.ok(installed, 'the preflight must report installed-unit drift');
  assert.equal(installed.class, 'deployment', 'installed-unit drift is a deployment follow-up, not a source defect');
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
