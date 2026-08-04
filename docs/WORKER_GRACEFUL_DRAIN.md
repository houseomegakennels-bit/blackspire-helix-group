# Worker Graceful Drain

Status: implemented in a stacked draft branch; not independently reviewed, merged, deployed, or activated.

## Contract

The worker controller owns at most one active tick. Once stop begins it clears polling and refuses
new claims, then waits for the active task and its post-task Telegram outbox delivery flush. Normal
SIGTERM/SIGINT receives a fixed thirty-second drain ceiling. Completion closes SQLite and exits zero.

If the deadline expires, the entry-point worker logs only a sanitized `drain_timeout`, closes SQLite,
and exits nonzero so the supervisor's bounded restart policy applies. A claimed task may remain
`running`; the existing heartbeat/stale-claim recovery is the recovery authority. This slice does not
invent a second task-state transition or mark an incompletely executed task successful. A second
signal exits nonzero immediately.

The injected claim/process/delivery functions exist only to exercise timing deterministically. The
production defaults remain the canonical task engine, Hermes processor, and Telegram outbox drain.

## Limitations

- The fixed deadline is not dynamically configurable.
- Provider cancellation is unchanged; deadline expiry terminates the worker process.
- Delivery flush shares the same overall drain deadline as task completion.
- The supervisor still treats API and worker as one service and stops the sibling if either exits.

## Rollback

Use a reviewed `git revert`. No schema or data rollback is required. After rollback SIGTERM returns
to immediate default worker termination; stale-task recovery remains the only recovery path. Do not
restart or deploy a live service without separate production authority.
