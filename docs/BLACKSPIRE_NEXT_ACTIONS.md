# Blackspire Next Actions

## Immediate safe actions

1. Independently re-review the immutable-release repair: its shared create/preflight/switch/rollback validator must preserve the reviewed `root:blackspire` read/execute-only tree, reject dangling/looping/out-of-tree symlinks and symlinked ancestors, allow only canonical in-tree links, preserve active state on failure, omit only safe review/development artifact metadata, and keep safe incomplete-artifact cleanup.
2. After that repair is merged, rebuild the immutable restricted staging release from main without touching production, then repeat the complete disposable-only Gate 3 backup, restore, WAL-safety, migration, and disabled-backup-routine rehearsal.
3. Do not request Gate 4 production activation until Gate 3 passes with sanitized evidence.
4. Preserve the four original commits and backup branch; do not rewrite them or the integration merge.
5. Keep all validation credential-free and mock-only until explicit authority changes.
6. Preserve the completed operator iPhone acceptance and teardown evidence; restage only for an explicitly approved new acceptance need.
7. When included Codespaces usage renews, inspect the designated existing Codespace before any creation request; do not enable billing.
8. Before production Command promotion, apply and verify the immutable release, WAL-safe backup/restore, no-provider profile, monitoring/log-retention, stable HTTPS, and rollback procedures documented in `docs/VPS_RUNTIME_RUNBOOK.md`; current VPS application remains unpromoted.
9. Preserve the completed restricted subscription Codex acceptance. Any new live Codex task requires a separately scoped approval; do not switch to API-key billing or another provider.
10. PR #26 readiness tooling is merged into `main` (`a9602496`). Do not deploy or activate any release until the six host-side blockers are closed and a separate bounded production approval is given. The prepared `ops/` proxy/TLS and runtime-ownership plans are review artifacts only — do not install or apply them.

## Operator-only actions

Push/merge authorization, budgets/spend, credentials, GitHub authorization, device acceptance, production and DNS changes, real Telegram, paid/live providers, host security, emergency controls, constitutional changes, trading, and funds movement.

## Blocked or deferred

- New Codespace creation: blocked by usage credit.
- Real Telegram and live providers: not authorized.
- Production Command launch: readiness incomplete and live state `UNVERIFIED`.
- PR #26: repository-side readiness tooling is merged into `main`, but host-side production approval remains blocked by six items, each separately authorized: (1) reverse proxy/TLS install and verification, (2) least-privileged non-root runtime ownership provisioning, (3) installed monitoring/log rotation with alert-delivery testing, (4) approved production backup/migration rehearsal or execution, (5) recorded exact known-good live release/database rollback target, and (6) readiness tooling in the deployment artifact.
- Multi-instance/serverless Command persistence: requires architecture work beyond SQLite.
