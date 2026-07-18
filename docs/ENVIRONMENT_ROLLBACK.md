# Environment Rollback

## Disposable test

Run `npm run stop:iphone-test`. It terminates recorded test processes, removes the exact temporary tunnel container, deletes disposable runtime/authentication/SQLite state, and checks that the test health endpoint is unavailable. The durable VPS runtime is not a teardown target.

## Codespace

Stop the disposable process first, verify no required work exists only inside the Codespace, then stop or delete it through the approved GitHub wrapper. Repository recovery comes from reviewed Git history; production recovery never comes from Codespace state.

## Production

Stop writers, preserve evidence, and identify whether failure is code, configuration, or schema. Prefer a reviewed `git revert` over reset/history rewriting. Restore only a verified backup to the single designated production database owner, run health/policy checks, and resume supervision. Never create a second canonical database or replay temporary queues into production.

Rollback does not authorize deployment, credentials, DNS, host-security changes, real Telegram, paid calls, trading, or funds movement.
