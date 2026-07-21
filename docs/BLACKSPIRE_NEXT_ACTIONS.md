# Blackspire Next Actions

## Immediate safe actions

1. Preserve the four original commits and backup branch; do not rewrite them or the integration merge.
2. Keep all validation credential-free and mock-only until explicit authority changes.
3. Preserve the completed operator iPhone acceptance and teardown evidence; restage only for an explicitly approved new acceptance need.
4. When included Codespaces usage renews, inspect the designated existing Codespace before any creation request; do not enable billing.
5. Before production Command promotion, apply and verify the immutable release, WAL-safe backup/restore, no-provider profile, monitoring/log-retention, stable HTTPS, and rollback procedures documented in `docs/VPS_RUNTIME_RUNBOOK.md`; current VPS application remains unpromoted.
6. Preserve the completed restricted subscription Codex acceptance. Any new live Codex task requires a separately scoped approval; do not switch to API-key billing or another provider.
7. PR #26 readiness tooling is merged into `main` (`a9602496`). Do not deploy or activate any release until the six host-side blockers are closed and a separate bounded production approval is given. The prepared `ops/` proxy/TLS and runtime-ownership plans are review artifacts only — do not install or apply them.

## Operator-only actions

Push/merge authorization, budgets/spend, credentials, GitHub authorization, device acceptance, production and DNS changes, real Telegram, paid/live providers, host security, emergency controls, constitutional changes, trading, and funds movement.

## Blocked or deferred

- New Codespace creation: blocked by usage credit.
- Real Telegram and live providers: not authorized.
- Production Command launch: readiness incomplete and live state `UNVERIFIED`.
- PR #26: repository-side readiness tooling is merged into `main`, but host-side production approval remains blocked by six items, each separately authorized: (1) reverse proxy/TLS install and verification, (2) least-privileged non-root runtime ownership provisioning, (3) installed monitoring/log rotation with alert-delivery testing, (4) approved production backup/migration rehearsal or execution, (5) recorded exact known-good live release/database rollback target, and (6) readiness tooling in the deployment artifact.
- Multi-instance/serverless Command persistence: requires architecture work beyond SQLite.
