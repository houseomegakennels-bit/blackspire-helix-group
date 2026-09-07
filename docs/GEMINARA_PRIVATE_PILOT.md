# Geminara private chapter workflow — development checkpoint

Date: 2026-09-06 Eastern / 2026-09-07 UTC.
Baseline: main 53adf74e05c607c0d296923bae05d7ac023ecb57.
Branch: feature/geminara-private-pilot-2026-09-06.
Status: draft implementation; NOT deployed; real media pilot NOT completed.

## Implemented in this branch

- Exact book ID and one chapter order, read-only planning by default. Published books, invalid relationships, dangling assets, and cross-book/traversal paths fail closed.
- A private staging runner calls the existing Book Studio image, narration, and chapter-video services. It refuses all Supabase/Vercel environment settings. It never publishes, deletes, or overwrites the existing public book.
- Before provider work, a human approval file must match the book, chapter, and creative-input SHA-256, have an expiry, and approve the image/narration workload. Paid generation is off unless expressly approved. These are workload limits, NOT a guaranteed dollar cap. No paid calls were made during this work.
- Reused scene/media IDs must resolve to actual nonempty bytes before execution. A local per-chapter lock prevents simultaneous runs in the same staging store. No automatic provider retries; uncertain provider errors require operator review before any rerun. No multi-host queue or durable spend ledger is claimed.
- Finished MP4, scene media, and chapter source are copied to a uniquely named private local folder and re-read to verify byte size and SHA-256/MD5. A link is never accepted as a file backup. ffprobe stream/duration checks and a complete ffmpeg decode are in the runner; human playback/narration review remains required.
- Publication eligibility requires a matching, operator-verified Google Drive receipt, media QA and a separate publish approval. This helper validates trusted evidence only: it does NOT independently contact Drive, cryptographically attest the receipt, or publish anything. Never expose it as a client-supplied authorization endpoint.
- The public media route checks book/asset publication BEFORE reading bytes; only the existing admin role can preview private assets. Anonymous manuscripts/reference assets are no longer public through the route. Existing released chapter media without the new flag is grandfathered; private/pending/unknown flags are denied.
- The public book player lists only eligible completed chapter media. A new pilot marks its chapter video/audio private. Existing legacy runners are unchanged and are NOT the safe pilot entry point.

## Verified in this session

Command (from repository root):

    node --experimental-strip-types --test frontend/scripts/book-studio/pilot.test.mjs

51/51 focused tests passed, with no skips. They use synthetic metadata and temporary fixture bytes, NOT real Geminara chapter production. Four changed TypeScript/TSX integration files also passed syntax/transpile checks. The available test environment was Node 22.16.0; the repository-pinned Node 22.23.1, complete app typecheck/build, browser rendering, service integration and CI were NOT verified here.

Supabase was queried read-only. It contains only Geminara Part One, Published, 20 chapters with 20 linked videos. All 20 satisfy the proposed legacy-visibility rule. Part One's chapter-record fingerprint was unchanged before/after: ffbe555a5fb771a580bf04a2e2b258d4. No schema, object, chapter, book, secret, or production setting was changed.

## Real pilot blockers

Blackspire-command appeared online in device discovery but timed out on both a terminal command and directory read. Its checkout, Node version, ffmpeg, credentials and service runtime could not be inspected. No approved new-part manuscript was found in the connected Book Studio records. Do not invent a story continuation or call a diagnostic placeholder a finished Geminara chapter.

Before private production: restore terminal access; inspect current worktrees/dirty work and use an isolated staging checkout; follow the repository-pinned Node/npm setup; load an approved chapter and its canonical references into a separate local Draft book; run the new planner; review workload and source digest; then run a single approved private chapter. Do not auto-load production credentials into staging.

Example from frontend, in that isolated configured staging checkout:

    npx tsx scripts/book-studio/runner-private-pilot.mts --book BOOK_ID --chapter 1 --backup-root /absolute/private/backups

Execution requires --execute --approval /absolute/private/approval.json. The approval contains bookId, chapterId, sourceDigest, approvedBy, expiresAt, allowPaidGeneration, maxNewImages, maxSpeechCharacters. Do not commit approvals or credentials. Generation uses the existing configured providers and canonical references; their current availability and spend limits need live verification.

After rendering: review the whole chapter and narration; upload the actual MP4 and supporting files to a properly labeled private Drive folder; read back Drive size/checksum/parent/permissions; then record the verified receipt. Finish and independently test the controlled publishing action before any release. No automatic Drive upload, YouTube migration, live publication, or background job was set up in this session.

This is an incomplete development checkpoint, not a replacement for canonical project memory or proof of production readiness. Close out the affected canonical-memory sections and append the canonical session log when the integrated milestone is verified. Keep this branch unmerged until app-level tests, independent review and an explicit deployment checkpoint.
