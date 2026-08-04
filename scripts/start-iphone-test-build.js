import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configuredInteger } from '../packages/shared/runtime-numeric-config.js';

const rawPort = process.env.PORT ?? '8790';
if (!/^[0-9]+$/.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65_535 || rawPort === '8787') {
  throw new TypeError('PORT must be an unreserved integer from 1024 through 65535 for disposable iPhone test mode.');
}
const port = Number(rawPort);
const expiresAt = new Date(Date.now() + configuredInteger('UNIFIED_TEST_TTL_MS'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-iphone-build-'));

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

const [{ start }, { startWorker }, { closeDb }] = await Promise.all([import('../apps/api/server.js'), import('../apps/worker/worker.js'), import('../packages/task-engine/db.js')]);
const server = start(port, '127.0.0.1');
const worker = startWorker();
let cleaning = false;
async function cleanup(reason) {
  if (cleaning) return;
  cleaning = true;
  worker.stop();
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
  closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(JSON.stringify({ service: 'iphone-test-build', status: 'stopped', reason, cleaned: true }));
}
const timer = setTimeout(async () => { await cleanup('expired'); process.exit(0); }, expiresAt.getTime() - Date.now());
timer.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { clearTimeout(timer); await cleanup(signal); process.exit(0); });
console.log(JSON.stringify({ service: 'iphone-test-build', status: 'ready', bind: `127.0.0.1:${port}`, expiresAt: expiresAt.toISOString(), provider: 'mock', telegram: 'mock', productionData: false }));
