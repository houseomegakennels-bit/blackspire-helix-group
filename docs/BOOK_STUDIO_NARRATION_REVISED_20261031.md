# Revised Chapter One — local repair and review plan

This supersedes the October28 source map and release checklist. Publication of only the tested narration fix was subsequently approved, conditional on passing release gates and independent review. No publication, push, merge, deployment, live provider call, credentials work or production data repair has been performed. Previous commits through2937a5e remain preserved. Private source is not committed.

## Source verification and exact plan

The supplied revised Ledger description is included verbatim. Stored UTF8 source matches SHA256 `5d42b3e6c78a18d00ae8926c8369b4f72316666449dd20f5001d1101a2274534`,15,725 characters and2,742 whitespace words, including the final newline. No prose was rewritten or improvised. The old2,683-word map is obsolete.

The actual analysis fallback produced these contiguous slices, each with explicit `narrationVoice: "onyx"`. Offsets are zero-based and end-exclusive. Ordered concatenation equals the authoritative source exactly. Full per-slice digests are in `CHAPTER_ONE_NARRATION_PLAN_20261031.json`.

| Sequence | Start | End | Words |
| --- | ---: | ---: | ---: |
| 1 | 0 | 1805 | 307 |
| 2 | 1805 | 3629 | 317 |
| 3 | 3629 | 5415 | 312 |
| 4 | 5415 | 7329 | 339 |
| 5 | 7329 | 9203 | 335 |
| 6 | 9203 | 11001 | 306 |
| 7 | 11001 | 12842 | 323 |
| 8 | 12842 | 14705 | 331 |
| 9 | 14705 | 15725 | 172 |

This is a review-only mapping, not an executable live repair: scene IDs are null because current production IDs/order were not provided or queried. Bind only verified existing scene IDs for the intended private draft. Review their scene metadata/image correspondence against the revised boundaries; nine segments alone does not prove the old scene identities are equivalent. Retain a before-state and verify every source hash after an authorized repair. Do not reanalyze or mutate Geminara.

Private local deliverables: `/workspace/scratch/chapter-one-revised/source.txt`, `scene-plan.json`, `verification.json`, and `verify-plan.mjs`. The verifier uses the actual service with synthetic analysis/storage/audio boundaries and proves all nine exact inputs resolve to Onyx without cast changes. It does not contact a provider.

## Implementation

Scene PATCH now accepts nullable `narrationVoice` from the supported voice allowlist. A non-null override wins over the existing character policy, including a castless scene. Unsupported persisted or submitted overrides fail instead of falling back. Null explicitly retains the existing legacy policy; global defaults are unchanged. Every segment of this chapter plan specifies Onyx, never null.

The new explicit-save scene selector does not generate audio. Changing an effective voice clears the scene audio and its chapter playback links while retaining historical asset files. Identical overrides and character-voice changes masked by an override do not invalidate audio. Source text, scene identity and cast identity are preserved.

The database mapper saves/loads `narration_voice`. **A new nullable column with an allowlist CHECK is required before deploying this code.** `BOOK_STUDIO_NARRATION_VOICE_SCHEMA.sql` is an unapplied review proposal. The new writer checks that column before any book writes, refusing cleanly if unavailable. No grants, RLS or credential changes are proposed.

Supported migration generation is pending: the current CLI failed before command handling when attempting to create its default `/home/agent/.supabase` directory on a read-only filesystem. A pinned2.81.3 CLI installation also exited1 before exposing a usable CLI. Neither home permissions nor credentials were changed. The SQL is deliberately not disguised as a CLI-generated migration. Generate/review the migration in a supported isolated CLI environment; do not run a bulk migration push.

## Verification

Node22.23.1; installed locked frontend dependencies retained. Results:

- All33 frontend tests passed, including15 narration tests. Initial3 scene-voice regressions failed before implementation.
- Exact supplied source verified across9 scenes; all nine synthetic narration calls carry Onyx, concatenate exactly, and leave the unrelated-book fixture unchanged.
- Actual scene PATCH → service → media HTTP JSON has `voice: "onyx"` with an empty cast. Fetch is stubbed to a deliberate failure before generation; no network or cost.
- Actual database serialization/reload retains the override; missing-column simulation produces zero writes.
- The SQL proposal executes successfully in fresh embedded PostgreSQL (PGlite), preserves existing rows/text as null-override legacy data, accepts Onyx and rejects invalid values. Native/remote migration acceptance remains UNVERIFIED.
- Actual React controls at375px pass explicit scene Onyx save and all15,725 source characters saved unchanged, with no page errors. The first harness attempt used an overly exact label matcher; DOM inspection showed the implicit label includes select-option text, so the corrected unique label query passed. Callbacks remain synthetic, not production persistence.
- Frontend types and lint pass with6 inherited warnings. Synthetic-font Next build passes compilation, TypeScript and73 static pages; existing dynamic video-file tracing warning remains. This is not the real-font release build.

Commands: `node --test frontend/tests/*.test.mjs`; `npm --prefix frontend run lint`; `(cd frontend && node node_modules/typescript/bin/tsc --noEmit)`. Private plan/schema/browser verifiers and logs are under `/workspace/scratch/chapter-one-revised` and `/tmp/book-revised-*`.

## Remaining gates

1. Finish supported migration-file generation, independent review and exact-revision CI. The unchanged aggregate runner still needs Yama/PID-namespace containment. No bypass or retry was attempted. CI must explicitly run frontend narration tests.
2. Real-font build still requires approved network access; the prior proxy403 endpoint was not retried. Synthetic build output is not for release.
3. Publication approval is recorded for only the tested narration fix. Unresolved verification and schema prerequisites still block release; schema execution needs explicit handling within the approved scope. Apply only the reviewed nullable-column migration before the candidate frontend.
4. Bind verified existing private-draft scene IDs to this new map, review changed boundaries, and obtain runtime repair authority before source/voice saves. Verify hashes, complete2742-word coverage and all nine stored overrides after save/reload.
5. Paid audio remains prohibited in this task. Existing metadata cannot establish prior preparation spend plus narration within$1; no usage ledger, spend reservation or hard dollar guard exists. Resolve billed preparation usage and enforce remaining approved budget/no-top-up before any later generation. Never retry uncertain paid requests blindly.

No live narration or production readiness is claimed.
