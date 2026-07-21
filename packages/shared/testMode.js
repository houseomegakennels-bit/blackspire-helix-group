import path from 'node:path';
import { DB_PATH } from './config.js';

const CREDENTIAL_KEYS = [
  'TELEGRAM_BOT_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY',
  'TELEGRAM_WEBHOOK_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN',
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
  if (!env.UNIFIED_TEST_ACCESS_CODE || env.UNIFIED_TEST_ACCESS_CODE.length < 12) errors.push('test mode requires a one-time access code');
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

// Canonical authorization for the bounded, read-only mock acceptance path. This
// is the ONLY sanctioned way a synthetic task may complete against the mock
// provider without a real credential. Every required condition is derived and
// verified from canonical backend state here — never from a frontend flag or a
// request-controlled value alone. Production keeps deny-by-default: outside a
// fully valid test-mode configuration this returns { ok: false } and the caller
// must fail closed rather than fall through to the real provider pipeline.
export function authorizeReadOnlyTestTask(workspace, env = process.env) {
  const config = testModeConfig(env);
  if (!config.enabled) return { ok: false, reason: 'test mode not enabled', config };
  if (!config.ok) return { ok: false, reason: `test mode configuration invalid: ${config.errors.join('; ')}`, config };
  if (!workspace) return { ok: false, reason: 'workspace missing', config };
  if (workspace.id !== config.workspaceId) return { ok: false, reason: 'task is not in the designated synthetic test workspace', config };
  const preferred = workspace.provider_policy?.preferred || [];
  if (preferred.length !== 1 || preferred[0] !== 'mock') return { ok: false, reason: 'designated test workspace must permit the mock provider only', config };
  if (env.HERMES_TEST_PROVIDER !== 'mock') return { ok: false, reason: 'mock Hermes provider required', config };
  if ((env.BLACKSPIRE_HERMES_MODE || 'mock') !== 'mock') return { ok: false, reason: 'mock Hermes mode required', config };
  if ((env.BLACKSPIRE_RUNTIME_MODE || 'mock') === 'production') return { ok: false, reason: 'production runtime cannot use the mock acceptance path', config };
  return { ok: true, reason: 'bounded mock acceptance path authorized', config };
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
