import crypto from 'node:crypto';
import { run, all, get, transaction } from '../task-engine/db.js';
import { ADMIN_TOKEN } from './config.js';
import { credentialMatches } from './credential-compare.js';

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MIN_SESSION_TTL_MS = 60 * 1000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const REVOKED_BEFORE_FLAG = 'sessions_revoked_before';

export function configuredSessionTtl(env = process.env) {
  const raw = env.SESSION_TTL_MS;
  if (raw === undefined || raw === '') return DEFAULT_SESSION_TTL_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < MIN_SESSION_TTL_MS || value > MAX_SESSION_TTL_MS) {
    throw new TypeError(`SESSION_TTL_MS must be an integer from ${MIN_SESSION_TTL_MS} through ${MAX_SESSION_TTL_MS}.`);
  }
  return value;
}

function now() {
  return Date.now();
}

function row(session) {
  if (!session) return null;
  return {
    sessionId: session.id,
    csrfToken: session.csrf_token,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    rotatedAt: session.rotated_at,
    userAgent: session.user_agent,
    ip: session.ip,
    // This is an opaque server-side canonical-principal reference, never a token or credential.
    principalId: session.principal_id || null,
  };
}

function revokedBefore() {
  const flag = get('SELECT value FROM system_flags WHERE key=?;', [REVOKED_BEFORE_FLAG]);
  if (!flag) return 0;
  const value = Number(flag.value);
  return Number.isSafeInteger(value) && value >= 0 && String(value) === flag.value ? value : null;
}

function validSession(session, { active = true, at = now() } = {}) {
  if (!session || typeof session.id !== 'string' || !/^[a-f0-9]{48}$/.test(session.id) ||
    typeof session.csrf_token !== 'string' || !/^[a-f0-9]{48}$/.test(session.csrf_token)) return false;
  const epochs = ['created_at', 'expires_at', 'rotated_at'];
  if (epochs.some((key) => typeof session[key] !== 'number' || !Number.isSafeInteger(session[key]) || session[key] < 0) ||
    session.expires_at <= session.created_at || session.rotated_at < session.created_at || session.rotated_at > session.expires_at) return false;
  if (session.revoked_at !== null &&
    (typeof session.revoked_at !== 'number' || !Number.isSafeInteger(session.revoked_at) || session.revoked_at < session.created_at)) return false;
  if (session.principal_id !== null && (typeof session.principal_id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(session.principal_id))) return false;
  if (typeof session.user_agent !== 'string' || typeof session.ip !== 'string') return false;
  const cutoff = revokedBefore();
  if (cutoff === null || session.created_at < cutoff) return false;
  return !active || (session.revoked_at === null && at <= session.expires_at);
}

function createSessionRecord({ userAgent = '', ip = 'local', principalId = null, maxExpiresAt = null } = {}) {
  // Binding is opt-in and performed only by a server-side caller after it has resolved a
  // configured canonical principal.  Invalid input becomes an unbound session; it never
  // selects an identity through a request field.
  const boundPrincipalId = typeof principalId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(principalId) ? principalId : null;
  const sessionId = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const createdAt = now();
  const boundedExpiry = Number.isSafeInteger(maxExpiresAt) && maxExpiresAt > createdAt ? maxExpiresAt : Infinity;
  const expiresAt = Math.min(createdAt + configuredSessionTtl(), boundedExpiry);
  const storedUserAgent = typeof userAgent === 'string' ? userAgent.slice(0, 512) : '';
  const storedIp = typeof ip === 'string' && ip.length > 0 ? ip.slice(0, 64) : 'local';
  run(
    `INSERT INTO sessions (id, csrf_token, created_at, expires_at, rotated_at, user_agent, ip, revoked_at, principal_id) VALUES (?,?,?,?,?,?,?,NULL,?);`,
    [sessionId, csrfToken, createdAt, expiresAt, createdAt, storedUserAgent, storedIp, boundPrincipalId],
  );
  return row(get('SELECT * FROM sessions WHERE id=?;', [sessionId]));
}

export function createSession(adminToken, options = {}) {
  if (!credentialMatches(adminToken, ADMIN_TOKEN)) return null;
  return createSessionRecord(options);
}

// The credential-free iPhone fixture has its own explicit, non-production gate. Keeping this path
// separate means an empty COMMAND_ADMIN_TOKEN can never authenticate through the normal login path.
export function createTestModeSession(options = {}, env = process.env) {
  if (env.NODE_ENV === 'production' || env.UNIFIED_IPHONE_TEST_MODE !== 'true') return null;
  return createSessionRecord(options);
}

export function getSession(sessionId) {
  if (!sessionId) return null;
  const session = get('SELECT * FROM sessions WHERE id=?;', [sessionId]);
  if (!validSession(session)) return null;
  return row(session);
}

// Rotation is atomic: the old session is revoked and the new one created inside a single transaction
// so a concurrent request can never observe both sessions as valid, or neither.
export function rotateSession(sessionId) {
  return transaction(() => {
    const existing = get('SELECT * FROM sessions WHERE id=?;', [sessionId]);
    if (!validSession(existing)) return null;
    const sessionIdNext = crypto.randomBytes(24).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const createdAt = now();
    const expiresAt = Math.min(createdAt + configuredSessionTtl(), existing.expires_at);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) return null;
    run('UPDATE sessions SET revoked_at=? WHERE id=?;', [createdAt, sessionId]);
    run(
      `INSERT INTO sessions (id, csrf_token, created_at, expires_at, rotated_at, user_agent, ip, revoked_at, principal_id) VALUES (?,?,?,?,?,?,?,NULL,?);`,
      [sessionIdNext, csrfToken, createdAt, expiresAt, createdAt, existing.user_agent, existing.ip, existing.principal_id || null],
    );
    return row(get('SELECT * FROM sessions WHERE id=?;', [sessionIdNext]));
  });
}

export function destroySession(sessionId) {
  if (!sessionId) return;
  run('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL;', [now(), sessionId]);
}

export function revokeAllSessions() {
  const cutoff = now();
  transaction(() => {
    run(`INSERT INTO system_flags (key, value, updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;`, [REVOKED_BEFORE_FLAG, String(cutoff), new Date(cutoff).toISOString()]);
    run('UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL;', [cutoff]);
  });
}

export function cleanupExpiredSessions() {
  const cutoff = now();
  const result = run('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?);', [cutoff, cutoff - 24 * 60 * 60 * 1000]);
  return result.changes;
}

export function listActiveSessions() {
  const at = now();
  return all('SELECT * FROM sessions WHERE revoked_at IS NULL AND expires_at > ?;', [at])
    .filter((session) => validSession(session, { at }))
    .map(row);
}
