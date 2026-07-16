# BLACKSPIRE_COMMAND_SECURITY_REPORT

## Controls Implemented (original foundation)
- Secrets are environment variables with `.env.example` placeholders only.
- Telegram uses numeric allowlisting and ignores unauthorized users without system details.
- Jarvis never stores the admin token in `localStorage` — it is entered once, sent to `/api/auth/login`, and only the resulting cookie session is kept.
- Logs redact common OpenAI, GitHub, and Telegram token patterns.
- Workspace command execution is default-deny and allowlist-based.
- Path traversal is blocked in policy tests.
- Emergency stop blocks new claims and preserves data.
- Security headers include `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`.

## Controls Added in the Final Merge-Readiness Pass

### Persistent sessions (`packages/shared/sessions.js`)
Sessions are a SQLite table (`id`, `csrf_token`, `created_at`, `expires_at`, `rotated_at`, `revoked_at`),
indexed on `expires_at` and `revoked_at`. Logout sets `revoked_at` on that row; revoke-all writes a global
`sessions_revoked_before` watermark (in `system_flags`) and marks every row revoked, so a session created a
moment before a revoke-all is still caught by the watermark comparison even if the bulk update raced it.
Rotation revokes the old row and inserts the new one inside a single `BEGIN IMMEDIATE`/`COMMIT` transaction.
All of this is proven to survive real process restarts in `tests/persistence.test.js`, which spawns actual
child API processes rather than relying on in-process state.

### Persistent rate limiting (`packages/shared/rateLimits.js`)
A `rate_limits` table with a single atomic UPSERT (a `CASE` expression decides "same window, increment" vs
"new window, reset to 1" in one statement) replaces the previous in-memory bucket `Map`. Because the SQLite
connection is opened with WAL mode and `busy_timeout=5000` (`packages/task-engine/db.js`), concurrent writes
from the API, worker, and Telegram bridge processes serialize instead of racing or throwing `SQLITE_BUSY`.
Buckets are audited on exceed (`rate_limit.exceeded` events) and cleaned up in bounded batches (`LIMIT 500`
via a subquery, since SQLite's `DELETE ... LIMIT` requires a compile flag this build doesn't have).

### Trusted proxy handling (`packages/shared/net.js`)
`X-Forwarded-For` is never trusted by default — `clientIp(req)` reads `req.socket.remoteAddress` unless
`TRUST_PROXY=true` is explicitly set, in which case the leftmost forwarded address is used. This closes a
real gap in the pre-existing code, where `ip(req)` in `apps/api/server.js` read `X-Forwarded-For`
unconditionally, letting any client spoof the IP used for rate-limit bucketing and audit logs. Production
startup now refuses to boot unless `TRUST_PROXY` is explicitly `"true"` or `"false"` (not merely unset).
`tests/trusted-proxy.test.js` and `tests/cookies-csrf.test.js`/`tests/hardening.test.js` prove the spoofed
header is ignored by default and honored only when trust is turned on.

### Approval resume correctness (`packages/hermes/hermes.js`, `packages/task-engine/tasks.js`)
The previous implementation decided whether a task needed approval by re-running a regex against the task
request text on every single execution attempt — including on resume after approval — so an approved
high-risk task would pause for approval again forever. `latestApproval(taskId, action)` is now the
persisted approval marker: once a decision exists, resuming the task reads that decision instead of
re-deciding from scratch. A rejected or execution-time-expired approval now explicitly fails the task
instead of leaving it stuck in limbo or silently re-prompting. See `tests/approval-resume.test.js`.

### Telegram file/voice handling (`apps/telegram/bot.js`, `packages/shared/transcription.js`)
MIME type and size are checked against the Telegram-declared metadata *before* any download, and the actual
downloaded byte count is checked again afterward (a client cannot lie about size to bypass the limit).
Filenames are sanitized and namespaced; path traversal segments (`../../etc/passwd.md`) are stripped down to
a bare, timestamp-prefixed filename before being written to `TELEGRAM_TMP_DIR`. Files are deleted after
processing. Voice transcription goes through a configurable adapter (`disabled` | `mock` | `http`) that
always returns an explicit `ok` / `unavailable` / `failed` status — the voice note is never silently
dropped; every outcome is both persisted (`telegram_attachments` table) and reported back to the user. Live
Telegram HTTP transport (`api.telegram.org`) is exercised only against a mocked `fetch` in this test suite —
it is **unverified** until a real `TELEGRAM_BOT_TOKEN` is configured and a human confirms end-to-end
delivery.

### Evidence exports (`apps/api/server.js`)
The export bundle has a fixed, explicitly ordered set of top-level keys (task request, workspace, plan,
subtasks, provider attempts, usage, approval history, changed files, command results, logs, attachments,
branch, commit, PR-or-manual-handoff, final evidence), a redaction pass over the full serialized JSON before
it is ever written to the response, a size ceiling (`EVIDENCE_BUNDLE_MAX_BYTES`, default 500000 bytes) that
returns `413` instead of silently truncating, and a `Content-Disposition` filename built from a
allowlist-sanitized task id.

### Production startup validation (`packages/shared/security.js`, `apps/api/server.js`)
`requireProductionSafeConfig()` was previously computed and exposed at `GET /ready` but never enforced —
`start()` now calls it at boot and `process.exit(1)`s with the exact list of failures if
`NODE_ENV=production` and the config is unsafe. Checks: admin token strength, session secret strength,
secure cookies, HTTPS public URL, webhook secret in webhook mode, debug mode, wildcard CORS, rate limiting
enabled, explicit `TRUST_PROXY`, supported Node version, git binary present when git workflow is enabled,
and writable database/attachment directories. One test per failure mode plus a valid-config test live in
`tests/production-validation.test.js`; a real spawned-process boot/refusal test lives in
`tests/production-startup.test.js`.

### Cookies and CSRF (`packages/shared/security.js`, `apps/api/server.js`)
- Session id lives only in an `HttpOnly` cookie (`bc_session`); the CSRF token lives in a separate,
  non-`HttpOnly` cookie (`bc_csrf`) so client JS can read and echo it, but never the session id itself.
- Both cookies are `SameSite=Strict`, `Path=/`, with `Max-Age` derived from the session's real expiry, and
  `Secure` in production (verified for both cookies, not just one, in `tests/cookies-csrf.test.js`).
- Logout and revoke-all both clear both cookies (empty value, `Max-Age=0`).
- `POST /api/auth/rotate` (new) returns fresh cookies and immediately invalidates the old session id.
- All state-changing requests authenticated via session cookie require a matching `X-CSRF-Token` header;
  bearer-token requests are exempt from CSRF (no ambient browser credential is involved for them), but
  bearer-token auth itself is now **off by default in production** unless `ALLOW_BEARER_AUTH=true` is
  explicitly set — this is what "Production bearer-token compatibility is disabled or explicitly
  restricted" means in practice: the Telegram bridge and any CLI script must opt in deliberately.
- API responses continue to send `Cache-Control: no-store`.

## Release Checks
Run `npm run security:scan`, `npm audit --audit-level=high`, and verify production tokens/secrets are not
defaults before every release. As of this pass, `npm audit --audit-level=high` reports 0 vulnerabilities
(the project has zero runtime npm dependencies).
