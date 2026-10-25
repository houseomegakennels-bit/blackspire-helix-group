# Local luxury workspace candidate — 2026-10-25

Status: local implementation only; publication held. Branch `feat/luxury-reference-20261025` starts at remote main `7bc4385d623f181d1f8daa9baf926d45b92018db` (security PR170), verified with `git ls-remote` before branching. No push, PR, merge, deployment, SQL, migration replay, new credentials, security/network changes or spending occurred.

## Reference and scope

Authoritative reference: `blackspire-luxury.html`, Library `libfile_8d9a8a8336288191845e313d19327cb7`, version 0, 32,725 bytes. SHA-256: `19f364b9a85fc26d7b34f2d0e4424e58264eea5fb3f33506507a30f1977b011c`. A supported transfer in this executor succeeded after the approved environment publication. Local extended attributes verify identity/version; the original remains unchanged at `/workspace/blackspire-reference-check.qhLE72/blackspire-luxury.html`. Paths are executor-local and must not be treated as materialized files in another executor.

The real Today/property shell now uses ivory/paper surfaces, forest-green navigation, muted gold, Georgia headings and system sans-serif body text. Navigation becomes a top row on smaller widths. Today gains authorized-data summary counts, priorities and portfolio hierarchy. Property forms, section navigation and next-step panels use the same tokens. All ten sections remain mounted according to existing behavior. Utility launchers move into document flow on these routes so they cannot cover phone forms; their dialogs and handlers are unchanged.

Changes are presentation-only: no production fixture fallback, backend, API, model, calculation, account/auth, research revision/save or security-policy changes. Separate practice and default dark packet themes are excluded from the luxury CSS. An independent review caught and verified fixes for packet contrast, control-border contrast and an invalid font declaration. Screenshot inspection caught and corrected mobile utility overlap and a partially visible skip link.

## Fresh validation

Runtime: Node 22.23.1. Locked root/frontend dependencies installed with `npm ci` (frontend install scripts disabled). These results are fresh; the historical 98-test statement in earlier documentation is not reused.

- Focused existing suite: 148 passed, 0 failed, 0 skipped. Coverage includes calculations, workboard/next-step, research/reload/duplicates, buyer matching, guidance, practice/account boundaries, operator auth, PR170 feedback authorization, applied-migration record and auth-status behavior.
- Root lint, typecheck, build and secret scan: passed.
- Frontend ESLint: passed, 0 errors and 6 warnings in unchanged files. TypeScript `tsc --noEmit`: passed.
- Browser: 218/218 checks passed, zero page errors. Actual Home, Workboard and DealDetail React components, actual CSS and actual utility components, with synthetic props and isolated in-memory network/navigation adapters. Widths: 320, 390, 768, 1440px. Results and source/bundle fingerprints are in `browser-results.json` and `build-manifest.json` in the evidence directory below.
- Browser checks cover all ten tabs, overflow, filters, unavailable/empty boards, draft retention, failed saves, pending-save locks, repeated-write prevention, newer edits during saves, lost-acknowledgment reconciliation, duplicate raw input and private packet-note exclusion. Skip-link focus and utility launcher/dialog behavior are checked separately. No live private records or submissions are used.

## Explicit blockers and acceptance limits

- Production `next build` failed because existing root-layout Google Fonts (Cormorant Garamond, Geist Mono, Plus Jakarta Sans) could not be fetched. No font/network workaround or configuration changes were made. Production CSS ordering, complete Next route/hydration and release build remain UNVERIFIED.
- Aggregate `npm test` stopped before executing tests: `ENOENT`, opening `/proc/sys/kernel/yama/ptrace_scope`. The mandatory containment guard remains unchanged. The 148 focused tests are not represented as an aggregate pass.
- `scripts/check-living-memory.sh` refused this fresh checkout with `UNTRUSTED_ORIGIN_FETCH_REFSPEC: origin fetch refspec is missing, duplicated, or repointed`. No remote configuration or checker changes were made to bypass it. Canonical notes record the local candidate without changing the genuine reviewed release anchor.
- Actual signed-in account, physical iPhone/Safari/native keyboard, production network/save and deployed acceptance remain UNVERIFIED. The browser harness renders actual components but uses synthetic data and framework adapters; it is not full Next server-route authentication verification.

## Evidence

Executor-local directory: `/workspace/blackspire-reference-check.qhLE72`.

- `focused-tests.log`, `frontend-lint.log`, `frontend-types.log`, `frontend-build.log`.
- `root-lint.log`, `root-types.log`, `root-build.log`, `security.log`, `memory.log`, `aggregate.log`.
- `browser-harness/browser-results.json`, `browser-harness/build-manifest.json` and reproducible harness sources.
- `browser-harness/today-{320,390,768,1440}.png`, `property-{320,390,768,1440}.png`.
- `browser-harness/research-{390,1440}.png`, `numbers-{390,1440}.png`, empty/unavailable phone views.

Parent owns subsequent implementation/publication authorization. Resolve the blocked release gates in an authorized environment before treating this candidate as deployable.
