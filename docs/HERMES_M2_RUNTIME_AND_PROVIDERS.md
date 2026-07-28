# Hermes Milestone 2 — Runtime & Provider Framework

Development-only real-provider runtime built additively on Milestone 1. **Mock stays the default;
real execution is disabled by default, development-only, and refused under the production profile.**
No provider is production-eligible. No automatic memory promotion. No Telegram/voice.

## Status legend (per the milestone requirement)

| State | Meaning |
| --- | --- |
| **Implemented** | code present and unit/integration tested |
| **Tested with fixtures** | exercised only via the deterministic fake provider (no paid calls) |
| **Available only in development** | reachable solely under the development profile + flags |
| **Awaiting live smoke test** | a real credentialed call has not been run; `scripts/hermes-dev-smoke.js` is prepared but disabled |
| **Deferred to M3** | intentionally not built yet |
| **Prohibited in production** | structurally refused under the production profile |

## What this milestone adds

- **Runtime profile gate** (`runtime-profile.js`) — resolves `development`/`test`/`production`; real execution requires development profile **and** `HERMES_DEV_REAL_PROVIDER=true` **and** the provider on `HERMES_DEV_PROVIDER_ALLOWLIST`, a registered workspace root on `HERMES_DEV_WORKSPACE_ALLOWLIST`, and a bounded operator-declared real-call spend reservation. *Implemented.*
- **Typed provider/capability registries** (`registries.js`) — full provider fields (adapter type, enabled, allowed environments, capabilities, health, auth state, concurrency/timeout/retry, usage/cost limits, production eligibility). Capability resolution is registry-driven, not hardcoded. *Implemented.*
- **Anthropic (non-agentic Claude) adapter** (`adapters/anthropic-dev.js`) — pure Messages-API text-in/JSON-out. No shell/file/agentic surface. Disabled by default; dev-only; refused in production even with a key; independently refuses direct use without the task-derived spend envelope. *Implemented; tested with fixtures; awaiting live smoke test.*
- **Deterministic fake provider** (`adapters/fake-provider.js`) — the test substrate; no paid calls. *Implemented.*
- **Execution flow** (`execute.js`, `orchestrator.js`) — mock default; gated real path; timeout, cancellation, retry ceiling, concurrency limit, size limits, budget/cost ceiling, and kill-switch recheck before every dispatch; **no silent real→mock fallback**; execution mode reported as `real | mock | blocked | cancelled | failed`. *Implemented.*
- **Scoped approvals** (`approvals.js`) — task-scoped, single-use, expiring, and atomically consumed immediately before the first dispatch (after health/concurrency/cancellation refusal checks); medium-risk tasks require one; high-risk/protected remain blocked. *Implemented.*
- **Provider health + cooldown** (`health.js`) — success/failure/cooldown transitions; a requested real provider in cooldown is blocked (never silently mocked). *Implemented.*
- **Usage/cost recording** (`store.js`, `hermes_provider_invocations`) — provider/model/mode/timing/attempts/tokens/cost/timeout/cancel/verification; **null when the provider doesn't report** (no invented numbers). *Implemented.*
- **Read-only status surface** — `GET /api/hermes/runtime` (authenticated) and `/hermes-runtime` PWA page: profile, providers, enabled/health/capabilities, auth **configured/not** (boolean only), recent runs/invocations, kill switch. Never exposes credentials, prompts, or unredacted output. *Implemented.*

## Provider setup guide (development only)

1. Obtain an Anthropic API key and supply it through the approved environment/secret mechanism as `ANTHROPIC_API_KEY`. **Never** put it in source, fixtures, argv, logs, or the database. (It is also forbidden by the production `verify-environment` profile.)
2. Enable the development real path:
   ```sh
   export HERMES_RUNTIME_PROFILE=development
   export HERMES_DEV_REAL_PROVIDER=true
   export HERMES_DEV_PROVIDER_ALLOWLIST=anthropic
   export HERMES_DEV_WORKSPACE_ALLOWLIST=/abs/path/to/dev/checkout
   export HERMES_DEV_ANTHROPIC_MAX_COST_CENTS=<positive-integer-within-task-and-provider-cap>
   ```
3. Submit a task with `requestedProvider: 'anthropic'`. Without the request, tasks stay on the mock path.

## Development runtime guide

- Mock is the default execution path; existing tests/workflows are unaffected.
- A task reaches the real path only when it explicitly requests a real provider **and** every gate passes; otherwise it is **blocked** (never silently mocked). The workspace is resolved from the registered workspace record, never from a task-supplied path.
- Anthropic does not return invoice-grade cost in this adapter. Before any real dispatch, `HERMES_DEV_ANTHROPIC_MAX_COST_CENTS` must reserve a positive worst-case amount no greater than both the task budget and provider cap. The actual recorded cost remains `null` when the provider does not report it; no number is invented.
- Medium-risk tasks require a scoped, single-use approval (`grantApproval`); high-risk/protected/deploy/secret/destructive/financial/identity actions remain blocked before any provider call.
- Kill switch: `system_flags.emergency_stop=active` refuses all new orchestration and is rechecked before every provider attempt/retry.

## Security model (summary)

- **No execution surface on the real adapter**: pure HTTPS text; no shell, file, or agent tools, so command/path/symlink/workspace-escape do not apply to execution. Workspace allowlist is enforced for any workspace-scoped real work.
- **Credential hygiene**: key read from env, sent only as an HTTP header; never printed, argv, logged, persisted, or surfaced. Status reports a boolean.
- **Fail-closed gates**: production refusal, dev flag, provider allowlist, cooldown, concurrency, budget/cost ceiling, timeout, cancellation, retry ceiling.
- **Redaction**: recursive (strings/arrays/objects/Errors/bigint/cyclic) + bearer/AWS/Authorization/PEM, applied before any persistence or status exposure.
- **Learning integrity**: candidates only from verified runs, always `pending`, never auto-promoted; verifier gates completion.
- **Approvals**: single-use, scoped, expiring, fail-closed; no blanket approval.

See `HERMES_INTELLIGENCE_LAYER_ARCHITECTURE.md` for the full threat table.

## Live smoke test (prepared, NOT run)

`scripts/hermes-dev-smoke.js` runs one tightly-bounded live development call. It **refuses** unless `HERMES_SMOKE_CONFIRM=i-understand-this-makes-a-paid-call` plus the development gates and a disposable DB path are set, and never runs under production. It is not wired into CI. **Awaiting explicit operator approval before any paid/credentialed call.**

## Rollback

Additive and reversible. To roll back M2: revert this branch/PR. The `hermes_provider_invocations`, `hermes_provider_health`, and `hermes_approvals` tables are additive and unused by other code; leave them or drop them. Delete `packages/hermes-orchestrator/{runtime-profile,health,approvals,concurrency,status}.js` and `packages/hermes-orchestrator/adapters/`, and revert the touched files. No production state, config, release, or symlink is involved.

## Deferred to Milestone 3

Multi-provider autonomous/learned routing, scorecard-driven selection, approval-gated memory promotion, cross-host concurrency/rate limiting, provider pricing→cost derivation, and live production approval execution.
