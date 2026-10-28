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
| `node --test frontend/tests/*.test.mjs` | 27 passed, including 9 new narration regressions |
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
