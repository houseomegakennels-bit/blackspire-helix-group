# Blackspire Canonical Source of Truth

## Authority

The durable authority is GitHub repository `houseomegakennels-bit/blackspire-helix-group`. Code, commits, tests, deployment evidence, and explicit operator-confirmed results outrank summaries. Unsupported current-state claims are `UNVERIFIED`.

- Last reconciled: 2026-07-18 UTC
- Base `origin/main`: `029e38add2157d5b7caefb3a6c5d85e9270f80f2`
- Last verified implementation commit: `ebead48f8e9695b141a5803b580d5f4c3fa86135`
- Canonical memory merged by PR #24; this feature branch preserves the canonical structure
- Canonical current state: this file plus the other `docs/BLACKSPIRE_*.md` memory files

This record supersedes `PROJECT_CONTEXT.md`, `WORKFLOW.md`, `AI_WORKSPACE_SYNC.md`, root `memory/*.md`, and historical delivery/planning documents for current-state recovery. Those remain evidence and history, not living authority.

## Verified architecture

- `frontend/` is the Next.js public Blackspire surface deployed separately through Vercel. Its sanitized `/health` route is on `origin/main`.
- Root Blackspire Command is a Node.js control plane: API, Jarvis PWA, worker, Telegram bridge, Hermes orchestration, deterministic policy, workspace registry, approvals, evidence, audit, emergency controls, provider adapters, and SQLite persistence.
- Unified Input adds shared Jarvis/Telegram conversations, ordered events, idempotency, cancellation, channel bindings, a delivery outbox, and mock-safe acceptance tooling.
- Canonical runtime state is persisted before channel delivery. SQLite is validated for a single durable host, not multi-instance/serverless production.
- The planned production-state owner is the durable VPS. Codespaces and Quick Tunnels are disposable development/recovery/test surfaces and must not own production state or uptime.

## Implementation and validation status

| Area | Status | Evidence and limit |
|---|---|---|
| Command control plane | VERIFIED on `origin/main` | Merged through PR #21; historical delivery evidence records 114 tests passing. |
| Public health endpoint | VERIFIED implemented and merged | `afc330c`, merged by `e4ddbc9`; deployment trigger commits `642c0e0`, `cccfbba`. Point-in-time live checks are historical evidence. |
| Wave 1 monitoring | OPERATOR-CONFIRMED complete | `WAVE1_MONITORING_COMPLETION.md` records UptimeRobot HTTP monitoring and email alerts. Current dashboard/alert delivery is `UNVERIFIED`. |
| Unified Jarvis + Telegram | VERIFIED locally and OPERATOR-CONFIRMED on iPhone Safari after main integration and repository-policy fix, not published | Harmless input, shared-conversation follow-up, idempotent replay, Telegram policy denial, cancellation, and bounded mock delivery failure passed on the isolated disposable surface; 139 full tests passed with mock-only providers and disposable state. |
| Real Telegram transport | UNVERIFIED / disconnected | Mock transport, allowlisting, attachments, replay protection, and delivery behavior are tested. No real bot connection is authorized or claimed. |
| Hermes/providers | VERIFIED restricted foundation and subscription Codex worker acceptance | Version 1 restricted contracts and the single-use subscription Codex adapter are locally tested. One final authorized invocation used ChatGPT subscription authentication, passed the exact response contract, completed canonical state, and cleaned disposable state with no API key, retry, fallback, or observed tool call. |
| Restricted worker publication | BLOCKED safely before push | Local branch is review-ready at `85beabc`, but the remote feature branch remains at `2ab3394` and no PR exists. GitHub deployment evidence shows both `blackspire-helix-group` and `frontend` create Vercel previews for non-main commits. No authenticated Vercel CLI session or approved Vercel token is available to read back or set a branch-specific Ignored Build Step, so no push was attempted. |
| VPS production Command | PLANNED, UNVERIFIED live | Readiness code and runbooks exist; supervision, backups, stable HTTPS, and live production state require verification. No disposable iPhone test process or tunnel was active at the latest local inspection. |
| Codespace recovery/test | BLOCKED | Preparation exists; creation returned a usage-budget HTTP 402 and no resource was created or changed. |

## Important branches and commits

- `origin/main`: `029e38a`, including canonical-memory PR #24.
- `feature/unified-input-foundation`: preserved commits `70e7f36`, `273a25b`, `43735f6`, and `9bdfa5f`; integration uses a merge commit, never rebase or history rewriting.
- Restricted subscription Codex milestones on that branch: implementation `c21db48`, diagnostic classification `aedb9db`, exact-contract correction `ebead48`, and sanitized successful acceptance evidence `85beabc`.
- Local `feature/unified-input-foundation` is 21 commits ahead of `origin/feature/unified-input-foundation`; the remote branch has not received the completed worker foundation.
- Backup before integration: `backup/unified-input-foundation-9bdfa5f` at `9bdfa5f`.
- Existing `feature/public-health-route` remains intentionally untouched.

## Tests and evidence

- Merged base delivery: 114 tests, zero failures; build, lint, typecheck, security scan, audit, and whitespace checks passed as recorded in `BLACKSPIRE_DELIVERY.md`.
- Unified Input iPhone milestone at `dccb391`: 5 targeted iPhone tests, 25 targeted regression tests, and 130 full tests passed.
- Dual-environment head `9bdfa5f`: 14 targeted and 132 full tests passed with zero failures/skips under Node 22.23.1; build, lint, typecheck, full-tree secret scan, dependency audit, disposable lifecycle smoke, and whitespace checks passed.
- Post-integration at `b270ad3`: 40 targeted and 132 full tests passed with zero failures/skips under Node 22.23.1. Build, lint, typecheck, full-tree secret scan, dependency audit, and whitespace checks passed. Real Telegram, paid/live providers, and production Unified Jarvis remain `UNVERIFIED`.
- Repository-policy fix at the current branch head: 7 focused policy tests, 35 focused Unified/iPhone/Telegram tests, and 139 full tests passed with zero failures/skips under Node 22.23.1. Repository creation variants return HTTP 403, remain terminal without queued/running events, and record zero Hermes, provider, worker, or approval dispatch. Build, lint, typecheck, secret scan, living-memory, and whitespace checks passed.
- Operator iPhone Safari acceptance at `eceb921`: harmless task, follow-up conversation reuse, idempotent replay, Telegram denial before Hermes, eligible cancellation, and bounded mock delivery failure all passed. The temporary application, authentication material, SQLite workspace, loopback listener, and Quick Tunnel were then removed and verified absent.
- Restricted Hermes readiness at `ac3d887`: 35 focused Hermes/policy/Unified tests and 148 full tests passed with zero failures/skips under Node 22.23.1; build, lint, typecheck, secret scan, living-memory, and whitespace checks passed.
- Restricted subscription Codex acceptance: official Codex CLI 0.144.5 reported ChatGPT login; the final authorized noninteractive invocation passed the exact version 1 operational contract and completed canonical state with no API key, retry, fallback, or observed tool call. Disposable runtime/state were removed. Detailed sanitized evidence is in `RESTRICTED_CODEX_ACCEPTANCE.md`.
- Subscription Codex worker implementation at `c21db48`: 38 targeted and 154 full tests passed with zero failures/skips under Node 22.23.1; build, lint, typecheck, secret scan, living-memory, and whitespace checks passed.
- Subscription Codex diagnostic at `aedb9db`: one authorized invocation produced category `nonzero_exit_with_structured_stdout_error`; a confirmed stdout/stderr classification defect was fixed. Forty targeted and 156 full tests passed with zero failures/skips; build, lint, typecheck, secret scan, living-memory, and whitespace checks passed.
- Final subscription Codex acceptance at `85beabc`: exactly one ChatGPT-subscription-authenticated `codex exec` invocation exited zero, emitted four sanitized structured records with no error event, passed the exact version 1 operational contract, and completed canonical task state. It used no API key, standalone Blackspire Responses API call, retry, fallback, or observed tool call. Forty targeted and 156 full tests passed; build, lint, typecheck, secret scan, living-memory, whitespace, teardown, and scope checks passed.
- Publication preflight reran 40 targeted and 156 full tests with zero failures/skips; build, lint, typecheck, secret scan, living-memory, and whitespace checks passed. The working tree remained clean and no runtime, deployment, push, PR, merge, production change, or Telegram connection occurred.

## Environments and integrations

- Public frontend production is owned by Vercel; production configuration remains external.
- GitHub deployment records show two Vercel projects for this repository: `blackspire-helix-group` and `frontend`. Both have created previews for non-main refs. The official Vercel CLI was inspected at version 56.3.2, but this host has no authenticated Vercel session or approved token; current project Git/build settings and Ignored Build Step values therefore remain `UNVERIFIED`.
- The intended reversible skip command is `[ "$VERCEL_GIT_COMMIT_REF" = "feature/unified-input-foundation" ]`; local shell checks prove exit 0 only for that exact branch and exit 1 for `main` and unrelated branches. It has not been verified as saved on either Vercel project.
- VPS is the sole planned Command state owner. Actual live ownership and health are `UNVERIFIED`.
- Codespaces are disposable development/recovery/test environments and are currently limited by exhausted usage credit.
- Quick Tunnel is temporary, expiring, isolated, and mock-only; it is never production.
- Mock/local validated integrations: Hermes, Telegram input/delivery behavior, disposable SQLite, loopback API/PWA, policy denial, cancellation, idempotency, outbox failure, and backup/restore.
- Implemented and restricted-live-validated here: the subscription-authenticated Codex CLI worker path only. Not live-validated here: Claude Code CLI, standalone OpenAI/Anthropic providers, real Telegram, and production Command startup.
- GitHub headless authentication method: root-owned Blackspire GitHub CLI wrapper using an operator-provided fine-grained personal access token. Method name only; no value belongs in Git or memory.

## Security and authority restrictions

- Deterministic policy must run before any model/provider.
- Required approvals cannot be created or widened by an agent or Telegram.
- Enforce workspace/path/tool isolation and budget limits before execution.
- Evidence, audit records, provider attribution, and delivery failures must remain durable and sanitized.
- Emergency stop and Safe Mode deny work before provider dispatch; Telegram cannot alter them.
- No secret disclosure, credential persistence in docs, unapproved push/merge/deploy, host-security changes, production calls, budget increases, real Telegram connection, live trading, or funds movement.
- The location/text of a canonical Constitution is `UNVERIFIED`; do not invent one.

## Blockers and next safe actions

Current blockers: the completed implementation remains unpublished because both Vercel projects must independently read back the exact branch-specific Ignored Build Step before push, and this host lacks Vercel account authentication. Codespaces usage credit is exhausted; every new subscription Codex task still requires separate scoped approval; real Telegram, production Command state, and other live providers are unverified; SQLite requires a single-host production design; Constitution authority is unresolved.

Immediate safe actions:

1. Preserve the unpublished Unified Input stack and its backup branch without rewriting history.
2. Preserve the operator-confirmed iPhone acceptance and verified teardown evidence; do not restage unless a new acceptance need is explicitly approved.
3. Continue credential-free local checks only when they validate new work or reconcile changed state.
4. Complete production readiness, backup, monitoring, stable HTTPS, and rollback verification before any VPS promotion.
5. After an authorized operator saves the exact branch-specific Ignored Build Step on both Vercel projects, read back both settings before rerunning publication gates, pushing only the feature branch, monitoring for skipped deployments, and opening an unmerged draft PR.

Operator-only actions include spending/budget changes, credential provisioning, GitHub authorization, device acceptance, real Telegram connection, production/DNS/provider/host-security changes, approval-policy changes, emergency-control changes, trading, and funds actions.

## Rollback and recovery

- Preserve commits; use reviewed `git revert`, never reset or history rewriting, for shared-history rollback.
- Recover pre-integration Unified work from `backup/unified-input-foundation-9bdfa5f`.
- A protected, owner-only Git bundle of `feature/unified-input-foundation` at `85beabc` was created outside the repository and verified as complete. Sanitized SHA-256: `bf22dd01d8433e516e084a323740f5b39403dabe846e08acd21f4db9c7a5a9b6`.
- Use tested backup/restore commands only against an explicitly identified stopped local/disposable database.
- Disposable iPhone state and tunnel must be stopped and deleted without touching durable VPS state.
- Recovery begins with `git fetch`, worktree/branch/status inspection, this file, then affected code/evidence. Never copy production state into Codespaces or tests.
