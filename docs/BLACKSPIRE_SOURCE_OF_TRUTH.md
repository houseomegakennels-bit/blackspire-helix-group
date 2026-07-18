# Blackspire Canonical Source of Truth

## Authority

The durable authority is GitHub repository `houseomegakennels-bit/blackspire-helix-group`. Code, commits, tests, deployment evidence, and explicit operator-confirmed results outrank summaries. Unsupported current-state claims are `UNVERIFIED`.

- Last reconciled: 2026-07-18 UTC
- Base `origin/main`: `cccfbba8dc56c086e0ff8e6bd5ca5d2bd972ba4e`
- Last verified implementation commit: `9bdfa5fa636df8730f046fc2d66eb4683e5aaba1` (local-only at reconciliation)
- Canonical memory branch: `docs/canonical-living-memory`
- Canonical current state: this file plus the other `docs/BLACKSPIRE_*.md` memory files

This record supersedes `PROJECT_CONTEXT.md`, `WORKFLOW.md`, `AI_WORKSPACE_SYNC.md`, root `memory/*.md`, and historical delivery/planning documents for current-state recovery. Those remain evidence and history, not living authority.

## Verified architecture

- `frontend/` is the Next.js public Blackspire surface deployed separately through Vercel. Its sanitized `/health` route is on `origin/main`.
- Root Blackspire Command is a Node.js control plane: API, Jarvis PWA, worker, Telegram bridge, Hermes orchestration, deterministic policy, workspace registry, approvals, evidence, audit, emergency controls, provider adapters, and SQLite persistence.
- Canonical runtime state is persisted before channel delivery. SQLite is validated for a single durable host, not multi-instance/serverless production.
- The local-only Unified Input line adds shared Jarvis/Telegram conversations, ordered events, idempotency, cancellation, channel bindings, delivery outbox, and mock-safe acceptance tooling.
- The planned production-state owner is the durable VPS. Codespaces and Quick Tunnels are disposable development/recovery/test surfaces and must not own production state or uptime.

## Implementation and validation status

| Area | Status | Evidence and limit |
|---|---|---|
| Command control plane | VERIFIED on `origin/main` | Merged through PR #21; historical delivery evidence records 114 tests passing. |
| Public health endpoint | VERIFIED implemented and merged | `afc330c`, merged by `e4ddbc9`; deployment trigger commits `642c0e0`, `cccfbba`. Point-in-time live checks are historical evidence. |
| Wave 1 monitoring | OPERATOR-CONFIRMED complete | `WAVE1_MONITORING_COMPLETION.md` in local Unified Input history records UptimeRobot HTTP monitoring and email alerts. Current dashboard/alert delivery is `UNVERIFIED`. |
| Unified Jarvis + Telegram | VERIFIED locally, not merged | Implementation/validation lineage `2d2a915`, `dddfb1b`, `875a78e`, `dccb391`, `70e7f36`; canonical local head later became `9bdfa5f`. Mock-safe shared-state and policy behavior passed. |
| Real Telegram transport | UNVERIFIED / disconnected | Mock transport, allowlisting, attachments, replay protection, and delivery behavior are tested. No real bot connection is authorized or claimed. |
| Hermes/providers | VERIFIED with mock/manual paths | Provider attribution and fail-closed controls are tested. Real paid providers and production credentials were not exercised. |
| VPS production Command | PLANNED, UNVERIFIED live | Repository runbooks and readiness code exist only in local commit `9bdfa5f`; process supervision, backups, stable HTTPS, and live production state require verification. |
| Codespace recovery/test | BLOCKED | Preparation exists in `9bdfa5f`; creation returned a usage-budget HTTP 402 and no resource was created or changed. |

## Important branches and commits at reconciliation

- `origin/main`: `cccfbba`.
- Existing `feature/public-health-route`: local `1999413`, with an untracked push-error report; intentionally untouched.
- `feature/unified-input-foundation`: `9bdfa5f`, four commits ahead of its upstream. Local-only commits: `70e7f36` Unified Input foundation reconciliation, `273a25b` persistent headless GitHub authentication hardening, `43735f6` Codespaces budget blocker, `9bdfa5f` dual-environment readiness.
- `ops/durable-compose-workspace-root`: `afcb8a2`, four commits ahead of upstream at reconciliation.
- Other local Hermes task branches were preserved. See the dated session log for the audit snapshot.

## Tests and evidence

- Merged base delivery: 114 tests, zero failures; build, lint, typecheck, security scan, audit, and whitespace checks passed as recorded in `BLACKSPIRE_DELIVERY.md`.
- Unified Input iPhone milestone at `dccb391`: 5 targeted iPhone tests, 25 targeted regression tests, and 130 full tests passed; build, lint, typecheck, secret scan, dependency audit, launcher smoke, and whitespace checks passed.
- Dual-environment head `9bdfa5f`: 14 targeted and 132 full tests passed with zero failures/skips under Node 22.23.1; build, lint, typecheck, full-tree secret scan, dependency audit, disposable lifecycle smoke, and whitespace checks passed.
- GitHub CI for local-only commits, real iPhone Safari acceptance, real Telegram, paid/live providers, and production Unified Jarvis are `UNVERIFIED`.

## Environments and ownership

- Public frontend production: Vercel owns the deployed `frontend/` surface; production configuration remains external.
- Command production: VPS is the sole planned state owner. Actual live ownership and health are `UNVERIFIED` until operator evidence confirms them.
- Codespace: disposable development/recovery/private-test role only. Current account usage-credit limitation blocks new creation; do not enable billing or create resources without operator approval.
- Quick Tunnel: temporary, expiring, isolated mock-only device testing; never production.

## Integrations: mock versus real

- Mock/local validated: Hermes execution, Telegram input/delivery behavior, disposable SQLite, loopback API/PWA, policy denials, cancellation, idempotency, outbox failure, backup/restore.
- Implemented but not live-validated here: Codex CLI, Claude Code CLI, OpenAI, Anthropic, real Telegram, production Command startup.
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

Current blockers: local Unified Input/environment commits are unpublished; Codespaces usage credit is exhausted; device acceptance, real Telegram, live provider, and production Command state are unverified; SQLite requires a single-host production design; Constitution authority is unresolved.

Immediate safe actions:

1. Review and preserve the local Unified Input commit stack; push/merge only under separate authority.
2. Continue credential-free tests and documentation checks locally.
3. After usage renews, inspect the already operator-designated Codespace before considering creation; do not enable billing.
4. Complete mock-only iPhone acceptance on an isolated expiring surface after explicit approval.
5. Complete production readiness, backup, monitoring, stable HTTPS, and rollback verification before any VPS promotion.

Operator-only actions include spending/budget changes, credential provisioning, GitHub authorization, device acceptance, real Telegram connection, production/DNS/provider/host-security changes, approval-policy changes, emergency-control changes, trading, and funds actions.

## Rollback and recovery

- Preserve commits; use reviewed `git revert`, never reset or history rewriting, for shared-history rollback.
- Use tested backup/restore commands only against an explicitly identified stopped local/disposable database.
- Disposable iPhone state and tunnel must be stopped and deleted without touching durable VPS state.
- Recovery begins with `git fetch`, worktree/branch/status inspection, this file, then affected code/evidence. Never copy production state into Codespaces or tests.
