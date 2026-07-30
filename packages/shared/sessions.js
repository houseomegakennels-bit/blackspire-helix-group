import crypto from 'node:crypto';
import { run, all, get, transaction } from '../task-engine/db.js';
import { ADMIN_TOKEN } from './config.js';

const SESSION_TTL_MS = () => Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const REVOKED_BEFORE_FLAG = 'sessions_revoked_before';

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
  return flag ? Number(flag.value) : 0;
}

export function createSession(adminToken, { userAgent = '', ip = 'local', principalId = null, maxExpiresAt = null } = {}) {
  if (adminToken !== ADMIN_TOKEN) return null;
  // Binding is opt-in and performed only by a server-side caller after it has resolved a
  // configured canonical principal.  Invalid input becomes an unbound session; it never
  // selects an identity through a request field.
  const boundPrincipalId = typeof principalId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(principalId) ? principalId : null;
  const sessionId = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const createdAt = now();
  const boundedExpiry = Number.isSafeInteger(maxExpiresAt) && maxExpiresAt > createdAt ? maxExpiresAt : Infinity;
  const expiresAt = Math.min(createdAt + SESSION_TTL_MS(), boundedExpiry);
  run(
    `INSERT INTO sessions (id, csrf_token, created_at, expires_at, rotated_at, user_agent, ip, revoked_at, principal_id) VALUES (?,?,?,?,?,?,?,NULL,?);`,
    [sessionId, csrfToken, createdAt, expiresAt, createdAt, userAgent, ip, boundPrincipalId],
  );
  return row(get('SELECT * FROM sessions WHERE id=?;', [sessionId]));
}

export function getSession(sessionId) {
  if (!sessionId) return null;
  const session = get('SELECT * FROM sessions WHERE id=?;', [sessionId]);
  if (!session) return null;
  if (session.revoked_at) return null;
  if (session.created_at < revokedBefore()) return null;
  if (now() > session.expires_at) return null;
  return row(session);
}

// Rotation is atomic: the old session is revoked and the new one created inside a single transaction
// so a concurrent request can never observe both sessions as valid, or neither.
export function rotateSession(sessionId) {
  return transaction(() => {
    const existing = get('SELECT * FROM sessions WHERE id=?;', [sessionId]);
    if (!existing || existing.revoked_at || existing.created_at < revokedBefore() || now() > existing.expires_at) return null;
    run('UPDATE sessions SET revoked_at=? WHERE id=?;', [now(), sessionId]);
    const sessionIdNext = crypto.randomBytes(24).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const createdAt = now();
    const expiresAt = createdAt + SESSION_TTL_MS();
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
  return all('SELECT * FROM sessions WHERE revoked_at IS NULL AND expires_at > ?;', [now()]).map(row);
}
