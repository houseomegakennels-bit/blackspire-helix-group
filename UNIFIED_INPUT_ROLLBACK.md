# Unified Input Validation Rollback

## Code rollback

The validation changes are additive and will be contained in one local commit. To roll them back after reviewing the exact target, use `git revert <validation-fix-commit>`; do not reset or rewrite the recovered implementation commits.

The earlier foundation commits are:

- `2d2a9150f9609e8664fb04cc5d028e563b1fef61`
- `dddfb1bdbe48765753a0c37cf1c794e006578e55`

Reverting the validation commit removes the cancellation-token lifecycle, bounded outbox behavior, explicit repository-creation restriction, E2E fixture, and these validation documents while preserving the recovered foundation.

## Data rollback

No persistent validation data exists: the E2E database, WAL/SHM files, temporary repository, and API process are destroyed during teardown. No production database was opened or migrated.

Existing schema remains additive. If foundation tables ever need removal, stop all local API/worker processes, take the normal SQLite backup, and use a separately reviewed destructive migration. Do not manually delete tables from a live or production database.

## Operational rollback

No Telegram bot, provider, external service, Vercel project, DNS record, deployment, host control, or trading system was changed, so no external rollback is required.
