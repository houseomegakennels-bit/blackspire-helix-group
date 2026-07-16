# BLACKSPIRE_DELIVERY

Final merge-readiness pass for Blackspire Command, completed after Codex Cloud became unavailable partway
through the original build. This document is the single source of truth for what shipped, what was
verified, and what remains.

## Branch, commit, and PR

- **Branch:** `claude/blackspire-final-merge-readiness`
- **Base branch it was built on:** `codex/build-blackspire-command-foundation-news8d` (the head branch of
  the existing draft PR) — nothing from that branch was discarded; this pass adds to it.
- **Commit SHA (HEAD of this branch at delivery):** `cac318923423a117c665ff6f677dd49a4394a378`
- **Supersedes:** [PR #20](https://github.com/houseomegakennels-bit/blackspire-helix-group/pull/20) (draft, not merged, not modified by this work).
- **This PR:** a new draft PR from `claude/blackspire-final-merge-readiness` into `main` (URL provided in the PR description / chat reply once created).

## Files changed in this pass

24 files (1547 insertions, 139 deletions):

**Runtime code (13 files):**
- `packages/task-engine/db.js` — replaced `sqlite3` CLI shellout with Node's built-in `node:sqlite`
- `packages/task-engine/tasks.js` — added `latestApproval()` persisted approval marker
- `packages/task-engine/attachments.js` (new) — Telegram attachment/task/workspace association records
- `packages/shared/sessions.js` (new) — SQLite-backed sessions
- `packages/shared/rateLimits.js` (new) — SQLite-backed rate limiting
- `packages/shared/net.js` (new) — trusted-proxy-aware client IP resolution
- `packages/shared/transcription.js` (new) — configurable voice transcription adapter
- `packages/shared/security.js` — production validation, cookie/CSRF helpers now backed by the above
- `packages/shared/config.js` — `TRUST_PROXY`, `ALLOW_BEARER_AUTH`, `ATTACHMENTS_DIR`
- `packages/hermes/hermes.js` — approval-loop fix (persisted marker instead of re-deciding from a regex)
- `apps/api/server.js` — session rotation endpoint, startup enforcement, trusted-IP usage, evidence bundle completeness, webhook reply dispatch
- `apps/telegram/bot.js` — real `getFile`/download, MIME/size checks, safe storage+cleanup, text extraction, `sendDocument` delivery, transcription wiring
- `apps/jarvis-pwa/public/index.html` — evidence download buttons, approval history, status badges, session-expiry handling

**Tests (11 files, 8 new):**
- `tests/persistence.test.js` (new) — restart-persistence acceptance test (spawns real child processes)
- `tests/trusted-proxy.test.js` (new)
- `tests/approval-resume.test.js` (new)
- `tests/telegram-files.test.js` (new)
- `tests/evidence-export.test.js` (new)
- `tests/production-validation.test.js` (new)
- `tests/production-startup.test.js` (new)
- `tests/cookies-csrf.test.js` (new)
- `tests/jarvis.test.js` (new)
- `tests/acceptance.test.js` (updated — fixed 3 pre-existing failures exposed once the database layer could actually run)
- `tests/hardening.test.js` (updated — fixed rate-limit-bucket assumptions that depended on the IP-spoofing bug this pass closes)

## Exact test count

**114 tests, 0 failures.** (47 tests existed on the branch before this pass; they could not be executed in
this environment because `sqlite3` CLI was unavailable. This pass first made the suite runnable, fixed 4
pre-existing failures once it could run, then added 67 new tests: 7 restart-persistence, 7 trusted-proxy, 5
approval-resume, 12 Telegram file/voice, 5 evidence-export, 16 production-validation, 2 production-startup,
8 cookies-csrf, 5 Jarvis.)

## Exact commands run and pass/fail results

Run from a clean state, in order:

```
rm -rf .blackspire-command
npm run db:migrate      # PASS — "Migrated Blackspire Command SQLite database."
npm test                # PASS — 114 tests, 0 failures, 0 skipped
npm run build           # PASS — "Build check passed."
npm run lint             # PASS — exit 0 (node --check on apps/api/server.js)
npm run typecheck        # PASS — "Typecheck syntax check passed."
npm run security:scan    # PASS — "No obvious secrets detected in diff."
npm audit --audit-level=high   # PASS — "found 0 vulnerabilities" (0 runtime npm dependencies)
```

Additionally, every new/changed runtime file was syntax-checked individually with `node --check` (13 files,
all passed), since the repo's `lint`/`typecheck` scripts only check two specific files by design.

### Restart-persistence acceptance test (ran as `tests/persistence.test.js`, also runnable standalone via `node --test tests/persistence.test.js`)

1. Start API (spawned as a real child process, not in-process) — PASS
2. Log in, receive session cookie — PASS
3. Session created and confirmed authenticated — PASS
4. Consume rate-limit capacity (drive the login bucket to its limit) — PASS
5. Stop API (SIGTERM, wait for exit) — PASS
6. Restart API (fresh child process, same SQLite file) — PASS
7. Verify session still authenticates and the rate-limit bucket is still over its limit — PASS
8. Revoke the session (`POST /api/auth/revoke-all`) — PASS
9. Restart API again — PASS
10. Verify the revoked session is still rejected — PASS
11. (Bonus, same file) Rotation invalidates the old session id and issues new cookies — PASS
12. (Bonus, same file) An expired session is rejected — PASS

## What is live

- Local task lifecycle: queue → worker claim → Hermes staged orchestration → mock/local provider → git
  branch/edit/validate/commit → evidence — fully live, no external credentials needed.
- SQLite persistence (tasks, sessions, rate limits, approvals, audit, attachments) via `node:sqlite`, live
  and restart-proof.
- Session/CSRF/cookie handling, trusted-proxy IP resolution, production startup validation — live.
- Git branch/commit workflow — live (uses the real `git` binary).
- OpenAI/Anthropic API calls, Codex/Claude Code CLI invocation, `gh`-based PR creation — live **when real
  credentials/CLIs are configured**; proven in this environment only in their "credentials not configured"
  code path.

## What is mocked

- **Telegram HTTP transport** (`getFile`, file download, `sendDocument`, `sendMessage`, `getUpdates`): the
  real request/response code path is implemented and exercised against a mocked `fetch` in
  `tests/telegram-files.test.js` and elsewhere. No request has reached the real `api.telegram.org` in this
  environment — there was no real bot token available. This must be verified live before being trusted in
  production.
- **Voice transcription**: `mock` adapter mode is what tests use; the `http` adapter mode is a generic
  contract (POST audio bytes, expect `{text}`) with no specific vendor wired up.
- **GitHub PR creation without `gh`/`GITHUB_TOKEN`**: falls back to a manual task-packet file, proven in
  tests; live PR creation itself is credential-gated and untested here.

## Remaining limitations

- SQLite (even in WAL mode) is a single-host store; a horizontally-scaled deployment needs a shared volume
  or a future networked backend.
- `node:sqlite` is an experimental Node API (Node flags it with a runtime warning); pin your Node version
  and watch for upstream changes.
- Bearer-token auth is off by default in production (`ALLOW_BEARER_AUTH` must be set explicitly) — the
  Telegram bridge will get 401s in production until an operator opts in.
- No TLS-terminating reverse proxy or container hardening is included in this repository.
- Full details, including everything carried over from the original foundation build, are in
  `BLACKSPIRE_COMMAND_KNOWN_LIMITATIONS.md`.

## SAFE TO EXPOSE TO THE INTERNET? **NO**

Live Telegram/GitHub/provider network paths are unverified without real credentials, and there is no
TLS/reverse-proxy layer or multi-host storage backend included here.

## SAFE TO MERGE? **YES**

As a local foundation and hardening baseline — not as an internet-exposed production deployment. 114 tests
pass from a clean state, the approval-resume loop bug is fixed, sessions/rate-limits/approvals are
persistent and restart-proof, trusted-proxy handling closes an IP-spoofing gap, and production startup now
actually refuses to boot on an unsafe config instead of only reporting it at `/ready`.

## Exact phone-only setup steps

See `BLACKSPIRE_COMMAND_SETUP_FROM_IPHONE.md` for the full, exact 15-step procedure (environment variables
to set, then the iPhone Safari / Jarvis / Telegram walkthrough). No step requires a desktop.
