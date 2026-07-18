import path from 'node:path';
import { DB_PATH } from './config.js';

const CREDENTIAL_KEYS = [
  'TELEGRAM_BOT_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY',
  'TELEGRAM_WEBHOOK_SECRET',
];

export function testModeConfig(env = process.env, now = Date.now()) {
  const enabled = env.UNIFIED_IPHONE_TEST_MODE === 'true';
  const expiresAt = Date.parse(env.UNIFIED_TEST_EXPIRES_AT || '');
  const dbPath = path.resolve(env.BLACKSPIRE_DB_PATH || DB_PATH);
  const errors = [];
  if (!enabled) return { enabled: false, ok: true, errors: [] };
  if (env.NODE_ENV !== 'test') errors.push('test mode requires NODE_ENV=test');
  if (env.HERMES_TEST_PROVIDER !== 'mock') errors.push('test mode requires mock Hermes');
  if (env.TELEGRAM_MODE !== 'mock') errors.push('test mode requires mock Telegram');
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 4 * 60 * 60 * 1000) errors.push('test mode expiry must be within four hours');
  if (!dbPath.startsWith('/tmp/') && !dbPath.includes('blackspire-test')) errors.push('test mode database must be disposable');
  for (const key of CREDENTIAL_KEYS) if (env[key]) errors.push(`test mode forbids ${key}`);
  return {
    enabled: true,
    ok: errors.length === 0,
    errors,
    expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null,
    workspaceId: env.UNIFIED_TEST_WORKSPACE_ID || 'iphone-test',
    testActor: env.UNIFIED_TEST_ACTOR_ID || 'iphone-test-operator',
    channelKey: env.UNIFIED_TEST_CHANNEL_KEY || 'iphone-test-chat',
    workspaceRoot: path.resolve(env.UNIFIED_TEST_WORKSPACE_ROOT || path.dirname(dbPath)),
    dbPath,
    provider: env.HERMES_TEST_PROVIDER || 'unconfigured',
    telegram: env.TELEGRAM_MODE || 'unconfigured',
  };
}

export function requireSafeTestMode(env = process.env) {
  const config = testModeConfig(env);
  if (config.enabled && !config.ok) throw new Error(`Unsafe Unified iPhone test configuration: ${config.errors.join('; ')}`);
  return config;
}

export function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const expectedHost = process.env.UNIFIED_TEST_ALLOWED_HOST || req.headers.host;
  try { return new URL(origin).host === expectedHost; } catch { return false; }
}

export function testModeAllowsRequest(pathname, method) {
  if (method === 'GET' && ['/', '/jarvis', '/manifest.webmanifest', '/sw.js', '/health'].includes(pathname)) return true;
  if (pathname === '/api/test-mode' && method === 'GET') return true;
  if (pathname === '/api/test-mode/session' && method === 'POST') return true;
  if (pathname.startsWith('/api/test-mode/')) return true;
  if (pathname === '/api/auth/session' || pathname === '/api/auth/logout') return true;
  if (pathname === '/api/unified-input' && method === 'POST') return true;
  if (pathname === '/api/workspaces' && method === 'GET') return true;
  if (pathname === '/api/tasks' && method === 'GET') return true;
  if (/^\/api\/tasks\/[^/]+$/.test(pathname) && method === 'GET') return true;
  if (/^\/api\/tasks\/[^/]+\/cancel$/.test(pathname) && method === 'POST') return true;
  if (/^\/api\/conversations\/[^/]+(?:\/events)?$/.test(pathname) && method === 'GET') return true;
  return false;
}

export function publicTestModeStatus(config) {
  return {
    enabled: config.enabled,
    expiresAt: config.expiresAt,
    workspaceId: config.workspaceId,
    testActor: config.testActor,
    provider: config.provider,
    telegram: config.telegram,
    productionData: false,
    externalProviders: false,
  };
}
