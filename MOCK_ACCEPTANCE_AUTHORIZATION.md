# Bounded Mock Acceptance Authorization

How a synthetic Jarvis task is allowed to reach canonical completion against the
mock provider in a credential-free acceptance environment — and why that path
cannot leak into production.

## Problem it closes

The merged Jarvis system had no *safe* way to drive a harmless command to
`completed` without a real provider credential. The production-contract path
(`runTask`) selects real providers and, on success, edits the workspace,
commits, and opens a PR — so it can neither run credential-free nor stay
read-only. Separately, the existing read-only test adapter
(`processReadOnlyTestTask`) was entered on the bare `UNIFIED_IPHONE_TEST_MODE`
environment flag alone: a task in *any* workspace (including the real
`blackspire-command` workspace, `rootPath: .`) would complete through it while
that flag was set. The authorization was correct in intent but too broad.

## Design

The safe completing path is the pre-existing read-only adapter, not a new
provider exception. `processReadOnlyTestTask` forces `allowedProviders: ['mock']`,
selects the mock provider/mock model, performs no edits/commit/PR
(`changedFiles: []`, `readOnly: true`), and is bounded by the same
`guardDispatch` policy, budget, cancellation, and duplicate-replay checks as the
real path. It is safer than authorizing `mock` inside `runTask` because it never
reaches the workspace-mutating stages at all.

The fix narrows *entry* into that adapter to a single canonical authorization,
`authorizeReadOnlyTestTask(workspace, env)` in
`packages/shared/testMode.js`, consumed by `packages/hermes/hermes.js`. The
adapter is entered only when **every** condition below is derived and verified
from canonical backend state:

1. Test mode is enabled — `UNIFIED_IPHONE_TEST_MODE === 'true'`.
2. The canonical test-mode config is fully valid (`testModeConfig().ok`):
   `NODE_ENV=test`, mock Hermes, mock Telegram, a one-time access code, an expiry
   within four hours, a disposable database path, and **no** real provider
   credential present in the environment.
3. The task's workspace **is** the designated synthetic test workspace
   (`workspace.id === config.workspaceId`, default `iphone-test`).
4. That workspace's provider policy permits the mock provider **only**
   (`provider_policy.preferred === ['mock']`).
5. Mock Hermes is the configured provider and mode
   (`HERMES_TEST_PROVIDER=mock`, `BLACKSPIRE_HERMES_MODE=mock`).
6. The runtime is not production (`BLACKSPIRE_RUNTIME_MODE !== 'production'`).

If test mode is signalled but any condition fails, the task **fails closed**
with a recorded `mock_acceptance_denied` evidence entry — it never falls through
to the real provider pipeline and never mutates a workspace.

Nothing here is trusted from the request or a frontend flag: the workspace
identity, provider policy, and test-mode validity are all read from canonical
backend state. `/api/unified-input` additionally forces the workspace to the
designated test workspace under test mode, so a request cannot even name a
different one.

## Why production stays protected

- Production runs with `UNIFIED_IPHONE_TEST_MODE` unset, so the gate is never
  entered and behavior is unchanged (deny-by-default for `mock` via
  `allowedProviders`/`dispatchGuard`).
- Condition 6 explicitly refuses the path when `BLACKSPIRE_RUNTIME_MODE=production`.
- The presence of any real provider credential (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `CODEX_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`, Telegram
  tokens) invalidates `testModeConfig().ok`, so a credential-bearing environment
  cannot use the exception.
- The canonical Blackspire policy engine remains the final authority: prohibited
  and privileged requests are still denied at ingress before this gate.

## Why no real provider can use the exception

The adapter hard-codes `allowedProviders: ['mock']` and selects the mock
provider; `guardDispatch`/`providerConfiguration` reject any non-mock provider,
and paid providers are forbidden outside production regardless. There is no
fallback provider, no network call, no tool execution, and no repository
mutation.

## Rollback

Revert the two source edits and delete the test:

```bash
git -C /tmp/blackspire-unified-input revert --no-edit <this commit>
# or, before it is built upon:
git -C /tmp/blackspire-unified-input checkout 13e83c5 -- \
  packages/hermes/hermes.js packages/shared/testMode.js
rm tests/mock-acceptance-authorization.test.js
```

Reverting restores the prior behavior (adapter entered on the bare env flag).
No data migration, schema change, or production change is involved.

## Acceptance result

In an isolated credential-free TEST_MODE environment (temporary Node 22,
disposable SQLite, mock Hermes, mock provider, mock Telegram, no API keys), a
harmless `status check` submitted through `/api/unified-input` — the same
endpoint the merged console uses — reaches canonical `completed` with mock
attribution (`provider: mock`, `model: mock-hermes-status-v1`, `changedFiles: []`).
A task in a non-designated workspace fails closed with no provider invocation.
Prohibited requests are denied at ingress. Replay adds no second provider call.
A cancelled task is not resurrected. See
`tests/mock-acceptance-authorization.test.js` (17 cases).

## Remaining limitations

- Completion is read-only by design: the acceptance path reports mock status; it
  does not exercise real edit/commit/PR stages (those require a real provider and
  are out of scope for credential-free acceptance).
- The merged production-contract `index.html` console is served only when test
  mode is **off**; under test mode the backend still serves `test-mode.html`.
  This change authorizes and proves *task completion* in test mode; it does not
  change which HTML is served (no frontend behavior change), so the existing
  real-device visual acceptance of `index.html` still stands unmodified.
