# Unified Input Validation Evidence

## Canonical identifiers

- Conversation: `conv_441af8846f93024e`
- Telegram-created task: `task_21c3cf092cc0c7e1`
- Jarvis-created task in the same conversation: `task_d0b683d745c68e6d`

These identifiers came from disposable SQLite state and are retained only as validation evidence. The database was deleted after the run.

## Assertions

| Boundary | Evidence |
|---|---|
| Canonical sharing | Telegram and Jarvis resolved to the same conversation; the first two ordered tasks matched the captured IDs. |
| Idempotency | Replayed Telegram update was ignored; repeated Jarvis idempotency key returned the original task with `duplicate: true`. |
| Provider policy | Allowed work recorded one `mock`/`mock` attempt; denied, missing-workspace, and zero-budget requests recorded no provider attempts. |
| Emergency stop | Unified intake returned status 423 while the persisted emergency-stop flag was active. |
| Cancellation | Audit recorded `cancellation_requested`; the mock token ran once; cleanup evidence and events were stored; final state was `cancelled`; sanitized Telegram delivery was generated. |
| Outbox | Mock transport failed twice, reached configured terminal `failed` status with two attempts, remained visible through Jarvis, and did not change the queued task. |
| Redaction | The secret-shaped fixture was absent from API-visible shared state, events, outbox errors, logs, and evidence. |
| Authority | Telegram deployment, merge, repository creation/deletion/visibility, secret, host-security, budget, emergency-control, constitutional, and trading/funds requests were denied before dispatch. Repository wording, casing, punctuation, replay, untrusted Jarvis/API, test authority, and unknown protected-resource mutations were covered. |
| Repository policy regression | “Create a new repository” and four natural-language variants returned the canonical forbidden result; tasks began and remained `failed`, recorded only sanitized `policy.denied`, produced no success/completion outbox event, and recorded zero worker claims, approvals, provider attempts, usage, commands, or changed files. |
| Channel binding | A different Telegram chat could not attach to a Jarvis-only conversation. |
| Network | A fixture-level fetch guard rejected non-loopback destinations; recorded external attempts remained empty. |
| Cleanup | API closed, database handle closed, fetch restored, and the entire temporary root was removed and checked absent. |

The policy fix passed 7 focused classifier/authority tests, 35 focused Unified/iPhone/Telegram tests, and 139 full repository tests with zero failures or skips under Node 22.23.1. Build, lint, typecheck, secret scan, living-memory, and whitespace gates passed. The expected Node experimental SQLite warning was the only runtime warning.
