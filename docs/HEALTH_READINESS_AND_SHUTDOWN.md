# Health, Readiness, and API Shutdown

Status: implemented in a draft branch; not independently reviewed, merged, deployed, or activated.

## Probe contracts

`GET /health` is process liveness and always returns HTTP 200 while the HTTP process can respond.
It reports the lifecycle phase, database availability, emergency-stop state, and sanitized Telegram
mode. A database read failure does not turn liveness into readiness: it reports
`database=unavailable` and conservatively reports the emergency stop active.

`GET /ready` is traffic readiness. It returns HTTP 200 only after the listener is ready and while
the database schema is compatible and the startup configuration passed validation. Startup,
draining, stopped, database failure/incompatibility, or unsafe configuration returns HTTP 503.
Dependency error text and filesystem paths are not exposed. Provider modes remain informational and
do not make an intentionally provider-disabled deployment unready.

Both endpoints remain public and contain no credentials. The durable monitoring helper checks both
over the explicit loopback target; `/health` alone must not be treated as permission to route work.

## Graceful API shutdown

The entry-point API handles SIGTERM and SIGINT by immediately entering `draining`, which makes
readiness false, and closing the listener. Existing connections receive up to ten seconds to finish.
At the deadline remaining connections are destroyed, SQLite is closed, and the process exits. A
second signal accelerates connection closure. Imported test/staging servers do not install process
signal handlers; they may invoke the exported shutdown helper explicitly.

This slice does not claim graceful worker task drain. The production supervisor already forwards
termination to both children, but worker in-flight semantics remain a separate hardening milestone.

## Rollback

Use a reviewed `git revert`. The prior release returns to shallow readiness and default Node signal
termination. No schema or data rollback is required. Do not change live routing or restart a service
without separate production authority.
