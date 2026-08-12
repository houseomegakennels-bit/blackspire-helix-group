# Health-transition audit and operator diagnostics

Status: **tested with disposable fixtures; intentionally not registered on a live HTTP server**.

This package depends on PR #87 for worker/runtime readiness and on PR #74 for the bounded,
provider-neutral monitoring contract. Those PRs form parallel prerequisites rather than a linear
stack. The package emits no alert, performs no rollback, changes no deployment, and makes no
external request.

## Contract

The fixed state vocabulary is `starting`, `healthy`, `ready`, `degraded`, `unavailable`,
`disabled`, `draining`, `halted`, `recovering`, `stale`, `migration_mismatch`,
`dependency_failure`, and `unknown`. Component, reason, source, environment, workspace,
correlation, build, dependency, and metadata values are bounded and validated. Metadata uses an
allowlist and secret-like values are redacted.

Observations are environment- and workspace-scoped. Older observations and same-timestamp
conflicts are rejected. Exact duplicates are suppressed; newer observations that do not change
state refresh current state without appending history. Four state changes inside five minutes mark
a component as flapping. Recommendation values are `none`, `observe`, `investigate`,
`rollback_recommended`, and `operator_intervention_required`; they are advice only.

The diagnostics handler defaults to the existing `runtime.read` authorization decision. It is
GET-only in intent, accepts explicit environment and workspace scope, caps pages at 100, validates
checksummed cursors, orders events deterministically, and returns bounded fields suitable for a
mobile formatter. The cursor checksum is unkeyed: it detects truncation and corruption, it is not
a signature and is not tamper-proof. Nothing relies on it for privilege — a cursor only offsets
within a workspace scope the caller has already been authorized for.

## Known limitations and blocked integration

- Durable SQLite event storage is blocked while Claude's active M3/schema lane changes the shared
  migration and schema-validation files. The current adapter supports validated snapshot export
  and restart recovery for tests but is not a durable production store.
- HTTP route registration is blocked because the active M3 review-queue branch changes
  `apps/api/server.js`. The authorization-aware handler is complete and directly tested; it must be
  registered only after that ancestry settles.
- The Command scheduler does not exist. Its status is explicitly `disabled` with reason
  `unsupported`; no scheduler heartbeat is fabricated.
- PR #74's alert hook remains disabled/operator-owned. No automatic alert delivery is added here.
- RPO/RTO and production alert thresholds remain operator decisions.
- `TELEGRAM_MODE=mock` is deliberately classified differently by the two consumers, and the lists
  are intentionally NOT shared. This package counts `mock` as sandboxed, because
  `apps/telegram/bot.js` returns a fixture without reaching the API, so reporting it as a live
  transport would be false. The release gate in `packages/shared/post-deploy-verifier.js` accepts
  only `disabled|sandbox|dry-run` and treats `mock` as `telegram_not_sandboxed`. The gate is the
  stricter of the two by design: an observation describes what is running, a gate decides what may
  ship, and widening the gate to match this list would weaken a deployment safety check. An
  operator reading diagnostics under `mock` therefore sees a sandboxed transport while the deploy
  gate still blocks; that divergence is intended, not drift.

## Verification

Use Node.js 22.23.1. The focused entry points are:

```bash
node --test tests/health-transitions.test.js tests/health-transition-mutation.test.js
node --test tests/api-readiness-lifecycle.test.js tests/worker-graceful-drain.test.js
```

All fixtures are local and disposable. Do not provide production credentials or enable providers.
