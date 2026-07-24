# Blackspire Next Actions

## Immediate safe actions

1. PR #35 is MERGED into `origin/main` (`693fb03e4596d26e990f87a40508307810cc5e5d`): absolute Node interpreter pinning across production startup, systemd unit Environment=BLACKSPIRE_NODE_BIN, host-interpreter verification, and strict production preflight.
2. PR #36's correction commit is local on `pr36-final-corrections-7a4fbc81` (not pushed). A later correction session reran the previously blocked production-bind, full-suite, build/lint/typecheck/security-scan/audit, and source-preflight gates in a launcher that permits loopback listeners and nested Node subprocesses; all passed. Before/after read-only host comparison and the strict-host `installed-unit` deployment check still require the actual production host and remain separate. Push the branch, then run the post-push procedure in `docs/PR36_CORRECTION_EVIDENCE.md` against the exact pushed head, then obtain a fresh independent read-only review before marking ready or merging.
3. Obtain a fresh eligible independent read-only review of draft PR #29 at its reconciliation merge head before any merge: its shared immutable-release validator must preserve the reviewed runtime ownership/mode contract, reject unsafe links, preserve active state on failure, and remain source-only until separately authorized staging work. Keep it draft; do not mark ready or merge until that review passes.
4. Preserve the verified root-Vercel boundary: the VPS-owned root project must be ignored on every ref while the `frontend` project remains independently deployable. PR #29 and PR #30 exact-head root contexts pass via repository configuration; no external Vercel setting needs mutation.
5. After PR #29 is merged and a separately authorized immutable staging rebuild occurs, repeat the complete disposable-only Gate 3 backup, restore, WAL-safety, migration, and disabled-backup-routine rehearsal.
6. Do not request Gate 4 production activation until Gate 3 passes with sanitized evidence.
7. Preserve the four original commits and backup branch; do not rewrite them or the integration merge.
8. Keep all validation credential-free and mock-only until explicit authority changes.
9. Preserve the completed operator iPhone acceptance and teardown evidence; restage only for an explicitly approved new acceptance need.
10. When included Codespaces usage renews, inspect the designated existing Codespace before any creation request; do not enable billing.
11. Before production Command promotion, apply and verify the immutable release, WAL-safe backup/restore, no-provider profile, monitoring/log-retention, stable HTTPS, and rollback procedures documented in `docs/VPS_RUNTIME_RUNBOOK.md`; current VPS application remains unpromoted.
12. Preserve the completed restricted subscription Codex acceptance. Any new live Codex task requires a separately scoped approval; do not switch to API-key billing or another provider.
13. PR #26 readiness tooling is merged into `main` (`a9602496`). Do not deploy or activate any release until the six host-side blockers are closed and a separate bounded production approval is given. The prepared `ops/` proxy/TLS and runtime-ownership plans are review artifacts only — do not install or apply them.
14. Obtain a fresh independent read-only review of the draft production loopback-bind PR at its exact remote head before any merge: it must confirm `BIND_HOST` reaches `server.listen`, that public/wildcard production binds and implicit port fallback are rejected, that ports 8787 and 8788 stay protected, and that no running service changed. Keep it draft; do not mark ready or merge until that review passes.
15. Separate pre-existing follow-up (not part of PR #32): `tests/trust-boundary-regression.test.js` is intermittently flaky at the pathname-replacement case, lines 37-40 of the test `immutable test identity detects content mutation and pathname replacement`. The file is unlinked and rewritten with byte-identical content, and the test asserts `verifyTestTreeUnchanged` throws. `descriptorIdentity` in `scripts/test-inventory.js` records `{dev, ino, mode, nlink, size, mtimeMs, ctimeMs, sha256}`, so when the filesystem reuses the freed inode and the rewrite lands within the same coarse timestamp tick, every recorded field is identical and no replacement is detected. The independent reviewer reproduced this against `origin/main`; 25 isolated repetitions on the correction host did not reproduce it, so it is load- and filesystem-dependent, not deterministic. The relevant test and implementation are byte-identical to `origin/main`, so this is pre-existing and unrelated to the bind/port work. Recommended repair: give each capture an explicit generation marker independent of inode and timestamp reuse, or force a timestamp advance past filesystem granularity before the rewrite. Do not fold this into PR #32 and do not claim it repaired.
16. Do not activate production on the selected port `8789` until that review passes, Gate 3 passes, and a separate bounded production approval is given. `BIND_HOST=127.0.0.1` and an explicit `PORT` must be present in the operator-supplied environment file; there is no default.

## Operator-only actions

Push/merge authorization, budgets/spend, credentials, GitHub authorization, device acceptance, production and DNS changes, real Telegram, paid/live providers, host security, emergency controls, constitutional changes, trading, and funds movement.

## Blocked or deferred

- New Codespace creation: blocked by usage credit.
- Real Telegram and live providers: not authorized.
- Production Command launch: readiness incomplete and live state `UNVERIFIED`.
- PR #26: repository-side readiness tooling is merged into `main`, but host-side production approval remains blocked by six items, each separately authorized: (1) reverse proxy/TLS install and verification, (2) least-privileged non-root runtime ownership provisioning, (3) installed monitoring/log rotation with alert-delivery testing, (4) approved production backup/migration rehearsal or execution, (5) recorded exact known-good live release/database rollback target, and (6) readiness tooling in the deployment artifact.
- Multi-instance/serverless Command persistence: requires architecture work beyond SQLite.
