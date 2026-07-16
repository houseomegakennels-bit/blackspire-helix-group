# BLACKSPIRE_COMMAND_BUILD_REPORT

This report is a strict implementation audit of the current Blackspire Command foundation against the Foundation Build Plan after the orchestration hardening pass. It distinguishes working local runtime from mocked test coverage, credential-gated live integrations, adapter-only behavior, and missing production features.

## FINAL MERGE-READINESS PASS (this branch, supersedes PR #20)

PR #20's draft branch (`codex/build-blackspire-command-foundation-news8d`) could not actually run in this
environment: `packages/task-engine/db.js` shelled out to the `sqlite3` CLI binary via `spawnSync`, and that
binary is neither installed nor installable here (no apt access to the package). `npm run db:migrate` failed
before any other work could be verified. Everything below was built directly on top of that branch's code —
nothing was thrown away — starting with making the database layer actually run.

Summary of what changed in this pass (see `BLACKSPIRE_DELIVERY.md` for the full account):

1. **`packages/task-engine/db.js` now uses Node's built-in `node:sqlite` (`DatabaseSync`)** instead of
   spawning the `sqlite3` CLI per query. WAL mode + `busy_timeout=5000` are set on every connection so
   multiple Node processes (API, worker, Telegram bridge) can share one SQLite file safely. This is what
   unblocked running the project in this sandbox at all, and it also gives real transactions
   (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`) and indexed lookups for the new tables below.
2. **Persistent sessions** (`packages/shared/sessions.js`) — a `sessions` SQLite table replaces the
   in-memory `Map`. Create/lookup/rotate/logout/revoke-all/revoked-before/cleanup are all persisted and
   indexed. Proven across real OS process restarts in `tests/persistence.test.js` (not just within one
   process, where an in-memory Map would have looked fine too).
3. **Persistent rate limiting** (`packages/shared/rateLimits.js`) — a `rate_limits` table with a single
   atomic UPSERT (CASE-based window rollover) replaces the in-memory bucket Map. WAL + busy_timeout make
   concurrent writers from separate processes serialize instead of racing. Bounded cleanup, Retry-After,
   and audit-on-exceed are included.
4. **Trusted proxy handling** (`packages/shared/net.js`) — `X-Forwarded-For` is ignored by default; only
   honored when `TRUST_PROXY=true` is set explicitly. `tests/trusted-proxy.test.js` proves a spoofed header
   is ignored by default and honored only when trust is turned on.
5. **Approval resume loop fixed** — the previous code re-evaluated a regex against the task request on
   every run, so an *approved* high-risk task paused for approval again forever on resume. `packages/task-engine/tasks.js`
   now exposes `latestApproval(taskId, action)` as the persisted approval marker, and `packages/hermes/hermes.js`
   reads it instead of re-deciding from scratch. Rejected and expired approvals now explicitly fail the task
   instead of leaving it stuck or re-prompting. See `tests/approval-resume.test.js`.
6. **Telegram file/voice workflow** (`apps/telegram/bot.js`) — real `getFile` + download against a mocked
   Telegram HTTP API, MIME allowlist and size checks both before and after download, safe filename
   generation, temporary storage + cleanup, text extraction, task/workspace association
   (`packages/task-engine/attachments.js`), `sendDocument`-based evidence/large-log delivery, and a
   configurable transcription adapter (`packages/shared/transcription.js`) with explicit
   ok/unavailable/failed states. See `tests/telegram-files.test.js`.
7. **Evidence export completeness** — `apps/api/server.js`'s export bundle now has a fixed, explicit key
   order and pulls branch/commit/PR-or-manual-handoff up from the buried "final" evidence record, plus a
   sanitized `Content-Disposition` filename. See `tests/evidence-export.test.js`.
8. **Production startup is now actually enforced** — `requireProductionSafeConfig()` existed before but was
   only ever surfaced at `/ready`; `apps/api/server.js`'s `start()` now calls it at boot and `process.exit(1)`s
   on an unsafe production config. Added checks: Node version, git binary presence, attachment directory
   writability, and explicit `TRUST_PROXY` configuration. One test per failure mode plus a valid-config test
   in `tests/production-validation.test.js`, and a real spawned-process boot/refusal test in
   `tests/production-startup.test.js`.
9. **Cookie/CSRF review** — added a session rotation endpoint (`POST /api/auth/rotate`) that returns fresh
   cookies and invalidates the old session id; bearer-token auth is now off by default in production unless
   `ALLOW_BEARER_AUTH=true` is explicitly set. See `tests/cookies-csrf.test.js`.
10. **Jarvis** — added evidence export download buttons, an approval-history view, an explicit
    emergency-stop/Telegram-mode status badge row, and 401 handling that prompts re-login instead of
    silently failing. See `tests/jarvis.test.js`.

**Exact test count: 114 tests, all passing** (up from the 47 tests present on this branch before this pass;
`npm test` on PR #20's branch could not even run in this environment because of the `sqlite3` CLI
dependency).

## Status Legend

- **LIVE**: Production adapter contains real execution code and will operate against an external service when valid credentials/CLI auth are supplied.
- **FUNCTIONAL LOCAL**: Works end-to-end locally without external credentials.
- **MOCKED**: Proven with mocks/fakes, not a real external service.
- **STUBBED**: Interface or partial adapter exists, but not complete operational behavior.
- **MISSING**: Not implemented.

## Requirement Audit Table

| Requirement | Status | Exact file paths | Test proving it works | Credentials/setup still required | Remaining implementation work |
|---|---:|---|---|---|---|
| POST `/api/tasks` only persists/queues and does not call Hermes | FUNCTIONAL LOCAL | `apps/api/server.js` | `tests/orchestration.test.js` “API queues but does not process directly” | None local | Add API contract/OpenAPI docs. |
| Worker-only task claiming and processing | FUNCTIONAL LOCAL | `apps/worker/worker.js`, `packages/task-engine/tasks.js` | `tests/orchestration.test.js` “worker claims task…” | None local | Add multi-process stress tests. |
| Atomic SQLite task claim | FUNCTIONAL LOCAL | `packages/task-engine/tasks.js` | `tests/orchestration.test.js` worker claim flow | None local | Add race test with parallel workers. |
| Worker heartbeat/recovery fields | FUNCTIONAL LOCAL | `packages/task-engine/db.js`, `packages/task-engine/tasks.js`, `apps/worker/worker.js` | Covered by worker claim/process tests; heartbeat fields persist during stages | None local | Add explicit stale-heartbeat recovery test. |
| Staged Hermes orchestration loop | FUNCTIONAL LOCAL | `packages/hermes/hermes.js` | `tests/orchestration.test.js` verifies provider, branch, edit, validation, commit, evidence | None local for mocked provider | Add richer task decomposition and branch cleanup. |
| Workspace inspection | FUNCTIONAL LOCAL | `packages/hermes/hermes.js`, `packages/github/github.js` | `tests/orchestration.test.js` temp Git repo workflow | Git installed | Add remote metadata checks. |
| Structured plan persistence | FUNCTIONAL LOCAL | `packages/hermes/hermes.js`, `packages/task-engine/tasks.js` | `tests/orchestration.test.js` completed task evidence/records | None local | Add plan schema validation. |
| Persisted subtasks | FUNCTIONAL LOCAL | `packages/task-engine/tasks.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` asserts subtasks exist | None local | Add subtask details UI. |
| Provider selection | FUNCTIONAL LOCAL | `packages/providers/providers.js`, `packages/hermes/hermes.js` | `tests/core.test.js`; `tests/orchestration.test.js` mocked provider selection | Provider credentials/CLI for live modes | Add per-workspace provider budget enforcement. |
| Provider execution result normalization | FUNCTIONAL LOCAL / LIVE WITH KEYS | `packages/providers/providers.js` | `tests/orchestration.test.js` mocked normalized artifacts; `tests/integration.test.js` unconfigured provider behavior | OpenAI/Anthropic keys or Codex/Claude CLIs for live execution | Add cost model per provider. |
| OpenAI API execution | LIVE WITH KEY | `packages/providers/providers.js` | `tests/integration.test.js` proves unconfigured mode; code contains real Responses API call | `OPENAI_API_KEY`, `OPENAI_MODEL` | Add live contract test gated by env. |
| Anthropic API execution | LIVE WITH KEY | `packages/providers/providers.js` | `tests/integration.test.js` proves unconfigured mode; code contains real Messages API call | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Add live contract test gated by env. |
| Claude Code CLI invocation | LIVE WITH INSTALLED CLI / STUBBED IN TESTS | `packages/providers/providers.js` | No live CLI test in this environment | Installed/authenticated `claude` CLI | Add mocked CLI fixture and optional live test. |
| Codex CLI invocation | LIVE WITH INSTALLED CLI / STUBBED IN TESTS | `packages/providers/providers.js` | Capability/selection tests only | Installed/authenticated `codex` CLI or direct endpoint/key | Add mocked CLI fixture and official API path once available. |
| Manual task-packet fallback | FUNCTIONAL LOCAL | `packages/providers/providers.js`, `packages/github/github.js` | `tests/integration.test.js` GitHub PR task-packet fallback | None local | Add task packet download endpoint. |
| Coding task branch creation | FUNCTIONAL LOCAL | `packages/github/github.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` asserts branch `hermes/<task>` | Git installed | Add remote push support after credentials. |
| Repository context packet to provider | FUNCTIONAL LOCAL | `packages/hermes/hermes.js`, `packages/providers/providers.js` | `tests/orchestration.test.js` provider packet/artifact flow | None for mock; credentials for live providers | Add file sampling/search context. |
| Apply proposed edits | FUNCTIONAL LOCAL | `packages/github/github.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` asserts generated file exists | None local | Add patch-format support in addition to full-file writes. |
| Inspect changed files | FUNCTIONAL LOCAL | `packages/github/github.js`, `packages/hermes/hermes.js`, `packages/task-engine/tasks.js` | `tests/orchestration.test.js` asserts changed files persisted | Git installed | Add additions/deletions parsing. |
| Run configured validation | FUNCTIONAL LOCAL | `packages/execution/runner.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js`; `tests/core.test.js` allowlist bypass | Workspace commands installed | Add per-command cancellation. |
| Commit successful changes | FUNCTIONAL LOCAL | `packages/github/github.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` asserts latest Git commit | Git installed | Add signed commit option. |
| Draft PR creation | LIVE WITH GH/GITHUB_TOKEN / FUNCTIONAL PACKET FALLBACK | `packages/github/github.js`, `packages/hermes/hermes.js` | `tests/integration.test.js` fallback packet test | `gh` CLI + `GITHUB_TOKEN` for live PR | Add GitHub App implementation. |
| Workspace repository allowlist | FUNCTIONAL LOCAL | `packages/policy/policy.js`, `packages/hermes/hermes.js` | Covered in staged workspace inspection tests | None local | Add multiple-repository workspace registry UI. |
| Path confinement | FUNCTIONAL LOCAL | `packages/policy/policy.js`, `packages/execution/runner.js`, `packages/github/github.js` | `tests/core.test.js`; orchestration edit under allowed `docs` | None local | Add tests for rejected provider artifact paths. |
| Allowed command enforcement | FUNCTIONAL LOCAL | `packages/execution/runner.js`, `packages/policy/policy.js` | `tests/core.test.js` command allowlist bypass | None local | Add shell metacharacter policy checks. |
| Persist provider attempts | FUNCTIONAL LOCAL | `packages/task-engine/tasks.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` asserts provider attempts exist | None local | Add provider-attempt detail endpoint. |
| Persist usage/estimated cost | FUNCTIONAL LOCAL (estimated) | `packages/task-engine/tasks.js`, `packages/providers/providers.js` | `tests/orchestration.test.js` verifies records; mock usage persisted | Real provider usage responses for live costs | Implement exact model pricing tables. |
| Persist changed files | FUNCTIONAL LOCAL | `packages/task-engine/tasks.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` asserts changed files exist | None local | Parse line counts. |
| Persist command results | FUNCTIONAL LOCAL | `packages/task-engine/tasks.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` asserts command result exists | None local | Add command log download endpoint. |
| Persist approval records | FUNCTIONAL LOCAL | `packages/task-engine/tasks.js`, `packages/hermes/hermes.js`, `apps/api/server.js` | `tests/acceptance.test.js` verifies approval pause/approve/reject paths | None local | Add approval center detail endpoint. |
| Persist final evidence | FUNCTIONAL LOCAL | `packages/task-engine/tasks.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` asserts final evidence exists | None local | Add incident/evidence bundle endpoint. |
| Cancellation prevents subsequent stages | FUNCTIONAL LOCAL | `apps/api/server.js`, `apps/worker/worker.js`, `packages/hermes/hermes.js` | `tests/orchestration.test.js` cancellation test | None local | Add child-process kill registry. |
| Emergency stop prevents claims/new work | FUNCTIONAL LOCAL | `apps/api/server.js`, `apps/worker/worker.js`, `packages/task-engine/tasks.js` | `tests/orchestration.test.js`; `tests/integration.test.js` | None local | Add stronger reset authentication. |
| Telegram numeric user allowlist | FUNCTIONAL LOCAL | `apps/telegram/bot.js`, `packages/shared/config.js` | `tests/integration.test.js` unauthorized Telegram user ignored | `TELEGRAM_ALLOWED_USERS` | Add allowlist management UI. |
| Telegram polling runtime | FUNCTIONAL LOCAL DRY-RUN / LIVE WITH TOKEN | `apps/telegram/bot.js`, `scripts/start-local.js` | `tests/integration.test.js` dry-run polling test | `TELEGRAM_BOT_TOKEN` for live polling | Add webhook route. |
| Telegram message sending | MOCKED / LIVE WITH TOKEN | `apps/telegram/bot.js` | `tests/integration.test.js` mocked Bot API shape | `TELEGRAM_BOT_TOKEN` | Run live Telegram test after token. |
| Jarvis PWA API connectivity | FUNCTIONAL LOCAL | `apps/jarvis-pwa/public/index.html`, `apps/api/server.js` | `tests/integration.test.js` API endpoint used by Jarvis | Admin token | Add browser E2E test. |
| Jarvis authentication | FUNCTIONAL LOCAL | `apps/jarvis-pwa/public/index.html`, `apps/api/server.js` | Protected API tests | Strong `COMMAND_ADMIN_TOKEN` | Replace localStorage bearer with secure sessions before production. |
| Voice input/spoken output | STUBBED | `apps/jarvis-pwa/public/index.html` | No automated voice test | Browser speech APIs | Add server transcription/TTS adapters. |
| Docker/local startup | FUNCTIONAL LOCAL | `Dockerfile`, `docker-compose.yml`, `scripts/start-local.js` | `npm run build`; previous manual startup smoke | Docker for compose | Add container healthcheck. |
| Backup/restore | FUNCTIONAL LOCAL | `scripts/backup.js`, `scripts/restore.js` | Script-level only | Existing SQLite DB | Add automated backup/restore test. |
| Secret redaction/security scan | FUNCTIONAL LOCAL | `packages/shared/util.js`, `packages/execution/runner.js`, `packages/providers/providers.js`, `scripts/secret-scan.js` | `npm run security:scan` | None local | Add redaction unit tests. |
| Telegram webhook, file upload, result-file delivery, voice-note transcription | MOCKED (real `getFile`/download/`sendDocument` code path, exercised against a mocked Telegram HTTP API) | `apps/telegram/bot.js`, `packages/shared/transcription.js`, `packages/task-engine/attachments.js` | `tests/telegram-files.test.js` | `TELEGRAM_BOT_TOKEN`, HTTPS webhook URL for live verification | Live transport (real `api.telegram.org`) is unverified without a real bot token; a real transcription backend still needs to be wired into the `http` adapter mode. |
| Rate limiting, CSRF, secure cookies/session revocation | FUNCTIONAL LOCAL (SQLite-persisted, restart-proof) | `packages/shared/sessions.js`, `packages/shared/rateLimits.js`, `packages/shared/security.js`, `apps/api/server.js` | `tests/persistence.test.js`, `tests/cookies-csrf.test.js`, `tests/trusted-proxy.test.js` | None local | Distributed (multi-host) deployments still need a shared SQLite volume or a future move to a networked store. |

## End-to-End Local Coding Change Proven

Automated tests `tests/orchestration.test.js` and `tests/acceptance.test.js` now prove one genuine local coding change from queued request through worker claim, staged Hermes orchestration, mocked provider artifact, temporary Git branch, edit application, validation, commit, PR-packet fallback, persisted evidence, and completed result.

The test creates an isolated temporary Git repository, registers it as a workspace, submits a coding task, and verifies:

1. API leaves the task `queued` and does not process directly.
2. Worker claims the task.
3. Hermes builds/persists a staged plan and subtasks.
4. Mock provider returns a normalized proposed edit artifact.
5. Hermes creates branch `hermes/<taskId>`.
6. Hermes writes the provider artifact inside the workspace allowlist.
7. Hermes runs the configured validation command.
8. Hermes commits the successful change.
9. Hermes persists provider attempts, usage, changed files, command results, and final evidence.
10. High-risk tasks pause before provider execution.
11. Cancellation prevents subsequent stages.
12. Emergency stop prevents new task creation/claims.

## A. FINAL TEST RESULTS

The final credential-free acceptance pass ran these exact commands:

- `npm run db:migrate` — PASSED.
- `npm test` — PASSED, 114 tests.
- `npm run build` — PASSED.
- `npm run lint` — PASSED.
- `npm run typecheck` — PASSED.
- `npm run security:scan` — PASSED.
- `npm audit --audit-level=high` — PASSED, 0 vulnerabilities.

## Validation Commands Run

- `npm run db:migrate` — passed.
- `npm test` — passed, 114 tests.
- `npm run build` — passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run security:scan` — passed.
- `npm audit --audit-level=high` — passed, 0 vulnerabilities.

## B. CREDENTIALS I MUST PROVIDE

- `COMMAND_ADMIN_TOKEN` production value.
- Numeric Telegram user ID for `TELEGRAM_ALLOWED_USERS`.
- `TELEGRAM_BOT_TOKEN` from BotFather for live Telegram polling/sending.
- `GITHUB_TOKEN` and authenticated `gh` CLI or a future GitHub App for live draft PR creation.
- `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` for live model calls.
- Installed/authenticated `codex` and/or `claude` CLIs for those execution modes.
- HTTPS domain/container host for real iPhone PWA use outside local development.

## C. WHAT I MUST CONFIGURE FROM MY IPHONE

1. Set a strong `COMMAND_ADMIN_TOKEN` in the host/container environment.
2. Set `TELEGRAM_ALLOWED_USERS` to your numeric Telegram user ID.
3. Create a Telegram bot with BotFather and set `TELEGRAM_BOT_TOKEN` for live polling/sending.
4. Open the deployed `/jarvis` URL in iPhone Safari, enter `COMMAND_ADMIN_TOKEN`, then Add to Home Screen.
5. Add `GITHUB_TOKEN` and install/authenticate `gh` before expecting live draft PR creation.
6. Add `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` before expecting real model calls.
7. Install/authenticate `codex` and/or `claude` CLIs if those execution modes are desired.
8. Put the API behind HTTPS before using it outside local development.

## D. SAFE TO MERGE?

NO — not as a production system. It is safe to merge only as a local foundation if the team accepts these constraints:

1. Credential-free local orchestration is now proven end-to-end.
2. External provider and Telegram/GitHub live paths are credential-gated and not live-verified.
3. Telegram webhook, file upload, and voice-note handling remain missing.
4. Secure cookie sessions, CSRF, and rate limiting remain missing.
5. GitHub App flow and live draft PR creation remain unverified.
6. Provider cost accounting is persisted but estimated unless real provider responses are used.
7. Approval records exist, but approval UI/detail endpoints need refinement.
8. Production TLS/reverse proxy/service hardening remains to be done.
9. Incident bundle export remains missing.
10. The local tests are clean and suitable as the baseline for the next hardening PR.

## E. POST-MERGE FIRST TASK

Submit this low-risk verification task through Telegram or Jarvis:

`Create \`docs/mobile-verification.md\` with a one-paragraph note saying Blackspire Command completed a post-merge mobile smoke test.`

Expected local result: Hermes creates a `hermes/<taskId>` branch, writes the file inside `docs/`, runs the workspace validation command, commits the change, and creates a manual PR packet unless live GitHub credentials are configured.

## Real Blockers / Limitations

- Live Telegram Bot API send/receive still requires your bot token and allowlisted user ID.
- Live GitHub draft PR creation requires GitHub credentials and a target repository policy.
- Live OpenAI, Anthropic, Codex, and Claude Code execution requires the respective credentials/installed CLIs.
- Telegram webhook mode, file uploads, result-file delivery, voice-note transcription, secure session cookies, CSRF protection, rate limiting, and incident bundle export remain unimplemented and must not be described as complete.

## PRODUCTION HARDENING RESULTS

| Requirement | Status | Exact file paths | Exact tests | Credentials still required | Remaining limitations |
|---|---:|---|---|---|---|
| Approval request/decision persistence with risk, requester, decider, expiration, idempotency, and audit | FUNCTIONAL LOCAL | `packages/task-engine/db.js`, `packages/task-engine/tasks.js`, `packages/hermes/hermes.js`, `apps/api/server.js` | `tests/hardening.test.js` approval records test | None local | Approval UI can expose more detail. |
| Secure Jarvis session login/logout/status/revoke | FUNCTIONAL LOCAL | `packages/shared/security.js`, `apps/api/server.js`, `apps/jarvis-pwa/public/index.html` | `tests/hardening.test.js` secure session test; `tests/acceptance.test.js` Jarvis asset test | Strong `COMMAND_ADMIN_TOKEN`, `SESSION_SECRET` | Browser E2E should be added with a real browser. |
| HttpOnly/SameSite cookie sessions and no token in localStorage | FUNCTIONAL LOCAL | `packages/shared/security.js`, `apps/jarvis-pwa/public/index.html` | `tests/hardening.test.js`; `tests/acceptance.test.js` asserts no `localStorage.commandToken` | HTTPS for Secure cookies in production | Production deployment must set HTTPS base URL. |
| CSRF protection for state-changing session requests | FUNCTIONAL LOCAL | `packages/shared/security.js`, `apps/api/server.js`, `apps/jarvis-pwa/public/index.html` | `tests/hardening.test.js` missing/invalid/valid CSRF checks | None local | Bearer-token API clients remain CSRF-exempt by design. |
| Rate limiting for login/API actions/Telegram | FUNCTIONAL LOCAL | `packages/shared/security.js`, `apps/api/server.js`, `apps/telegram/bot.js` | `tests/hardening.test.js` login rate-limit test; Telegram command test | None local | Production distributed deployments need shared rate-limit storage. |
| Telegram webhook secret validation and fast ack | FUNCTIONAL LOCAL / LIVE WITH TOKEN | `apps/api/server.js`, `apps/telegram/bot.js` | `tests/hardening.test.js` webhook secret/dispatch tests | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, HTTPS URL | Live Telegram webhook not verified without credentials. |
| Telegram file and voice-note handling boundaries | MOCKED | `apps/telegram/bot.js` | `tests/hardening.test.js` file/voice tests | Telegram bot token; transcription adapter | Malware scanning and real Telegram download API remain future work. |
| Evidence bundle export JSON/Markdown with redaction and audit | FUNCTIONAL LOCAL | `apps/api/server.js`, `packages/task-engine/tasks.js` | `tests/hardening.test.js` evidence export test | None local | Bundle streaming/large-file delivery should be added. |
| Emergency-stop reset strong re-authentication | FUNCTIONAL LOCAL | `apps/api/server.js`, `packages/shared/security.js` | `tests/hardening.test.js` reset confirmation test | Active session and CSRF confirmation | Child-process termination registry remains partial. |
| Production startup/config validation | FUNCTIONAL LOCAL | `packages/shared/security.js`, `apps/api/server.js` | `tests/hardening.test.js` production validation test | Production secrets/domain/webhook secret | Add CLI preflight command output formatting. |
| Security headers and browser policies | FUNCTIONAL LOCAL | `apps/api/server.js` | `tests/acceptance.test.js` header check | HTTPS for HSTS in production | Inline Jarvis script keeps dev CSP looser; production CSP removes unsafe-inline but UI should be externalized. |
| Telegram/Jarvis admin parity | FUNCTIONAL LOCAL / STUBBED WHERE NOTED | `apps/telegram/bot.js`, `apps/jarvis-pwa/public/index.html`, `apps/api/server.js` | `tests/hardening.test.js` Telegram commands; `tests/acceptance.test.js` Jarvis controls | Telegram token for live transport | Evidence export in Jarvis is API-backed but needs a visible download button polish. |

## SAFE TO EXPOSE TO THE INTERNET? (updated after the final merge-readiness pass)

NO.

Sessions, rate limits, approvals, and startup validation are now persisted, restart-proof, and actually
enforced (not just implemented and left unwired, as several items were before this pass). It is still not
safe for unsupervised public internet exposure because: live Telegram/GitHub/provider network paths remain
unverified without real credentials; Telegram file transfer is proven against a mocked HTTP API, not the
real `api.telegram.org`; SQLite (even with WAL) is a single-host store, so a distributed/multi-host
deployment needs a shared volume or a future networked backend; and there is no TLS-terminating reverse
proxy or container hardening included in this repository. `node:sqlite` is also still an experimental Node
API (stable as of the LTS Node version this project targets, but the runtime itself flags it as
experimental) and warrants a Node upgrade watch.

## SAFE TO MERGE?

YES, as a local foundation and hardening baseline — not as an internet-exposed production deployment.

1. 114 tests pass from a clean state (`rm -rf .blackspire-command && npm run db:migrate && npm test`), plus
   `npm run build`, `npm run lint`, `npm run typecheck`, `npm run security:scan`, and `npm audit --audit-level=high` all pass.
2. Sessions, rate limits, approval decisions, and production config validation are now persisted in SQLite
   and proven to survive real process restarts, not just in-memory state that looks correct until a restart.
3. The approval-resume infinite-loop bug is fixed and covered by a dedicated regression test.
4. Trusted-proxy handling closes an IP-spoofing gap that previously let rate limits and audit IPs be forged
   via `X-Forwarded-For`.
5. External live integrations (Telegram transport, GitHub PR creation, OpenAI/Anthropic/Codex/Claude Code)
   remain honestly credential-gated and are not claimed as live-verified.
6. Telegram file/voice handling is proven against a mocked Telegram HTTP API; the real network path needs a
   human to verify with a real bot token before being called "live."
7. Distributed (multi-host) rate limiting/session storage and TLS/reverse-proxy deployment remain future work.
8. No real secrets are committed; security scan and audit pass.

## WHAT I MUST CONFIGURE FROM MY IPHONE

1. Set `COMMAND_ADMIN_TOKEN` to a long unique admin secret in the host environment.
2. Set `SESSION_SECRET` to a separate 32+ character random value.
3. Create a Telegram bot in BotFather and set `TELEGRAM_BOT_TOKEN`.
4. Generate and set `TELEGRAM_WEBHOOK_SECRET`.
5. Set `TELEGRAM_ALLOWED_USERS` to your numeric Telegram user ID.
6. Add `GITHUB_TOKEN` and authenticate `gh` for live draft PR creation.
7. Add `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` if live model providers are desired.
8. Point `PUBLIC_BASE_URL` to an HTTPS domain and enable production secure cookies.
9. Open `/jarvis` on iPhone Safari, log in with the admin secret, and add it to Home Screen.
10. Send `/health` from the allowlisted Telegram account, then `/task Create \`docs/mobile-verification.md\` with a short mobile smoke-test note.`
11. Tap the Jarvis emergency stop, then reset it from an authenticated fresh Jarvis session using the confirmation flow.
