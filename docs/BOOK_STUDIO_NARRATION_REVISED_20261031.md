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

### Narrower final scope: existing JSON, no schema change

The final candidate stores the sole authoritative override as optional `renderManifest.narrationVoice`, serialized through the existing `render_manifest` JSON column. The API's top-level `narrationVoice` is a validated patch convenience only, never a second persisted field. Every `buildScenePrompt` rebuild carries the nested override forward. No store schema, permissions, cast identity or global default changes are required.

The initial column-based attempt is preserved at local commit `cc1cceb` for review, but is superseded and must not be deployed alone. Its SQL proposal and added store-column code are removed from the final tree. There is no production migration to apply. The existing store source is identical to2937a5e.

Independent review of that predecessor found oversized sentences could exceed the speech chunk limit after full-source preservation. The successor bounds all speech chunks to3900 UTF-16 code units, prefers sentence/whitespace boundaries, preserves every character/space, and avoids splitting surrogate pairs. Long punctuation-free text and long words now have explicit regression coverage. The current nine manuscript segments were already below the limit.

## Verification

Node22.23.1; installed locked frontend dependencies retained. Results:

- All34 frontend tests passed, including16 narration tests. Initial3 scene-voice regressions failed before implementation.
- Exact supplied source verified across9 scenes; all nine synthetic narration calls carry Onyx, concatenate exactly, and leave the unrelated-book fixture unchanged.
- Actual scene PATCH → service → media HTTP JSON has `voice: "onyx"` with an empty cast. Fetch is stubbed to a deliberate failure before generation; no network or cost.
- Actual existing-JSON database serialization/reload retains the override after scene and character prompt rebuilds; the row contains no new narration_voice column and the model contains no duplicate top-level voice.
- Actual React controls at375px pass explicit scene Onyx save and all15,725 source characters saved unchanged, with no page errors. The first harness attempt used an overly exact label matcher; DOM inspection showed the implicit label includes select-option text, so the corrected unique label query passed. Callbacks remain synthetic, not production persistence.
- Frontend types and lint pass with6 inherited warnings. Synthetic-font Next build passes compilation, TypeScript and73 static pages; existing dynamic video-file tracing warning remains. This is not the real-font release build.

Commands: `node --test frontend/tests/*.test.mjs`; `npm --prefix frontend run lint`; `(cd frontend && node node_modules/typescript/bin/tsc --noEmit)`. Private plan/browser verifiers and logs are under `/workspace/scratch/chapter-one-revised` and `/tmp/book-revised-*`.

## Remaining gates

1. Finish independent review of the exact successor and exact-revision CI. No migration is required. The unchanged aggregate runner still needs Yama/PID-namespace containment. No bypass or retry was attempted. CI must explicitly run frontend narration tests.
2. Real-font build still requires approved network access; the prior proxy403 endpoint was not retried. Synthetic build output is not for release.
3. Publication approval is recorded for only the tested narration fix. Unresolved verification prerequisites still block release. Do not apply the superseded SQL proposal. Reverify the approved Vercel project/team and production revision immediately before any later release.
4. Bind verified existing private-draft scene IDs to this new map, review changed boundaries, and obtain runtime repair authority before source/voice saves. Verify hashes, complete2742-word coverage and all nine stored overrides after save/reload.
5. Paid audio remains prohibited in this task. Existing metadata cannot establish prior preparation spend plus narration within$1; no usage ledger, spend reservation or hard dollar guard exists. Resolve billed preparation usage and enforce remaining approved budget/no-top-up before any later generation. Never retry uncertain paid requests blindly.

No live narration or production readiness is claimed.

### Production readback and material delta

An authenticated read-only Vercel deployment listing for frontend project `prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou`, team `team_CaRyRaulJaFnCLSfTdyRYNIW`, returned latest production READY deployment `dpl_GVhFqAhEunea8XHfpDiZAMax5eR7` at `7bc4385d623f181d1f8daa9baf926d45b92018db`. This corroborates the supplied baseline; it is not a new deployment or separate current-alias verification. No credentials or environment-secret values were requested.

Relative to the original tested patch, material additions are the explicit per-scene override in existing render-manifest JSON, its selector/patch validation and persistence tests, source-verified nine-segment2742-word plan, and bounded lossless speech chunks. The final net change has no SQL/migration/store implementation delta. Publication is conditional on the remaining gates, and the parent must receive this scope difference before release.
