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
| Authority | Telegram deployment, merge, repository creation, secret, host-security, budget, emergency-control, constitutional, and trading/funds requests were denied. |
| Channel binding | A different Telegram chat could not attach to a Jarvis-only conversation. |
| Network | A fixture-level fetch guard rejected non-loopback destinations; recorded external attempts remained empty. |
| Cleanup | API closed, database handle closed, fetch restored, and the entire temporary root was removed and checked absent. |

The expected Node experimental SQLite warning was the only runtime warning.
