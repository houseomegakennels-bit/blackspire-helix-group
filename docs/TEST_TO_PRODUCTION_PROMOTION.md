# Test-to-Production Promotion

Passing a disposable test does not promote its database, credentials, queue, URL, or task history. Promote reviewed repository code and migration contracts only.

1. Finish credential-free acceptance with disposable SQLite, mock Hermes, mock Telegram, and test-only authentication.
2. Stop the surface and prove its state, authentication data, process, and URL are gone.
3. Review and locally commit the exact source; pass tests, build, lint, typecheck, secret scan, dependency audit, and whitespace checks.
4. Obtain separate approval before push, PR, merge, DNS, deployment, provider credentials, real Telegram, or production migration.
5. Back up the sole production database and prove restore on an isolated target.
6. Validate the production profile, migrate once under a controlled writer outage, start under supervision, and verify stable authenticated HTTPS/monitoring.
7. Exercise policy, budgets, emergency stop, cancellation, outbox retry, and Telegram restrictions without using live funds or trading.

Never seed production from a Codespace/test database or run simultaneous canonical writers. If any production-only precondition is absent, remain in test mode.
