import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_TOKEN, DB_PATH } from './config.js';
import { now, redact } from './util.js';

const sessions = new Map();
const revokedBefore = { value: 0 };
const buckets = new Map();
const MAX_BUCKETS = 2000;

export function requireProductionSafeConfig(env = process.env) {
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
  }
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.accessSync(path.dirname(DB_PATH), fs.constants.W_OK);
  } catch {
    errors.push('Database directory is not writable.');
  }
  return { ok: errors.length === 0, errors };
}

export function createSession(adminToken, { userAgent = '', ip = 'local' } = {}) {
  if (adminToken !== ADMIN_TOKEN) return null;
  const sessionId = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const createdAt = Date.now();
  const expiresAt = createdAt + Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
  sessions.set(sessionId, { sessionId, csrfToken, createdAt, expiresAt, rotatedAt: createdAt, userAgent, ip });
  return sessions.get(sessionId);
}

export function rotateSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  sessions.delete(sessionId);
  return createSession(ADMIN_TOKEN, { userAgent: session.userAgent, ip: session.ip });
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.createdAt < revokedBefore.value || Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function destroySession(sessionId) {
  sessions.delete(sessionId);
}

export function revokeAllSessions() {
  revokedBefore.value = Date.now();
  sessions.clear();
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

export function rateLimit(key, { limit = 20, windowMs = 60000 } = {}) {
  if (process.env.RATE_LIMIT_DISABLED === 'true' && process.env.NODE_ENV !== 'production') return { allowed: true, remaining: limit };
  const nowMs = Date.now();
  if (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
  const bucket = buckets.get(key) || { count: 0, resetAt: nowMs + windowMs };
  if (nowMs > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = nowMs + windowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), retryAfter: Math.ceil((bucket.resetAt - nowMs) / 1000), resetAt: bucket.resetAt };
}

export function safeError(error) {
  return redact(error?.message || String(error || 'error'));
}
