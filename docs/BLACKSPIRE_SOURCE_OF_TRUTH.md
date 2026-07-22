# Blackspire Canonical Source of Truth

## Authority

The durable authority is GitHub repository `houseomegakennels-bit/blackspire-helix-group`. Code, commits, tests, deployment evidence, and explicit operator-confirmed results outrank summaries. Unsupported current-state claims are `UNVERIFIED`.

- Last reconciled: 2026-07-22 UTC
- Base `origin/main`: `691973870e0048f273fa7e9251d7f78776e3612b`
- Last verified implementation commit: `03708c49e4772534992fbcc2fcdcabdfb40e6f1d` (merged into `main` by `691973870e0048f273fa7e9251d7f78776e3612b`)
- PR #26 passed independent review and independent second review (253/253 tests, build, lint, typecheck, secret scan, living-memory, and `git diff --check`; zero confirmed defects, three informational findings) and was merged into `main` with a merge commit (`a9602496`, parents `405a4166` + `aa4cc608`); reviewed history was preserved, not squashed or rebased. The merge covered repository readiness tooling only. Both Vercel projects were canceled by the Ignored Build Step, no application build executed, and no live VPS, production database, service, or production surface changed. `READY_FOR_VPS_PRODUCTION_DEPLOYMENT` remains `no` pending the host-side blockers.
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
| Restricted worker publication | PUBLISHED (branch only); no PR | Corrected 2026-07-19 against observed refs: `origin/feature/unified-input-foundation` is at `7dbe07f`, not `2ab3394`, and the remote-ref reflog records two pushes (`2ab3394`, then `7dbe07f`). The published range is `029e38a..7dbe07f` (ahead=25, behind=0). No PR exists and nothing is merged to `main`. GitHub deployment evidence shows both `blackspire-helix-group` and `frontend` create Vercel previews for non-main commits. No authenticated Vercel CLI session or approved Vercel token is available to read back or set a branch-specific Ignored Build Step, so no push was attempted. |
| VPS production Command | READINESS TOOLING MERGED; live UNVERIFIED | Immutable release, WAL-safe backup/restore, no-provider profile, production supervisor, hardened path/runtime verification, monitoring templates, shallow-checkout-safe release tests, CI-hardened smoke startup, and collision-safe worker claim readback merged into `main` via PR #26 (`a9602496`). Live supervision, reverse proxy/TLS, least-privileged runtime ownership, backups, stable HTTPS, and activation remain unverified and untouched; six host-side blockers stay open. |
| Codespace recovery/test | BLOCKED | Preparation exists; creation returned a usage-budget HTTP 402 and no resource was created or changed. |

## Important branches and commits

- `origin/main`: `405a416`, including merged PR #25 and the Jarvis/Unified Input feature.
- `feature/unified-input-foundation`: preserved commits `70e7f36`, `273a25b`, `43735f6`, and `9bdfa5f`; integration uses a merge commit, never rebase or history rewriting.
- Restricted subscription Codex milestones on that branch: implementation `c21db48`, diagnostic classification `aedb9db`, exact-contract correction `ebead48`, and sanitized successful acceptance evidence `85beabc`.
- Draft PR #26 publishes the repository-side durable-VPS readiness work from `feature/unified-input-foundation` for independent review. The latest verified code fix is `8c1010d691513e584c085a1b50ac430dc55affd2`; do not mark ready, merge, or deploy without separate explicit authority.
- Backup before integration: `backup/unified-input-foundation-9bdfa5f` at `9bdfa5f`.
- Existing `feature/public-health-route` remains intentionally untouched.
- Readiness commits include `ac7a0ba` (release/backup/no-provider foundation), `73bf031` (explicit disposable restore rehearsal guard), `302e2f0` (rehearsal docs), `bd90fcf` (checksum-required restore), `204a98e` (verified restore guard docs), `42a0d1f` (shallow-checkout-safe release test), `459db4e` (CI-hardened smoke startup wait), and `8c1010d` (worker claim readback collision safety). They are published only on draft PR #26, not merged.

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
- Durable-VPS readiness publication: local head `204a98e` passed 59 focused readiness/Jarvis/CSP tests and 228 full tests under Node 22.23.1; build, lint, typecheck, secret scan, living-memory, and whitespace checks passed. Draft PR #26 exposed CI-only test fragility: `42a0d1f` fixes the release readiness test for depth-1 PR merge checkouts, `459db4e` makes the smoke test wait on `127.0.0.1` health before asserting, and `8c1010d` makes task-claim readback filter by both timestamp and assigned worker to avoid same-second CI collisions. Focused acceptance/orchestration/core validation passed 26/26 under Node 22.23.1 after the worker-claim fix. No live service or database was touched.

## Environments and integrations

- Public frontend production is owned by Vercel; production configuration remains external.
- GitHub deployment records show two Vercel projects for this repository: `blackspire-helix-group` and `frontend`. Both created canceled Vercel records for draft PR #26 head `204a98e`; neither became READY and no production target was assigned. The exact saved Ignored Build Step command remains `UNVERIFIED` because the project reader does not expose it.
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

Gate 3 data-protection rehearsal remains BLOCKED as of 2026-07-22 UTC. PR #28 explicit-migration repair was independently reviewed and merged by `691973870e0048f273fa7e9251d7f78776e3612b`; migration safety is green. A restricted-staging rebuild then stopped before activation when its new immutable release `releases/691973870e0048f273fa7e9251d7f78776e3612b` was `0700 root:root`, preventing the `blackspire` runtime from traversing it. PR #29’s source-only follow-up establishes `root:blackspire` / `0755` for both the release root and `releases/` parent; normalizes release directories/executables to `0755` and ordinary files to `0644`; excludes safe review/development metadata from the artifact; and creates `.release-complete` only after full type, containment, ownership, and mode validation. Its one shared validator is used by release creation, explicit preflight, switch, and rollback; it fails closed for symlinked ancestors and every dangling, looping, or out-of-tree canonical symlink while allowing only canonical in-tree targets. Disposable archived-source fixtures cover relative, absolute, nested, chained, dangling, and looping links before any candidate can receive the marker or replace active state. It preserves completed releases/shared state and the active link on failure. It has not rebuilt or switched staging. The prior staging/public-health claims are historical and currently `UNVERIFIED` from this workspace. `current`, `/etc/blackspire/command.env`, and the production `command.sqlite` remain absent; `blackspire-command.service` is disabled/inactive. No Gate 3 backup, restore, WAL rehearsal, timer installation, production-path write, or service restart occurred. `READY_TO_REQUEST_GATE_4_PRODUCTION_ACTIVATION: no` and `READY_FOR_VPS_PRODUCTION_DEPLOYMENT: no`.

Current blockers: PR #26 readiness tooling is merged into `main`, but production deployment is not authorized. Six host-side blockers remain, each requiring separate explicit approval: (1) approved reverse proxy and TLS installation and verification; (2) least-privileged non-root runtime ownership provisioning; (3) installed and alert-tested monitoring and log rotation; (4) separately approved real production backup and migration rehearsal or execution; (5) an exact known-good live release and database rollback target recorded; and (6) readiness tooling incorporated into the deployment artifact. Reverse-proxy/TLS and runtime-ownership plans plus credential-free verification are prepared as reviewed `ops/` templates only; nothing is installed or applied. Codespaces usage credit is exhausted; every new subscription Codex task still requires separate scoped approval; real Telegram, production Command state, and other live providers are unverified; SQLite requires a single-host production design; Constitution authority is unresolved.

Immediate safe actions:

1. Preserve the unpublished Unified Input stack and its backup branch without rewriting history.
2. Preserve the operator-confirmed iPhone acceptance and verified teardown evidence; do not restage unless a new acceptance need is explicitly approved.
3. Continue credential-free local checks only when they validate new work or reconcile changed state.
4. Complete production readiness, backup, monitoring, stable HTTPS, and rollback verification before any VPS promotion.
5. PR #26 readiness tooling is merged; do not deploy or activate any release until the six host-side blockers are closed and a separate bounded production approval is given. Treat the prepared `ops/` proxy/TLS and ownership templates as review artifacts, not installed configuration.

Operator-only actions include spending/budget changes, credential provisioning, GitHub authorization, device acceptance, real Telegram connection, production/DNS/provider/host-security changes, approval-policy changes, emergency-control changes, trading, and funds actions.

## Rollback and recovery

- Preserve commits; use reviewed `git revert`, never reset or history rewriting, for shared-history rollback.
- Recover pre-integration Unified work from `backup/unified-input-foundation-9bdfa5f`.
- A protected, owner-only Git bundle of `feature/unified-input-foundation` at `85beabc` was created outside the repository and verified as complete. Sanitized SHA-256: `bf22dd01d8433e516e084a323740f5b39403dabe846e08acd21f4db9c7a5a9b6`.
- Use tested backup/restore commands only against an explicitly identified stopped local/disposable database.
- Disposable iPhone state and tunnel must be stopped and deleted without touching durable VPS state.
- Recovery begins with `git fetch`, worktree/branch/status inspection, this file, then affected code/evidence. Never copy production state into Codespaces or tests.
