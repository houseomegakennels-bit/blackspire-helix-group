# Blackspire Canonical Source of Truth



## 2026-09-21 — denial session issuance uses installed runtime authority

The root denial-session CLI now observes the installed v4 writer profile instead of treating the root activation recipe as an API credential configuration. Clean release-checkout callers retain exact source verification; candidate and merged-main callers may execute only from their fixed sealed release artifact, with an independently verified deployed artifact digest. A shared HELD admission lease spans profile/generation re-observation and actual session issuance. The obsolete configurationFile input is refused. Existing canonical operator/database, no-grant principal, bounded session, durable receipt and targeted revocation checks remain in force; revocation still works with stopped services or a newer release.

Twelve focused tests pass in a readable disposable validation copy, including real installed-v4 manifest/profile composition with actual SQLite session issuance for candidate and new-main identities, artifact/source/generation refusal, API denial, receipt validation, rotation and non-root CLI refusal. Root build, lint and syntax/typecheck pass. Production issuance remains UNVERIFIED pending independent review. No production mutation or push occurred.
