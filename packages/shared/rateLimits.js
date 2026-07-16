import { run, get, migrate } from '../task-engine/db.js';

migrate();

const RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_SAMPLE_RATE = 0.02; // bounded, probabilistic cleanup instead of a full-table scan on every call

// A single UPSERT with a CASE expression does the "is this a new window or the same one" decision and the
// increment atomically in one statement. SQLite's WAL mode + busy_timeout (set in db.js) serializes concurrent
// writers from other Node processes sharing this file instead of racing or erroring, so counts stay correct
// even when the API, worker, and telegram bridge all hit the same bucket at once.
export function rateLimit(key, { limit = 20, windowMs = 60000 } = {}) {
  if (process.env.RATE_LIMIT_DISABLED === 'true' && process.env.NODE_ENV !== 'production') return { allowed: true, remaining: limit };
  const nowMs = Date.now();
  const newResetAt = nowMs + windowMs;
  run(
    `INSERT INTO rate_limits (bucket_key, count, window_started_at, reset_at, window_ms, updated_at)
     VALUES (:key, 1, :now, :newResetAt, :windowMs, :now)
     ON CONFLICT(bucket_key) DO UPDATE SET
       count = CASE WHEN :now >= rate_limits.reset_at THEN 1 ELSE rate_limits.count + 1 END,
       window_started_at = CASE WHEN :now >= rate_limits.reset_at THEN :now ELSE rate_limits.window_started_at END,
       reset_at = CASE WHEN :now >= rate_limits.reset_at THEN :newResetAt ELSE rate_limits.reset_at END,
       updated_at = :now;`,
    { key, now: nowMs, newResetAt, windowMs },
  );
  const bucket = get('SELECT * FROM rate_limits WHERE bucket_key=?;', [key]);
  if (Math.random() < CLEANUP_SAMPLE_RATE) cleanupRateLimits();
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfter: Math.max(1, Math.ceil((bucket.reset_at - nowMs) / 1000)),
    resetAt: bucket.reset_at,
  };
}

export function cleanupRateLimits() {
  const cutoff = Date.now() - RETENTION_MS;
  const result = run(
    `DELETE FROM rate_limits WHERE bucket_key IN (SELECT bucket_key FROM rate_limits WHERE reset_at < ? LIMIT 500);`,
    [cutoff],
  );
  return result.changes;
}

export function peekRateLimit(key) {
  return get('SELECT * FROM rate_limits WHERE bucket_key=?;', [key]);
}

// Operational safety valve (also used by tests to isolate buckets): clears a bucket or bucket prefix.
export function resetRateLimit(bucketKeyOrPrefix) {
  const result = run('DELETE FROM rate_limits WHERE bucket_key = ? OR bucket_key LIKE ?;', [bucketKeyOrPrefix, `${bucketKeyOrPrefix}%`]);
  return result.changes;
}
