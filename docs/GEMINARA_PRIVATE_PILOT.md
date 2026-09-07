# Geminara private pilot — verified diagnostic checkpoint

2026-09-07 UTC. Draft PR #126, branch `feature/geminara-private-pilot-2026-09-06`, resumed from `982a8cc57fa16313fbd5bfddecd2f30bfdf1db94` in `/root/blackspire-wt-geminara`. This is a tested diagnostic workflow, **not a finished new Geminara chapter**. No production data, credentials, sharing, domain, or production deployment changed. No paid provider calls occurred.

## Implemented boundaries

- Existing Book Studio store/services/renderer are reused. `BOOK_STUDIO_LOCAL_ROOT` selects an absolute, separate local store; Supabase/Vercel configuration is refused when that root is set. The CLI never loads dotenv files. Its runtime loader uses the installed pinned TypeScript compiler and resolves application aliases and the framework's server-only marker; it does not stub services or modify dependencies.
- Generation requires exact book ID/chapter order, unique chapter/scene identifiers, valid scene ownership and paths, source-bound expiring operator approval, explicit paid consent and workload limits. Compiled prompts, scene summaries/text, actual selected voice, model configuration, style, characters and reference-byte hashes enter the approval digest. Missing/unapproved/dangling canonical references fail closed. New narration requires an explicit Onyx assignment. Diagnostic sound is not Onyx.
- Existing media must match either source-bound production hashes or the approval's explicit `reusedAssets: [{id, sha256}]`. Output IDs/prompts do not invalidate unchanged creative inputs. Approval is re-read between operations and before each private provider request, including each narration chunk. A failed reference-image request cannot silently fall back to a second unanchored image request in a private run.
- New assets are private at creation, including legacy service writes. In-place overwrite invalidates release/source evidence before replacing bytes. The storage adapter refuses an already-public remote bucket rather than changing its permissions.
- Both operator CLIs share the local per-chapter directory fence. Failure or interruption retains the fence; only a successful operation removes it. Operators must reconcile provider outcomes and assets before manually clearing a stale lock. No distributed locking, automatic uncertain-provider recovery, chunk-resume ledger, or guaranteed dollar cap is claimed. Use one writer and do not run unrelated admin mutations against the isolated store during a pilot.
- Public chapter/asset checks deny malformed ownership, ambiguous records, absent release metadata on new media, and cross-chapter scene links. Approved media carries a SHA-256 checked against served bytes. Anonymous source/reference/raw scene-audio routes remain denied. Existing admin authentication is unchanged.
- Deliberate legacy compatibility applies only to `book_hk7iuemqv2j5ld`, chapter orders 1–20, and unflagged assets with valid creation timestamps before 2026-09-07 UTC. It is not a general absent-flag bypass. Exact existing asset IDs are not embedded in source. Replacement files require a new release.
- Local backup inventories include actual MP4, chapter/scene audio, images, prepared source/style/canon manifest, approved reference assets when present, and technical QA. Every inventory entry is reread and hashed. QA probes both streams, compares scene audio duration with finished audio/video, and decodes the complete MP4. Text coverage, pronunciation, canon/style, and creative acceptance still require human review.
- `drive-backup.mjs` verifies local bytes, exact remote parent/name/size, owner-only permissions and complete downloaded SHA-256. Unknown permissions/shared drives are rejected. Exact folder/name lookup avoids blindly duplicating completed uploads after interruption; ambiguous duplicates fail. `drive-rest.mjs` supplies the real OAuth transport without credential discovery or permission changes. It uses one resumable-session PUT, with no automatic network retry or chunk recovery. REST request behavior is fixture-tested; this session's real transfers used the authorized Drive connector.
- `release-local.mjs` rechecks current bytes/source, all backup files through a trusted transport, fresh technical decoding, human-review fields and a separate book/chapter/video-bound expiring approval. Revocation/cancellation is rechecked before commit. It mutates the existing chapter, not a second publication record. The protected production book is refused. No new public release endpoint or production publishing activation was added. Operator-owned review/approval files are assertions of human authority; this code does not cryptographically authenticate their author. Never wire caller-supplied files/transport functions into an HTTP authorization endpoint.

## Verified evidence

Runtime: repository-pinned Node **22.23.1**, deterministic `npm ci` at root and frontend, unchanged package manifests/lockfiles. Both system FFmpeg/FFprobe and the installed `ffmpeg-static` renderer ran successfully. Private local store and actual service imports were exercised.

Commands from the repository root (with the pinned Node bin first in PATH):

```sh
npm ci --no-audit --no-fund
(cd frontend && npm ci --no-audit --no-fund)
node --experimental-strip-types --test frontend/scripts/book-studio/pilot.test.mjs frontend/scripts/book-studio/backup-release.test.mjs frontend/scripts/book-studio/runtime.test.mjs
npm test
npm run build
npm run lint
npm run typecheck
node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
(cd frontend && npm run lint && npm run build)
bash scripts/check-living-memory.sh
npm run security:scan
git diff --check
```

- Focused Book Studio lane: **90 passed, 0 failed/skipped**. Includes actual local store/overwrite behavior, corrupt-media rejection, isolated configuration refusal, retained failure fence, mocked provider fallback/revocation, approval gates, Drive byte tampering/permissions/parent checks and interrupted-upload retry behavior.
- Full trusted root suite: **1,275 total, 1,266 passed, 0 failed, 9 skipped**. All 85 intended files completed; zero mutated identities or remaining descendants. These root tests are distinct from the focused frontend lane.
- Root build/lint/typecheck and frontend TypeScript/lint/build passed. Existing Next build warnings about dynamic config import/cache headers remain; no dependency changes were used to bypass them.
- Actual diagnostic: six seconds, valid audio/video, full decode passed; scene audio, video and audio durations each six seconds. Reuse-only repeat skipped all provider work and rendering. A final validation render exercised the stricter source/reuse binding. These are repetitions of one synthetic diagnostic, not new story chapters.
- Browser harness correction: a short clip can finish before a seek is dispatched, so seeking backward from `ended` must explicitly resume playback. The initial direct-seek wait timed out with paused media at five seconds; the corrected user-control/tail-resume test passed. The player now initializes its displayed duration on playback even when metadata arrived before hydration.
- Local website integration: **15/15 checks**. Private book/video/image return 404; anonymous scene/reference/character APIs and publish API deny access. A labeled test-only release succeeds locally, repeat leaves one chapter, byte-range request returns 206/100 bytes, image returns 200, Chrome plays and seeks to the last second and reaches `ended=true`, `currentTime=duration=6`, no media/page errors. The snapshot is restored to Draft in `finally`. Test review/approval fixtures are not real human approval or narration review.
- Read-only live Part One check: page HTTP 200, 20 distinct chapter-video paths, 20/20 successful range responses. This does not claim listening to all 20 chapters, checking every historical byte, or changing production records.

## Actual private Drive backup

Final local backup:
`/root/geminara-private-backups-final-20260907/PRIVATE-book_diagnostic-chapter-01-a4447942-0998-401c-b83b-fa04bfbdaff7`

Drive organization:
`Blackspire Helix Group / Geminara / Private Production Pilots / DIAGNOSTIC - NOT A GEMINARA CHAPTER / Chapter 1 / diagnostic-20260907-a4447942-final-validation`

[Private final run folder](https://drive.google.com/drive/folders/1qai8BbI3CInVN_Rl3MXk72qykuRv7KYZ).
[Actual diagnostic MP4](https://drive.google.com/file/d/1vZmIh9Sg3td_aCL8XUVCG529gkIzYy3o/view).

All seven files (MP4, chapter WAV, scene WAV, image, source JSON, QA JSON, inventory JSON) were uploaded as actual bytes and downloaded again. All seven sizes and SHA-256 values matched locally; all had the exact run-folder parent and one user/owner permission, `shared=false`. Folder permissions were also read back. The connector omits requested provider checksum fields, so full download-and-hash was used. A streamed connector file reference could not be materialized through the available terminal tools; the bounded diagnostic compatibility download was used without printing binary payloads. No sharing was broadened.

Final MP4 SHA-256: `4a015434f28bec60360635df810939553480e0af7e0b651cf8ed0fc240bd6c3e`.
Private receipt and complete downloaded files: `/root/geminara-drive-final-readback-20260907/verified-receipt.json`. The earlier diagnostic run is retained in its separately labeled sibling folder; neither is an official release. The inventory's initial `googleDriveBackupVerified:false` is not rewritten as authority; the separately verified receipt records the subsequent transfer.

## Source discovery and remaining production gate

Authorized Drive discovery found:

- `Geminara script final (working version)`, document `10yiwr2nq_Lp8q1en6_ne4KLv07Bz8JFs3IsCcWqI6JE`: headings include Chapters One–Twelve and a Part II **appendix/canon reference**. That heading is not evidence of an approved next story part.
- World Bible, document `1LUNANhBZ5hrGvwvZZjBS2K93B4l-KDu_l-YFItyM994`, and canon correction `1ZpQGmou7Ko4F5Z9PJVTVf7FMWo5f7uh7lX4vVFvsG3M`.

No source-specific approval identifying a new chapter and paid workload was found. No private manuscript was copied into Git, the preview, or a staging credential environment. The diagnostic has no canon references, story continuation, or spoken narration; human creative/Onyx review is **NOT DONE**.

Smallest operator action: identify the exact approved chapter text and canonical reference revision, load them into a separate Draft book, and approve the planner's source digest plus image/speech workload with Onyx voice assignments. Provision only explicitly authorized generation credentials for that isolated machine. Real chapter production, human review, and a **separate publication/release approval** remain required. Production release wiring/rollout and independent PR review remain open; do not merge or promote PR #126 based on these diagnostic results.

## Operator entry points

Run from `frontend`, with the pinned Node runtime and a new absolute local store root. No `npx` installation, dotenv loading, or server-only package edits are needed.

```sh
export BOOK_STUDIO_LOCAL_ROOT=/absolute/private/isolated-store
node --import ./scripts/book-studio/register-runtime.mjs scripts/book-studio/runner-private-pilot.mts --book BOOK_ID --chapter 1 --backup-root /absolute/private/backups
```

Execution adds `--execute --approval /absolute/private/generation-approval.json`. Approval fields: `bookId`, `chapterId`, `sourceDigest`, `approvedBy`, `expiresAt`, `allowPaidGeneration`, `maxNewImages`, `maxSpeechCharacters`, and explicit reused asset IDs/hashes when needed. `revoked:true` or `cancelled:true` denies work. Workload limits are not dollar caps.

For connector-independent operator backup, provision a scoped `BOOK_STUDIO_DRIVE_ACCESS_TOKEN` externally (never print/commit it), select an already-private exact folder, then:

```sh
node --import ./scripts/book-studio/register-runtime.mjs scripts/book-studio/runner-backup-release.mjs backup /absolute/private/backup DRIVE_FOLDER_ID
```

The `release` action adds the absolute publication-approval path and remains **local-only**. Human review must cover the exact video, be included in the inventoried QA, and be backed up again after any QA edit. Publication approval fields: `action:"publish"`, exact `bookId`, `chapterId`, `videoSha256`, `approvedBy`, `expiresAt`; revocation/cancellation denies it. No production credentials are accepted.

`diagnostic.mjs` creates only a new synthetic store, refusing existing directories and provider credentials. `integration-diagnostic.mjs` is a test harness restricted to that diagnostic identity and a loopback website on port 3216; it temporarily exercises publication using explicitly labeled fixtures and restores Draft. Keep diagnostic stores, backups, approvals and screenshots outside the checkout. The branch push may build a Vercel preview, but no private data/configuration is supplied to it. Preview Book Studio storage remains unconfigured; the local verification does not claim preview or production publication readiness.
