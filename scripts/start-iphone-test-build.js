import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Registered before the first resource-creating call below. A signal that lands between creating the
// disposable root and installing these handlers would otherwise get Node's default disposition: the
// process dies by signal and leaves the directory and its SQLite file behind. `shutdownAndExit` is a
// hoisted declaration and only ever runs on a later event-loop turn, by which point the whole module
// body -- including every binding it closes over -- has finished evaluating.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdownAndExit(signal); });

// Resolved from this file, not the cwd, so the launcher works from any working directory.
const repoRoot = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-iphone-build-'));
const port = Number(process.env.PORT || 8787);
const expiresAt = new Date(Date.now() + Math.min(Number(process.env.UNIFIED_TEST_TTL_MS || 2 * 60 * 60 * 1000), 4 * 60 * 60 * 1000));

for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'CODEX_API_ENDPOINT', 'GH_TOKEN', 'GITHUB_TOKEN']) delete process.env[key];
Object.assign(process.env, {
  NODE_ENV: 'test', UNIFIED_IPHONE_TEST_MODE: 'true', UNIFIED_TEST_EXPIRES_AT: expiresAt.toISOString(),
  UNIFIED_TEST_WORKSPACE_ID: 'iphone-test', UNIFIED_TEST_ACTOR_ID: 'iphone-test-operator', UNIFIED_TEST_CHANNEL_KEY: 'iphone-test-chat',
  UNIFIED_TEST_WORKSPACE_ROOT: dataDir, BLACKSPIRE_DATA_DIR: dataDir, BLACKSPIRE_DB_PATH: path.join(dataDir, 'iphone-test.sqlite'),
  TELEGRAM_TMP_DIR: path.join(dataDir, 'telegram-files'), COMMAND_ADMIN_TOKEN: crypto.randomBytes(32).toString('hex'), ALLOW_BEARER_AUTH: 'false',
  SECURE_COOKIES: 'true', SESSION_TTL_MS: String(expiresAt.getTime() - Date.now()), HERMES_TEST_PROVIDER: 'mock', TELEGRAM_MODE: 'mock',
  TELEGRAM_OUTBOX_MAX_ATTEMPTS: '2', TELEGRAM_OUTBOX_RETRY_SECONDS: '30', WORKER_POLL_MS: '500', PORT: String(port),
  UNIFIED_TEST_ACCESS_CODE: process.env.UNIFIED_TEST_ACCESS_CODE || crypto.randomBytes(18).toString('base64url'),
});

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('external network disabled in Unified iPhone test mode');
  return nativeFetch(input, init);
};

let server;
let worker;
let closeDb = () => {};
const removeData = () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (fs.existsSync(dataDir)) throw new Error(`disposable data directory survived removal: ${dataDir}`);
};
let cleanup = async () => { closeDb(); removeData(); };
let waitForServerListening;
let timer;
let shutdownPromise;
let shutdownRequested = null;
let startupPromise;
let startupChild;
let startupSucceeded = false;
// Signals can land at any await in the startup sequence. Every resource-creating step is guarded by
// this so an interrupted startup stops before it can create anything else.
function assertNotShuttingDown() {
  if (shutdownRequested) throw new Error(`startup interrupted by ${shutdownRequested}`);
}
async function killStartupChild() {
  if (startupChild?.exitCode === null) {
    const child = startupChild;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    // Signal the whole process group so the migration writer grandchild dies with its parent. The
    // group may already be gone between the guard and here, so fall back to the direct child.
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch { try { child.kill('SIGTERM'); } catch { /* already exited */ } }
    await exited;
  }
}
function runMigrationSubprocess() {
  return new Promise((resolve, reject) => {
    // detached makes the child a process-group leader so an interrupted startup can signal the whole
    // group. migrate.js runs its writer as a grandchild via spawnSync; signalling only the direct
    // child left that writer alive, reparented to init, still holding the disposable database while
    // the launcher removed the directory and reported a clean exit.
    startupChild = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'migrate.js')], {
      cwd: repoRoot, env: { ...process.env, BLACKSPIRE_RUN_MIGRATIONS: 'true' }, stdio: 'ignore', detached: true,
    });
    startupChild.once('error', () => reject(new Error('disposable database migration could not start')));
    startupChild.once('exit', (code, signal) => {
      startupChild = null;
      if (code === 0) resolve();
      else reject(new Error(`disposable database migration failed (${signal || 'nonzero'})`));
    });
  });
}
async function shutdownAndExit(reason) {
  shutdownRequested ??= reason;
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    if (timer) clearTimeout(timer);
    try {
      // Cleanup must never run concurrently with a startup that can still create resources, or it
      // removes the disposable root and the still-advancing startup silently re-creates it. Kill any
      // in-flight startup child so the sequence settles promptly, then wait for it to actually settle.
      await killStartupChild();
      if (startupPromise) await startupPromise.catch(() => {});
      // The sequence may have spawned its child between the kill above and observing the abort flag.
      await killStartupChild();
      await cleanup(reason);
      // The disposable root is the whole point of this launcher; never claim a clean exit on trust.
      if (fs.existsSync(dataDir)) throw new Error(`disposable data directory survived shutdown: ${dataDir}`);
      process.exitCode = 0;
    }
    catch (error) {
      console.error(JSON.stringify({ service: 'iphone-test-build', status: 'shutdown_failed', reason, error: String(error.message || error) }));
      process.exitCode = 1;
    }
  })();
  return shutdownPromise;
}
async function runStartup() {
  const cleanupModule = await import('./lib/iphone-test-cleanup.js');
  cleanup = cleanupModule.createIphoneTestCleanup({ worker, server, closeDb, removeData });
  waitForServerListening = cleanupModule.waitForServerListening;
  assertNotShuttingDown();
  // Test-only seam: lets a regression test land a signal deterministically in the window that used to
  // let cleanup race a still-advancing startup, instead of sweeping wall-clock delays.
  const pauseMs = Number(process.env.UNIFIED_TEST_STARTUP_PAUSE_MS || 0);
  if (pauseMs > 0) {
    console.log(JSON.stringify({ service: 'iphone-test-build', status: 'startup_paused', stage: 'pre-migration' }));
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    assertNotShuttingDown();
  }
  await runMigrationSubprocess();
  assertNotShuttingDown();
  const [{ start }, workerModule, dbModule] = await Promise.all([import('../apps/api/server.js'), import('../apps/worker/worker.js'), import('../packages/task-engine/db.js')]);
  closeDb = dbModule.closeDb;
  cleanup = cleanupModule.createIphoneTestCleanup({ worker, server, closeDb, removeData });
  assertNotShuttingDown();
  // The launcher owns startup failure handling so it can remove its disposable state. Do not start
  // the worker or report readiness until the API has actually acquired its loopback listener.
  server = start(port, '127.0.0.1');
  cleanup = cleanupModule.createIphoneTestCleanup({ worker, server, closeDb, removeData });
  await waitForServerListening(server);
  assertNotShuttingDown();
  worker = workerModule.startWorker();
  cleanup = cleanupModule.createIphoneTestCleanup({ worker, server, closeDb, removeData });
}

startupPromise = runStartup();
let startupError = null;
try { await startupPromise; startupSucceeded = true; }
catch (error) { startupError = error; }
if (shutdownRequested) {
  // A signal won the race: shutdownAndExit owns cleanup and the exit code, and it waited for the
  // sequence above to settle before touching anything.
  await shutdownAndExit(shutdownRequested);
} else if (startupError) {
  try { await cleanup('startup-failure'); }
  catch (cleanupError) {
    console.error(JSON.stringify({ service: 'iphone-test-build', status: 'startup_cleanup_failed', error: String(cleanupError.message || cleanupError) }));
  }
  console.error(JSON.stringify({ service: 'iphone-test-build', status: 'startup_failed', error: String(startupError.message || startupError) }));
  process.exitCode = 1;
}
if (startupSucceeded && !shutdownRequested) {
  timer = setTimeout(() => { void shutdownAndExit('expired'); }, expiresAt.getTime() - Date.now());
  timer.unref();
  console.log(JSON.stringify({ service: 'iphone-test-build', status: 'ready', bind: `127.0.0.1:${port}`, expiresAt: expiresAt.toISOString(), provider: 'mock', telegram: 'mock', productionData: false }));
}
