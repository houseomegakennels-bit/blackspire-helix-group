# Unified Jarvis Test Build Rollback

## Code

Use `git revert <test-build-commit>` after verifying the exact local commit. Do not reset or rewrite the recovered foundation commits. The change is additive: one test-mode module, launcher, mobile page, tests, guarded routes, and documentation.

## Runtime

Stop the launcher. Its signal handler stops the worker and API, closes SQLite, and recursively removes only the launcher-created temporary data directory. Delete the private Codespace after confirming the process is stopped.

## External state

No production Vercel project, domain, DNS record, Telegram bot, provider, database, host control, repository branch, PR, merge, trading system, or funds system is modified, so no production rollback is required.

The recovered implementation is anchored by foundation commits `2d2a915` and `dddfb1b`, validation commit `875a78e`, and local iPhone test-build commit `dccb391`. Prefer reviewed `git revert` operations for code rollback; do not reset or rewrite the recovered branch.
