# Blackspire Command — Canonical Source of Truth

## Document Authority

- **Purpose:** Give every future agent a concise, evidence-backed recovery point without relying on chat history.
- **Governs:** Verified repository state, current architecture, active work, authority boundaries, validations, deployment knowledge, blockers, recovery, and immediate next actions.
- **Does not govern:** Secret values, raw logs/evidence, production authorization, live operational state after the verification time, or policy changes. Code and verified external evidence can supersede this document and must then be reconciled here.
- **Last verified date:** 2026-07-18 UTC.
- **Last verified commit:** `2ab33944333ffed0aea9a59291f2099b8e687d81` (the recovered implementation state inspected before the documentation-only reconciliation containing this entry).
- **Verified branch:** `feature/unified-input-foundation`; four local commits ahead of `origin/main` at verification time.

Claims are limited to repository evidence, local test evidence, Git history, live HTTP checks, or explicit operator confirmation. `UNVERIFIED` means the repository does not currently provide enough evidence. Older documents remain historical evidence; current-state claims that conflict with this document are `SUPERSEDED`.

## Product Mission

- **Blackspire Command:** A secure, evidence-oriented control plane for turning authorized requests into policy-checked tasks and auditable outcomes.
- **Jarvis:** The authenticated operator interface and API for shared conversations, tasks, ordered events, evidence, provider attribution, delivery state, and eligible cancellation.
- **Telegram:** A constrained input/delivery channel. It shares canonical state but cannot grant privileged authority.
- **Hermes:** The staged orchestration runtime. Deterministic Blackspire policy and budget checks precede provider execution.
- **Codex and Claude Code:** Optional credential-gated provider/CLI adapters behind Hermes. They are not the canonical state store and are not used by credential-free validation.
- **GitHub and canonical task persistence:** Git/GitHub hold reviewed code history and optional branch/PR artifacts; SQLite currently holds canonical runtime conversations, tasks, events, evidence metadata, approvals, and delivery records.

## Current Architecture

- **Control plane:** Root Node.js service (`apps/api`, `apps/worker`, `packages/*`) with authentication, rate limits, workspace registry, deterministic policy, task lifecycle, approvals, evidence, audit, backup/restore, health, and emergency controls.
- **Unified input:** `packages/unified-input/unified.js` accepts Jarvis/API and Telegram-style inputs, resolves channel bindings and canonical conversations, enforces policy before dispatch, persists inputs/tasks/events, supports idempotency and cancellation, and queues sanitized Telegram deliveries.
- **Hermes runtime adapter:** `packages/hermes/hermes.js` coordinates inspect/plan/provider/validation/evidence stages. The isolated iPhone test mode uses the read-only mock Hermes path.
- **Workers/providers:** `apps/worker/worker.js` drains the delivery outbox. `packages/providers/providers.js` normalizes mock, manual, Codex CLI, Claude Code CLI, OpenAI, and Anthropic modes; live modes require explicit configuration and authority.
- **Persistence:** `packages/task-engine/db.js` defines and migrates the root Command schema with `node:sqlite`; `scripts/migrate.js` initializes it. Unified tables cover conversations, channel bindings, inputs, task messages/events, and channel deliveries alongside the established task, approval, evidence, audit, usage, and operational tables.
- **Jarvis:** `apps/jarvis-pwa` is the local PWA; `apps/jarvis-pwa/public/test-mode.html` is the mobile test surface with test-mode banner, command input, IDs, task state, ordered timeline, provider/evidence, delivery state, and cancellation.
- **Telegram:** `apps/telegram/bot.js` supplies allowlisted local polling/webhook logic, attachment controls, replay protection, unified intake, and sanitized replies. Mock delivery is validated; real Telegram transport is not.
- **Deployments:** `frontend/` is a separate Next.js public surface deployed through Vercel. Root Blackspire Command has Docker/local launch configuration but no verified public deployment. The Unified Jarvis iPhone build is locally staged only.
- **Monitoring:** The public frontend exposes a sanitized `/health`; the Wave 1 monitoring documents describe an UptimeRobot monitor and email alert path. Monitor dashboard state is not independently verified in this session.

## Current Verified State

| Component | Status | Evidence | Relevant files / commits | Known limitations |
|---|---|---|---|---|
| Blackspire Command control plane | validated | Complete local regression and gates recorded on 2026-07-18 | `apps/api/server.js`, `packages/`, `tests/`; base history through `cccfbba` | Root service is not verified publicly deployed; SQLite is single-host |
| Unified Jarvis + Telegram intake | validated | Credential-free E2E and shared-state tests | `packages/unified-input/unified.js`, `tests/unified-input*.test.js`; `2d2a915`, `dddfb1b`, `875a78e` | Real Telegram transport remains untested |
| Hermes orchestration | validated | Mock provider and orchestration tests; provider attribution persisted | `packages/hermes/hermes.js`, `packages/providers/providers.js` | Live providers are credential/configuration gated and were not exercised |
| Canonical persistence/outbox | validated | Schema initialization, idempotency, cancellation, delivery-failure, and backup/restore tests | `packages/task-engine/db.js`, `scripts/migrate.js`, `packages/unified-input/` | `node:sqlite` is local/single-node; no production database for this slice |
| Jarvis local PWA/API | validated | Auth/API/PWA tests and targeted unified regression | `apps/jarvis-pwa/`, `apps/api/server.js`, `tests/jarvis-pwa.test.js` | Local-only for Command; device/browser acceptance remains pending |
| iPhone test build | staged | 5 targeted tests, launcher smoke, cleanup, and mobile markup checks | test-build documents and code; `dccb391` | No HTTPS test URL; real iPhone Safari acceptance not run |
| Telegram input/delivery | validated | Mock intake, replay, attachment, authority, outbox tests | `apps/telegram/bot.js`, `tests/telegram-files.test.js`, unified tests | Real bot/token/API connection is `UNVERIFIED` and intentionally absent |
| Public frontend | production | Git history plus live HTTP 200 checks on 2026-07-18 | `frontend/`, `.github/workflows/blackspire-ci.yml`; `afc330c`, `642c0e0`, `cccfbba` | Only public frontend/health was live-checked; broader production behavior not revalidated |
| Public health | production | `https://blackspirehelix.com/health` and Vercel project health URL returned the sanitized `up` contract on 2026-07-18 | `frontend/src/app/health/route.js`, `frontend/src/lib/public-health.mjs` | Availability is point-in-time |
| Wave 1 monitoring | production | Completion document records active UptimeRobot/email configuration | `WAVE1_MONITORING_COMPLETION.md` | Current monitor dashboard/alert delivery is `UNVERIFIED` this session |
| Oracle Helix / Ember Halo / other product surfaces | implemented | Source, tests, and deployment configuration exist | `oracle-helix/`, `ember-halo/`, `frontend/src/app/` | Current live deployment state was not comprehensively checked |

## Completed Milestones

- Blackspire Command control plane, policy, workspace, approval, evidence, authentication, persistence, hardening, orchestration, Telegram attachment, and health foundations are present in merged base history and pass the current local regression suite.
- Unified Jarvis and Telegram intake persists one canonical conversation/task history with ordered events, policy-before-provider behavior, attribution, idempotency, cross-channel attachment protection, cancellation, and retryable delivery state (`2d2a915`, `dddfb1b`, `875a78e`).
- Credential-free local E2E validation used temporary SQLite, loopback services, mock Hermes, and mock Telegram; evidence is in `UNIFIED_INPUT_LOCAL_E2E_RESULTS.md` and `UNIFIED_INPUT_VALIDATION_EVIDENCE.md`.
- The disposable, expiring, mobile iPhone test surface was implemented and locally validated (`dccb391`). No public test deployment was created.
- A sanitized public frontend health endpoint was merged and is live at the custom and Vercel URLs (`afc330c`, deployment-trigger commits `642c0e0` and `cccfbba`).
- The older 114-test delivery snapshot in `BLACKSPIRE_DELIVERY.md` and 124-test Unified Input snapshot in `UNIFIED_INPUT_FOUNDATION.md` are `SUPERSEDED` by the 130-test validation at `dccb391`; their historical architectural evidence remains useful.

## Active Work

- **Current branch/worktree:** `feature/unified-input-foundation` in an isolated worktree; clean before this documentation task; ahead of `origin/main` by four local commits.
- **Current objective:** Establish this permanent repository memory and a safe staleness/secret-shape checker. The next product objective is a private, temporary, iPhone-accessible Unified Jarvis acceptance surface.
- **Files under development:** `AGENTS.md`, this document, and `scripts/update-source-of-truth-check.sh` only.
- **Acceptance criteria:** Canonical memory reflects verified state, uncertainties are labeled, checker is read-only, documentation/security checks pass, and changes are committed locally.
- **Approved scope:** Local documentation, read-only verification, and a local commit. Codespaces scope was operator-authorized for the prior test-build objective, but no deployment exists.
- **Prohibited actions:** Push, merge, deployment, production credential/database/provider use, real Telegram connection, paid calls, DNS/host-security changes, secret disclosure, and live trading or funds actions.

## Decisions and ADR Summary

| Decision | Reason | Date | Evidence | Supersedes |
|---|---|---|---|---|
| Make this file canonical living memory | Chat history and scattered planning files are not reliable session recovery | 2026-07-18 | This document and root `AGENTS.md` | Legacy `memory/` files and `PROJECT_CONTEXT.md` as current-state authorities |
| Persist canonical state before channel delivery | Delivery failure must not corrupt task state and must remain retryable/visible | 2026-07-18 | Unified implementation/tests, `875a78e` | Direct channel-owned task state |
| Run deterministic policy before Hermes/providers | Authority, workspace, budget, emergency, and trading controls must not depend on a model | 2026-07-18 | `packages/unified-input/unified.js`, policy tests | Any provider-first interpretation |
| Keep Telegram non-approving and non-privileged | A messaging channel cannot expand constitutional/operator authority | 2026-07-18 | Unified policy classifier and tests | Older generic Telegram `/approve` command behavior for unified intake |
| Use mock Hermes/Telegram and disposable SQLite for acceptance | Proves the vertical slice without credentials, spend, production state, or external calls | 2026-07-18 | E2E and iPhone test-build evidence | Live-provider validation for this phase |
| Prefer a private expiring Codespace for first device test | It can expose HTTPS while retaining disposable local SQLite and test-only configuration | 2026-07-18 | `UNIFIED_INPUT_IPHONE_TEST_BUILD_PLAN.md` | Public Vercel for a stateful SQLite test runtime |

No standalone Constitution text or ADR defining it was found in the inspected repository. Its authority boundaries are therefore preserved as explicit requirements and enforced policy categories, while the canonical Constitution document/location is `UNVERIFIED`.

## Security and Authority Boundaries

- **Constitution authority:** Constitutional changes are privileged and denied from Telegram. The location/text of a canonical Constitution is `UNVERIFIED`; do not invent or alter it.
- **Approvals:** High-risk execution pauses before provider dispatch. Required operator approvals cannot be manufactured by an agent or channel.
- **Telegram restrictions:** Telegram cannot approve/reject privileged work or authorize deployment, merge, repository creation, credentials/secrets, host security, budget increases, emergency controls, constitutional changes, trading, or funds actions.
- **Workspace isolation:** Every task resolves an allowed workspace and path/tool policy; cross-channel conversation attachment requires explicit binding/authorization.
- **Budgets:** Workspace and task budget checks precede provider execution. Budget increases require separate authority.
- **Secrets:** Values belong in approved environment/secret stores only. Responses, events, evidence, logs, and delivery payloads are sanitized; documentation records authentication method names only.
- **Emergency stop / Safe Mode:** Execution must stop or deny before provider dispatch when emergency or safe-mode policy requires it. Telegram cannot change emergency controls.
- **Deployment and merge:** Never deploy, push, merge, open/approve a PR, or change production behavior without the required explicit approval.
- **Live trading:** Live trading, funds movement, and Telegram trading authority are prohibited. No current approval enables them.

## Environments and Deployments

| Environment | Verified state | Domain / health | Provider | Root / branch | Notes |
|---|---|---|---|---|---|
| Local Command | validated | loopback only | Node.js + local SQLite | repository root / `feature/unified-input-foundation` | Mock and controlled providers used for validation |
| Temporary iPhone test | staged locally | No URL | Planned private GitHub Codespace | repository root / feature branch | Disposable SQLite, mock Hermes/Telegram, test auth, expiry/cleanup implemented |
| Preview | `UNVERIFIED` / none for Unified Jarvis | No verified Unified Jarvis preview URL | None verified | N/A | Do not infer from frontend previews |
| Public frontend production | production | `https://blackspirehelix.com`; `/health` live-checked | Vercel | `frontend/` / `main` | Sanitized health only was independently checked this session |
| Vercel project URL | production | `https://frontend-tau-woad-73.vercel.app/health` live-checked | Vercel | `frontend/` / `main` | Project identity is documented in `frontend/README.md` |
| Oracle Helix deployment | `UNVERIFIED` | Configuration exists; live URL not asserted here | Vercel workflow | `oracle-helix/` / `main` path trigger | Requires separate live verification |

Production DNS was not changed during the Unified Input or memory work. Root Blackspire Command is not proven deployed to Vercel and its SQLite runtime should not be treated as serverless production persistence.

## Integrations

| Integration | Purpose | Status | Authentication method (name only) | Environment | Limitations / next action |
|---|---|---|---|---|---|
| Git/GitHub | Source history, CI, branches, PR artifacts | implemented | Root-owned Blackspire GitHub CLI wrapper with operator-provided fine-grained PAT | local + GitHub | Credential value is external to the repository and scoped to wrapper child processes only |
| GitHub Codespaces | Private HTTPS device test candidate | authorized | Fine-grained PAT through the Blackspire GitHub CLI wrapper | test | Identity, repository access, and Codespaces listing verified; temporary lifecycle validation is approved next |
| Vercel | Public frontend deployment | production | Vercel project credentials | production | Do not use for stateful Unified Jarvis SQLite test without a new design/approval |
| UptimeRobot | Public health monitoring | documented production | UptimeRobot account auth | production | Dashboard and alert delivery need fresh verification |
| Telegram | Constrained intake and delivery | mock validated | Bot token + webhook secret by name only | local/test | Real bot/API is intentionally disconnected and unverified |
| Mock Hermes | Credential-free task execution proof | validated | none | local/test | Read-only/status fixture only |
| OpenAI / Anthropic | Optional provider APIs | implemented | provider API key by name only | not exercised | No production credentials or paid calls used in this work |
| Codex / Claude Code | Optional CLI execution adapters | implemented | CLI authentication by name only | local | Live adapter execution not part of credential-free slice |
| SQLite | Canonical task/conversation persistence | validated | filesystem permissions | local/test | Single-host; temporary test database must be removed at teardown |

## Tests and Validation

Latest verified commands/results at `dccb391` are recorded in `UNIFIED_INPUT_IPHONE_ACCEPTANCE_RESULTS.md` and `UNIFIED_INPUT_IPHONE_TEST_BUILD_STATUS.md`:

- `npm run test:iphone` — 5 passed, 0 failed.
- Targeted Unified Input, security, and Jarvis regression — 25 passed, 0 failed. The exact file list was not retained in the acceptance document and is therefore `UNVERIFIED`; do not reconstruct it from memory.
- `npm test` — 130 passed, 0 failed, 0 skipped.
- `npm run build` — passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run security:scan` — passed.
- `npm audit --audit-level=high` — passed with 0 vulnerabilities.
- `git diff --check` — passed.
- Expiring loopback launcher smoke — passed and reported cleanup complete.

The earlier credential-free E2E milestone retains its exact commands (without requiring any production service) in `UNIFIED_INPUT_LOCAL_E2E_RESULTS.md`; that snapshot recorded 70 targeted tests and 125 full tests passing before the iPhone test-build additions. Its test totals are historical, not the current 130-test baseline.

Known failing tests: none in that local run. Known skipped tests: none. A current GitHub CI run for the four unpushed feature commits is `UNVERIFIED`. Real iPhone Safari, real Telegram, live provider, and public Unified Jarvis deployment tests have not run.

## Known Blockers and Risks

| Severity | Blocker / risk | Owner | Evidence | Safest resolution | Approval required |
|---|---|---|---|---|---|
| High | No iPhone-accessible HTTPS test URL | Codex | Headless wrapper now lists Codespaces and accesses the repository successfully | Create the approved private expiring Codespace and expose only the authenticated test port | Already approved for this credential-free test |
| High | SQLite is single-host and unsuitable for multi-instance/serverless production as designed | Engineering | Known limitations and persistence implementation | Keep disposable/single-instance for test; design durable shared persistence before production | Architecture and production approval |
| Medium | Canonical Constitution document/location not found | Product/security owner | Repository search on 2026-07-18 | Identify or author through a separately approved constitutional process | Yes |
| Medium | Real Telegram transport and device flow unverified | Operator + engineering | Known limitations and test evidence | Run mock-only iPhone acceptance first; authorize real Telegram separately if ever needed | Yes for any real bot/token |
| Medium | Live provider behavior/cost boundaries not validated in this slice | Engineering/security | Mock-only evidence | Keep providers disabled until credential, spend, policy, and test approval | Yes |
| Low | Legacy planning/memory documents contain superseded status and test totals | Documentation | `PROJECT_CONTEXT.md`, `BLACKSPIRE_DELIVERY.md`, `memory/` | Use this file as authority and update legacy docs only when relevant | No for documentation-only work |

## Immediate Next Safe Actions

1. Run `scripts/update-source-of-truth-check.sh` at the start of the next session and inspect Git/relevant code before planning.
2. Re-run the targeted tests and gates, then create an isolated, private, expiring Codespace using only test configuration and disposable SQLite.
3. Verify Codespace create/start/stop/delete permissions through the approved temporary lifecycle without touching unrelated existing Codespaces.
4. Perform the documented iPhone Safari acceptance scenarios, capture sanitized evidence, and tear the test surface down.
5. Update this file with the actual URL status, device results, cleanup evidence, new commit, and remaining blockers.

## Operator-Only Actions

- Complete GitHub's device authorization page for the GitHub CLI and approve the requested `codespace` scope. Do not paste the resulting token or any credential into chat or documentation.
- On the first real iPhone run, open the private HTTPS URL, authenticate with the temporary test-only method, execute the acceptance steps in `UNIFIED_INPUT_IPHONE_TEST_GUIDE.md`, and report only the sanitized outcome.
- Any production, DNS, paid provider, real Telegram, constitutional, emergency-control, host-security, budget-increase, trading, or funds action requires its own explicit approval and is not implied here.

## Rollback and Recovery

- **Important branches:** `main`/`origin/main` is the merged base; `feature/unified-input-foundation` contains the four local Unified Input/test-build commits plus this memory commit.
- **Relevant commits:** base `cccfbba8dc56c086e0ff8e6bd5ca5d2bd972ba4e`; Unified Input `2d2a915`, `dddfb1b`; validation `875a78e`; iPhone test build `dccb391`.
- **Code rollback:** Do not rewrite history or reset the worktree. Prefer a reviewed `git revert <commit>` after confirming the exact target and obtaining authority for any shared branch change.
- **Test-build teardown:** Stop the process, remove the disposable Codespace/deployment and test-only auth/config, and confirm temporary SQLite/state deletion per `UNIFIED_INPUT_TEST_BUILD_TEARDOWN.md`.
- **Persistence recovery:** Use the tested `npm run db:backup` / `npm run db:restore -- <backup-file>` scripts only after stopping writers and validating the exact disposable/local target; Unified Input rollback details are in `UNIFIED_INPUT_ROLLBACK.md` and `UNIFIED_INPUT_TEST_BUILD_ROLLBACK.md`.
- **Evidence/recovery documents:** `BLACKSPIRE_DELIVERY.md`, `BLACKSPIRE_COMMAND_BUILD_REPORT.md`, `UNIFIED_INPUT_VALIDATION_EVIDENCE.md`, `UNIFIED_INPUT_LOCAL_E2E_RESULTS.md`, and `UNIFIED_INPUT_IPHONE_ACCEPTANCE_RESULTS.md`.

## Change Log

### 2026-07-18 — Persistent headless GitHub authentication configured

- **Authentication:** Operator-provided fine-grained PAT loaded only by the root-owned Blackspire GitHub CLI wrapper. The credential value remains outside the repository and is not recorded here.
- **Verification:** GitHub identity, Codespaces listing, repository visibility, and repository permissions succeeded; the wrapper did not leave `GH_TOKEN` in the parent environment.
- **Safeguards:** Root-only storage modes, repository ignore rules, secret-scan protection, and backup exclusion were added. The earlier device authorization flow is no longer used.
- **Next action:** Use the already approved temporary Codespace to verify create/start/stop/delete lifecycle permissions and run private iPhone acceptance.
- **Long-term recommendation:** Migrate to a dedicated Blackspire GitHub App using short-lived installation or user tokens after a separately reviewed permissions design.

### 2026-07-18 — Disconnected Unified Input session recovered and reverified

- **Summary:** Recovered the clean isolated `feature/unified-input-foundation` worktree at `2ab3394`, reconciled the five local commits above base `cccfbba`, and confirmed no implementation work was missing or partially staged.
- **Implementation:** Unified Input remains complete through `dccb391`; this documentation reconciliation is the commit containing this entry.
- **Tests:** Targeted credential-free suites passed (1 E2E, 34 unified/core/orchestration/hardening, 35 Jarvis/Telegram/persistence/integration, and 5 iPhone-mode tests). Complete regression passed with 130 tests, 0 failed, 0 skipped under Node 22.23.1. Build, lint, typecheck, secret scan, dependency audit, source-memory, and whitespace checks passed.
- **Boundary evidence:** Mock Hermes, mock Telegram delivery, loopback services, temporary SQLite, and controlled local providers only. No real Telegram, production credentials, production calls, deployment, push, merge, or host-security change occurred.
- **Rollback:** Preserve the recovered commits and use reviewed `git revert` operations rather than reset or history rewriting.
- **Remaining blocker:** Private iPhone Safari acceptance still requires an operator-authorized GitHub CLI `codespace` OAuth scope and a separately confirmed credential-free local end-to-end validation run.

### 2026-07-18 — Canonical living memory established

- **Summary:** Reconciled Git, code, architecture, local validations, deployment configuration, live health checks, and legacy planning documents into one canonical memory; added a read-only staleness/secret-shape check.
- **Branch:** `feature/unified-input-foundation`.
- **Commit:** implementation state verified through `dccb391e550e64bbfc8930d28238738e426131f8`; the documentation commit is the commit containing this entry (`docs: establish canonical Blackspire living memory`).
- **Tests:** Documentation checker and secret scans are required before committing; latest product baseline is 5 targeted iPhone, 25 targeted unified/security/Jarvis, and 130 full tests passing.
- **Decision:** This file supersedes legacy memory documents for current-state recovery; historical evidence remains linked rather than deleted.
- **Remaining blocker:** GitHub CLI lacks `codespace` OAuth scope, so no private iPhone test URL or device acceptance result exists.
