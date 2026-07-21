import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DB_PATH, ATTACHMENTS_DIR } from './config.js';
import { redact } from './util.js';
import { createSession, getSession, rotateSession, destroySession, revokeAllSessions, cleanupExpiredSessions } from './sessions.js';
import { rateLimit } from './rateLimits.js';

export { createSession, getSession, rotateSession, destroySession, revokeAllSessions, cleanupExpiredSessions, rateLimit };

// packages/task-engine/db.js uses node:sqlite (DatabaseSync), which does not exist before Node 22.5.0 —
// the module import itself throws on older Node, so the floor here must match that, not a generic LTS floor.
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR_AT_MIN_MAJOR = 5;

export function requireProductionSafeConfig(env = process.env, { dbDir = path.dirname(DB_PATH), attachmentsDir = ATTACHMENTS_DIR } = {}) {
  const errors = [];
  if (env.NODE_ENV === 'production') {
    if (env.BLACKSPIRE_RUNTIME_MODE === 'production') {
      if (env.BLACKSPIRE_PROVIDER_MODE !== 'manual') errors.push('BLACKSPIRE_PROVIDER_MODE must be manual in the approved no-provider production profile.');
      if (env.BLACKSPIRE_HERMES_MODE === 'mock') errors.push('BLACKSPIRE_HERMES_MODE=mock is not allowed in production.');
      if (env.UNIFIED_IPHONE_TEST_MODE === 'true') errors.push('UNIFIED_IPHONE_TEST_MODE=true is not allowed in production.');
      if (!['', 'dry-run', undefined].includes(env.TELEGRAM_MODE)) errors.push('TELEGRAM_MODE must remain dry-run or unset in the no-provider production profile.');
      for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'CODEX_API_ENDPOINT', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']) {
        if (env[key]) errors.push(`${key} is forbidden in the no-provider production profile.`);
      }
    }
    if (!env.COMMAND_ADMIN_TOKEN || env.COMMAND_ADMIN_TOKEN === 'dev-admin-token-change-me' || env.COMMAND_ADMIN_TOKEN.length < 24) errors.push('Set a strong COMMAND_ADMIN_TOKEN before production use.');
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) errors.push('Set SESSION_SECRET to at least 32 characters.');
    if (env.SECURE_COOKIES === 'false') errors.push('SECURE_COOKIES=false is not allowed in production.');
    if (!env.PUBLIC_BASE_URL?.startsWith('https://')) errors.push('PUBLIC_BASE_URL must be HTTPS in production.');
    if (env.TELEGRAM_MODE === 'webhook' && !env.TELEGRAM_WEBHOOK_SECRET) errors.push('TELEGRAM_WEBHOOK_SECRET is required in webhook mode.');
    if (env.DEBUG === 'true') errors.push('DEBUG=true is not allowed in production.');
    if (env.RATE_LIMIT_DISABLED === 'true') errors.push('Rate limiting cannot be disabled in production.');
    if (env.TRUST_PROXY !== 'true' && env.TRUST_PROXY !== 'false') errors.push('TRUST_PROXY must be explicitly set to "true" or "false" in production.');
    if (env.GIT_WORKFLOW_ENABLED === 'true' && spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) errors.push('Git workflow is enabled but the git binary is not available.');
    const [nodeMajor, nodeMinor] = String(env.NODE_VERSION_OVERRIDE || process.versions.node).split('.').map(Number);
    // The supported runtime is pinned to major 22 exactly: node:sqlite requires >= 22.5, and the durable-VPS
    // profile is only validated against major 22 (engines caps at < 25), so a newer major is treated as unsupported.
    const nodeSupported = Number.isFinite(nodeMajor) && nodeMajor === MIN_NODE_MAJOR && nodeMinor >= MIN_NODE_MINOR_AT_MIN_MAJOR;
    if (!nodeSupported) errors.push(`Node.js major ${MIN_NODE_MAJOR} (>= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR_AT_MIN_MAJOR}) is required (running ${process.versions.node}) because packages/task-engine/db.js uses node:sqlite.`);
    if (!writable(attachmentsDir)) errors.push('Telegram attachment directory is not writable.');
  }
  if (!writable(dbDir)) errors.push('Database directory is not writable.');
  return { ok: errors.length === 0, errors };
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const STARTUP_TIMEOUT_MAX_SECONDS = 600;
const HEALTH_TIMEOUT_MAX_SECONDS = 120;

function boundedTimeout(value, max) {
  if (value === undefined || value === '' || value === null) return false;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= max;
}

// Runtime-only hardening gate for the durable VPS supervisor. Kept separate from requireProductionSafeConfig
// (which the API boot path shares with dev/test) so that non-root, port, ownership, timeout, and persistent-
// directory checks apply only to the real production supervisor. Every dependency on the live host is injectable
// so the checks can be exercised with credential-free fixtures. Messages never include env values or credentials.
export function verifyVpsRuntime(env = process.env, {
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  username = safeUsername(),
  nodeVersion = process.versions.node,
  dbPath = env.BLACKSPIRE_DB_PATH || DB_PATH,
  requiredDirs = null,
  isWritable = writable,
  dirOwnerUid = defaultDirOwnerUid,
  dirExists = (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } },
} = {}) {
  const errors = [];

  const [nodeMajor, nodeMinor] = String(nodeVersion).split('.').map(Number);
  if (!(Number.isFinite(nodeMajor) && nodeMajor === MIN_NODE_MAJOR && nodeMinor >= MIN_NODE_MINOR_AT_MIN_MAJOR)) {
    errors.push(`Node.js major ${MIN_NODE_MAJOR} (>= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR_AT_MIN_MAJOR}) is required for the production runtime.`);
  }

  const port = Number(env.PORT);
  if (!(Number.isInteger(port) && port >= 1 && port <= 65535)) errors.push('PORT must be an integer between 1 and 65535.');

  if (!boundedTimeout(env.BLACKSPIRE_STARTUP_TIMEOUT_SECONDS, STARTUP_TIMEOUT_MAX_SECONDS)) {
    errors.push(`BLACKSPIRE_STARTUP_TIMEOUT_SECONDS must be a positive integer no greater than ${STARTUP_TIMEOUT_MAX_SECONDS}.`);
  }
  if (!boundedTimeout(env.BLACKSPIRE_HEALTH_TIMEOUT_SECONDS, HEALTH_TIMEOUT_MAX_SECONDS)) {
    errors.push(`BLACKSPIRE_HEALTH_TIMEOUT_SECONDS must be a positive integer no greater than ${HEALTH_TIMEOUT_MAX_SECONDS}.`);
  }

  if (uid === 0) errors.push('The production runtime must not run as root.');

  if (!env.BLACKSPIRE_RUNTIME_USER) {
    errors.push('BLACKSPIRE_RUNTIME_USER must be set to the intended non-root runtime user.');
  } else if (username !== null && env.BLACKSPIRE_RUNTIME_USER !== username) {
    errors.push('BLACKSPIRE_RUNTIME_USER does not match the effective runtime user.');
  }

  const dbParent = path.dirname(path.resolve(dbPath));
  if (!dirExists(dbParent)) errors.push('The persistent database parent directory does not exist.');

  const dirs = requiredDirs || defaultPersistentDirs(env, dbParent);
  for (const dir of dirs) {
    if (!isWritable(dir)) { errors.push('A required persistent directory is not writable by the runtime user.'); continue; }
    if (uid !== null) {
      const owner = dirOwnerUid(dir);
      if (owner !== null && owner !== uid) errors.push('A required persistent directory is not owned by the runtime user.');
    }
  }

  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production.');
  if (env.BLACKSPIRE_RUNTIME_MODE !== 'production') errors.push('BLACKSPIRE_RUNTIME_MODE must be production.');
  if (env.UNIFIED_IPHONE_TEST_MODE === 'true') errors.push('Test mode is not allowed in the production runtime.');
  if (env.BLACKSPIRE_PROVIDER_MODE !== 'manual') errors.push('BLACKSPIRE_PROVIDER_MODE must be manual.');
  if (env.BLACKSPIRE_HERMES_MODE === 'mock') errors.push('Mock Hermes is not allowed in the production runtime.');
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY', 'CODEX_API_ENDPOINT', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']) {
    if (env[key]) errors.push(`${key} is forbidden in the production runtime.`);
  }
  if (!['', 'dry-run', undefined].includes(env.TELEGRAM_MODE)) errors.push('Telegram must remain disconnected (dry-run or unset).');
  if (env.BLACKSPIRE_RUN_MIGRATIONS === 'true') errors.push('Migrations must not run implicitly at production start.');

  return { ok: errors.length === 0, errors };
}

function defaultPersistentDirs(env, dbParent) {
  const releaseRoot = env.BLACKSPIRE_RELEASE_ROOT || '/opt/blackspire-command';
  const shared = path.join(path.resolve(releaseRoot), 'shared');
  return [dbParent, path.join(shared, 'database'), path.join(shared, 'evidence'), path.join(shared, 'backups')];
}

function defaultDirOwnerUid(dir) {
  try { return fs.statSync(dir).uid; } catch { return null; }
}

function safeUsername() {
  try { return os.userInfo().username; } catch { return null; }
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => part.trim().split('=')).filter(([key]) => key).map(([key, ...value]) => [key, decodeURIComponent(value.join('='))]));
}

export function sessionCookie(session, { secure = process.env.NODE_ENV === 'production' } = {}) {
  return [`bc_session=${encodeURIComponent(session.sessionId)}; HttpOnly; Path=/; Max-Age=${Math.floor((session.expiresAt - Date.now()) / 1000)}; SameSite=Strict${secure ? '; Secure' : ''}`,
    `bc_csrf=${encodeURIComponent(session.csrfToken)}; Path=/; Max-Age=${Math.floor((session.expiresAt - Date.now()) / 1000)}; SameSite=Strict${secure ? '; Secure' : ''}`];
}

export function clearSessionCookies() {
  return ['bc_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict', 'bc_csrf=; Path=/; Max-Age=0; SameSite=Strict'];
}

export function checkCsrf(req, session) {
  if (!session) return false;
  const token = req.headers['x-csrf-token'];
  return Boolean(token && token === session.csrfToken);
}

export function safeError(error) {
  return redact(error?.message || String(error || 'error'));
}
