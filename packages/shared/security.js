import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DB_PATH, ATTACHMENTS_DIR } from './config.js';
import { redact } from './util.js';
import { createSession, getSession, rotateSession, destroySession, revokeAllSessions, cleanupExpiredSessions } from './sessions.js';
import { rateLimit } from './rateLimits.js';

export { createSession, getSession, rotateSession, destroySession, revokeAllSessions, cleanupExpiredSessions, rateLimit };

const MIN_NODE_MAJOR = 20;

export function requireProductionSafeConfig(env = process.env, { dbDir = path.dirname(DB_PATH), attachmentsDir = ATTACHMENTS_DIR } = {}) {
  const errors = [];
  if (env.NODE_ENV === 'production') {
    if (!env.COMMAND_ADMIN_TOKEN || env.COMMAND_ADMIN_TOKEN === 'dev-admin-token-change-me' || env.COMMAND_ADMIN_TOKEN.length < 24) errors.push('Set a strong COMMAND_ADMIN_TOKEN before production use.');
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) errors.push('Set SESSION_SECRET to at least 32 characters.');
    if (env.SECURE_COOKIES === 'false') errors.push('SECURE_COOKIES=false is not allowed in production.');
    if (!env.PUBLIC_BASE_URL?.startsWith('https://')) errors.push('PUBLIC_BASE_URL must be HTTPS in production.');
    if (env.TELEGRAM_MODE === 'webhook' && !env.TELEGRAM_WEBHOOK_SECRET) errors.push('TELEGRAM_WEBHOOK_SECRET is required in webhook mode.');
    if (env.DEBUG === 'true') errors.push('DEBUG=true is not allowed in production.');
    if (env.CORS_ORIGIN === '*') errors.push('Wildcard CORS is not allowed in production.');
    if (env.RATE_LIMIT_DISABLED === 'true') errors.push('Rate limiting cannot be disabled in production.');
    if (env.TRUST_PROXY !== 'true' && env.TRUST_PROXY !== 'false') errors.push('TRUST_PROXY must be explicitly set to "true" or "false" in production.');
    if (env.GIT_WORKFLOW_ENABLED === 'true' && spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) errors.push('Git workflow is enabled but the git binary is not available.');
    const nodeMajor = Number(String(env.NODE_VERSION_OVERRIDE || process.versions.node).split('.')[0]);
    if (!Number.isFinite(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) errors.push(`Node.js ${MIN_NODE_MAJOR}+ is required (running ${process.versions.node}).`);
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
