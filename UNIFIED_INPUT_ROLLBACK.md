# Unified Input Validation Rollback

## Code rollback

This work is **published**, not local-only. An earlier revision of this document
claimed the changes "will be contained in one local commit"; that was incorrect
and is corrected here against the observed repository state.

Actual published range, verified from the repository:

- Remote branch: `origin/feature/unified-input-foundation`
- Published head: `7dbe07fb9faa0d2382442f39b747125db09e2761`
- Merge base with `origin/main`: `029e38add2157d5b7caefb3a6c5d85e9270f80f2`
- Published range: `029e38a..7dbe07f` — 25 commits, `ahead=25 behind=0`
- The remote-ref reflog records two pushes: `2ab3394`, then `7dbe07f`

Because the range is published, rollback is `git revert` only. Do not reset,
rebase, or force-push the published range. To roll back the whole range after
reviewing the exact targets, revert the range without committing
(`git revert --no-commit 029e38a..7dbe07f`) and review before committing; to roll
back a single change, revert that one commit.

The earlier foundation commits inside this range are:

- `2d2a9150f9609e8664fb04cc5d028e563b1fef61`
- `dddfb1bdbe48765753a0c37cf1c794e006578e55`

Reverting the validation commit removes the cancellation-token lifecycle, bounded outbox behavior, explicit repository-creation restriction, E2E fixture, and these validation documents while preserving the recovered foundation.

## Vercel deployment state — UNVERIFIED

A canceled Vercel deployment state was reported for this range but **could not be
confirmed from this host**. No repository evidence records a canceled deployment,
and there is no authenticated Vercel session or approved token available here, so
neither the deployment list nor the Ignored Build Step could be read back.

What is verified: the branch is pushed, and GitHub deployment records show both
the `blackspire-helix-group` and `frontend` Vercel projects create previews for
non-main refs. Whether those previews were canceled, skipped, or built for
`029e38a..7dbe07f` remains `UNVERIFIED`. An authorized operator must read the
state back from Vercel before this section is treated as settled. Do not record a
canceled state here on the strength of a handoff summary alone.

## Data rollback

No persistent validation data exists: the E2E database, WAL/SHM files, temporary repository, and API process are destroyed during teardown. No production database was opened or migrated.

Existing schema remains additive. If foundation tables ever need removal, stop all local API/worker processes, take the normal SQLite backup, and use a separately reviewed destructive migration. Do not manually delete tables from a live or production database.

## Operational rollback

No Telegram bot, provider, external service, Vercel project, DNS record, deployment, host control, or trading system was changed, so no external rollback is required.
