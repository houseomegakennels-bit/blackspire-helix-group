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
| Unchanged living-memory checker | Blocked: `UNTRUSTED_ORIGIN_FETCH_REFSPEC`; no checker/config workaround applied |
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
