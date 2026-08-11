import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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
const removeData = () => fs.rmSync(dataDir, { recursive: true, force: true });
let cleanup = async () => { closeDb(); removeData(); };
let waitForServerListening;
let timer;
let shutdownPromise;
let startupChild;
let startupSucceeded = false;
function runMigrationSubprocess() {
  return new Promise((resolve, reject) => {
    startupChild = spawn(process.execPath, ['scripts/migrate.js'], {
      cwd: process.cwd(), env: { ...process.env, BLACKSPIRE_RUN_MIGRATIONS: 'true' }, stdio: 'ignore',
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
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    if (timer) clearTimeout(timer);
    try {
      if (startupChild?.exitCode === null) {
        const child = startupChild;
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        await exited;
      }
      await cleanup(reason);
      process.exitCode = 0;
    }
    catch (error) {
      console.error(JSON.stringify({ service: 'iphone-test-build', status: 'shutdown_failed', reason, error: String(error.message || error) }));
      process.exitCode = 1;
    }
  })();
  return shutdownPromise;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdownAndExit(signal); });
try {
  const cleanupModule = await import('./lib/iphone-test-cleanup.js');
  if (shutdownPromise) { await shutdownPromise; throw new Error('startup interrupted'); }
  cleanup = cleanupModule.createIphoneTestCleanup({ worker, server, closeDb, removeData });
  waitForServerListening = cleanupModule.waitForServerListening;
  await runMigrationSubprocess();
  const [{ start }, workerModule, dbModule] = await Promise.all([import('../apps/api/server.js'), import('../apps/worker/worker.js'), import('../packages/task-engine/db.js')]);
  closeDb = dbModule.closeDb;
  cleanup = cleanupModule.createIphoneTestCleanup({ worker, server, closeDb, removeData });
  // The launcher owns startup failure handling so it can remove its disposable state. Do not start
  // the worker or report readiness until the API has actually acquired its loopback listener.
  server = start(port, '127.0.0.1', { exitOnListenError: false });
  cleanup = cleanupModule.createIphoneTestCleanup({ worker, server, closeDb, removeData });
  await waitForServerListening(server);
  worker = workerModule.startWorker();
  cleanup = cleanupModule.createIphoneTestCleanup({ worker, server, closeDb, removeData });
  startupSucceeded = true;
} catch (error) {
  startupSucceeded = false;
  if (shutdownPromise) {
    await shutdownPromise;
  } else {
    try { await cleanup('startup-failure'); }
    catch (cleanupError) {
      console.error(JSON.stringify({ service: 'iphone-test-build', status: 'startup_cleanup_failed', error: String(cleanupError.message || cleanupError) }));
    }
    console.error(JSON.stringify({ service: 'iphone-test-build', status: 'startup_failed', error: String(error.message || error) }));
    process.exitCode = 1;
  }
}
if (startupSucceeded && !shutdownPromise) {
  timer = setTimeout(() => { void shutdownAndExit('expired'); }, expiresAt.getTime() - Date.now());
  timer.unref();
  console.log(JSON.stringify({ service: 'iphone-test-build', status: 'ready', bind: `127.0.0.1:${port}`, expiresAt: expiresAt.toISOString(), provider: 'mock', telegram: 'mock', productionData: false }));
}
