# Book Studio narration repair — local candidate

Scope: preserve complete source narration and add explicit source/voice controls. Base: `7bc4385`. No production actions or paid generation were performed. Existing books are not automatically migrated. The unrelated luxury and authentication work is excluded.

## Behavior

- Mechanical scenes retain every character, paragraph separator and trailing whitespace. Their concatenation equals the full parsed chapter, including text beyond the 12,000-character analysis window.
- Model scenes are accepted only if their ordered source strings exactly reconstruct that chapter; length/coverage estimates no longer authorize excerpts or rewritten prose.
- Scene PATCH accepts nonempty `sourceText` verbatim. Saving changed text recalculates duration and clears that scene's audio link and its chapter's audio/video links. Image links, scene IDs, other books and historical asset files remain intact.
- Character PATCH accepts a validated `voiceAssignment`. The UI offers Onyx explicitly. Changed effective character voice clears dependent playback links; automatic assignment preserves existing assignments. This retains the existing primary-character voice policy: a scene without a cast uses the existing fallback, and a scene with a cast uses its first resolved character. The selector explains this scope; it is not a book-wide narrator override.
- Both controls require explicit Save. Neither generates audio. Failed saves retain the edited text.
- Title editing was deferred to keep this patch scoped. The original destructive coverage runner was neither changed nor executed. Do not use that runner for this repair.

## Verification

Node `22.23.1`; deterministic `npm ci` in root and frontend. No production environment files were loaded.

| Check | Result |
| --- | --- |
| `node --test frontend/tests/*.test.mjs` | 28 passed, including 10 new narration regressions |
| Before-fix narration reproduction | Initial 7 tests failed; the same 7 passed after repair |
| Frontend `tsc --noEmit` | Passed |
| Frontend `npm run lint` | Passed; 6 warnings in unchanged files |
| Root lint / typecheck / build | Passed |
| Repository secret scan / whitespace | Passed |
| Chromium 375px actual controls | Passed exact 13k+ text save, Onyx selection/save, failed-save retention, no page errors; synthetic callbacks |
| Frontend production build | Blocked by Google Fonts fetch errors |
| Root aggregate `npm test` | Blocked before test execution: absent `/proc/sys/kernel/yama/ptrace_scope` |
| Unchanged living-memory checker | Now passed: genuine origin/main fetched and conventional local fetch refspec restored; checker and reviewed anchor unchanged |
| Live storage, paid TTS, deployed UI | Not run; UNVERIFIED |

The service regression harness runs actual service/route modules with an in-memory store and a synthetic speech sink. It proves exact source passed to the speech boundary, selected Onyx, invalid-input rejection, unchanged unrelated-book fixture and preserved asset records. It does not claim paid speech or production database verification.

The supplied resolved Library audit bundle could not be downloaded with the current supported materialization helper. Initial attempt and one supported retry both returned `download failed`; no readable bytes or exact repair map were obtained. The synthetic tests therefore do not establish the private manuscript's stated 2,683-word total.

## Minimum remaining steps

1. Obtain the existing audit bundle successfully in the consumer environment and verify authoritative text, scene IDs, and the exact full-text repair map. Preserve it privately; do not commit manuscript prose.
2. Complete build, aggregate CI and unchanged memory/review gates in an environment with the required network/kernel/Git setup. Obtain separate authority before publishing a PR, pushing, merging or deploying. No migration is needed for these controls.
3. After an approved frontend deployment, inspect only the intended private draft. Use existing scene IDs and exact repair-map sourceText through scene PATCH (or the explicit editor), rather than reanalysis or the old Geminara runner. Independently verify every saved source string and ordered full chapter coverage against the authoritative text. This data mutation requires separate runtime authority.
4. Inspect scene cast order and explicitly select Onyx for every primary character used by the intended chapter. Verify stored assignments. Scenes without a cast still use the existing fallback and require a separately scoped solution before claiming all-Onyx narration.
5. Verify the saved draft on the deployed UI. Generate audio only under separately confirmed spending/runtime authority; code deployment and local tests alone do not fix existing truncated records or regenerate audio.

Local diagnostic logs and the synthetic browser harness are under `/tmp/book-narration-*` and `/workspace/scratch/verify-narration-browser.mjs` in this execution environment. No signed URLs, credentials or private manuscript text are included in this patch.

## Follow-up evidence review

The strengthened fallback tests require exactly 11 scenes, ten longer than 1,400 characters, and both ordered string equality and total-length equality against a 23,897-character / 23,903-byte / 2,815-word synthetic source. Reintroducing only the 1,400-character fallback cap in an isolated in-memory mutation makes the fallback equality test fail. This separately demonstrates coverage of that specific regression; no repository runtime source was changed for the mutation check.

A new test saves Onyx through the actual character PATCH, invokes actual scene narration and actual media request construction, then intercepts fetch. Its captured POST body has voice `onyx`, model `gpt-4o-mini-tts`, input `Old text` and response_format `wav`. Fetch returns a deliberate synthetic 503 before audio generation. No request leaves the test process and the only credential value is a synthetic fixture string. All28 frontend tests pass.

The Chromium375px harness rendered the actual two controls with React and synthetic callbacks. It exercised textarea entry, explicit saving and prop refresh of 13k+ characters, Onyx selection/save, disabled unchanged Save, failed-save draft retention and no page errors. It did not exercise Next routing, a real HTTP server, database persistence, production styling, physical iPhone behavior, real audio or provider acceptance. Browser callback checks plus separate actual route/service/request tests are not a live end-to-end claim.

Audit failure classification: both prepare_materialize calls succeeded (`isError:false`), returned one signed GET transfer with `workspace_path:null`, size29222 and no warnings/unavailable_items. Both supported-helper materialize invocations returned exit1 and exactly `library file transfer failed: download failed`. The local destination directory exists, but no ZIP exists there. Thus this is an observed download/transport-stage failure, not a returned missing workspace path and not an observed access/approval denial. The helper exposed no HTTP status or underlying exception; an underlying authorization failure cannot be excluded or asserted. No retry beyond the initial attempt and one bounded retry was made.

## Codex cloud verification continuation

Preserved implementation/test commit `fb97198e55bf6c7b402ccda531463ed339532b53` and all existing work. No application source changed in this continuation.

- **Memory gate resolved:** fetched `refs/heads/main` from the existing, verified GitHub origin into `refs/remotes/origin/main`, obtaining `7bc4385d623f181d1f8daa9baf926d45b92018db`. Replaced the local main-only fetch refspec with the conventional `+refs/heads/*:refs/remotes/origin/*` required by the unchanged checker. It passed with reviewed ancestor `2bd77429e91b9f2e383bdfe508476a1ce7f8da34` and canonical-memory-only ancestry. No fabricated refs, reviewed-anchor change, remote URL change, push or credentials change.
- **Real-font build gate still blocked:** an ordinary Google Fonts CSS request returned `URLError: Tunnel connection failed: 403 Forbidden`. No further request or alternate network route was attempted. The installed Next font loader documents `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` for tests; a local fixture supplied synthetic CSS with local generic font faces. This is dependency simulation, not a workaround to access the denied resource and not production typography acceptance.
- **Synthetic compile gate passed:** with Node22.23.1 and an empty inherited environment except PATH, disabled telemetry and the font-fixture path, unchanged Next application source built successfully. Compilation4.0s, TypeScript31.2s, all73 static pages generated. One existing dynamic-filesystem tracing warning remains in video staging. No real fonts were downloaded or verified; do not release this synthetic build output.
- **Synthetic built-server smoke passed:** started only on127.0.0.1:3098 with no credentials. Unauthenticated PATCH to synthetic scene and character IDs returned401; `/books` returned200 using an empty local store. The server was stopped, confirmed by session exit130. No protected workspace login or mutation was performed.
- **Root aggregate gate accurately isolated:** `/proc/sys/kernel/yama` is absent; the unchanged runner requires `kernel.yama.ptrace_scope >= 1`, Linux PID/mount namespaces and privilege-dropping containment. No sysctl changes, security-check edits, fabricated proc files, trusted-context injection or direct aggregate-runner shortcut were used. It needs an appropriately configured CI/host, not an application patch.
- **CI scope finding:** current root CI calls root `npm test`; the separate beta-feedback workflow calls only its own frontend test. Neither automatically executes `frontend/tests/book-studio-narration.test.mjs`. A release verifier must explicitly run `node --test frontend/tests/*.test.mjs` at the exact candidate revision, in addition to existing gates.

The prior28 passing frontend tests and mutation/Onyx checks remain valid for unchanged application/test source. They were not needlessly rerun as a substitute for the blocked aggregate gate. The failed Library transfer was not retried.

### Minimum release checklist and outstanding authority

1. **Input needed:** readable authoritative Chapter One audit/DOCX and exact nine-scene repair map. Confirm target private draft ID, scene IDs/order, complete2,683-word comparison and exact prose equality. Keep private text out of Git. The failed transfer is not evidence of readable source.
2. **Execution environment needed:** actual-font build access approved by the platform, plus a Linux CI/host satisfying the existing containment prerequisites. No cloud restriction bypass. Run full root CI and explicitly run all frontend tests; preserve exact revision evidence and obtain independent code review.
3. **Publication authority needed:** this session does not authorize push/PR publication, merge or deployment. Obtain the appropriate authority before each release action. There is no schema migration, access change or new credential requirement for this patch.
4. **Runtime repair authority needed:** authorize only the intended private draft's sourceText and primary-character voice updates after deployment. Retain a before-state, use exact existing scene IDs, verify each saved source string and concatenated chapter coverage. Do not reanalyze existing books or run the Geminara11–20 runner. Existing Geminara books stay untouched.
5. **Onyx prerequisite:** inspect all nine scenes' ordered casts. Every scene's first resolved character must have explicit Onyx. A castless scene still uses sage; do not claim uniform Onyx or generate until this is resolved by an approved targeted implementation or verified valid cast assignment. No book-wide override is present in this patch.
6. **Audio authority needed:** this task expressly excludes paid requests. A later executor must have applicable generation authority, enforce the approved budget/no-top-up constraint, then verify full narration and actual audio output. Local tests, a source save or a deployment alone are not live narration acceptance.

Cloud evidence: `/tmp/book-narration-synthetic-build.log` and `/workspace/scratch/book-studio-font-fixtures.cjs`. The synthetic fixture is intentionally outside the source tree and must not be used for the release build.
