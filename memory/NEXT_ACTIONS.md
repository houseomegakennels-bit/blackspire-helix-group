# Next Actions
Last updated: 2026-07-08 (later)

## Workspace / repo hygiene
1. Keep using repo-managed startup flow: `scripts/agent-start.sh` or the `Codex Workspace` task in Codespaces.
2. Keep shared memory updated when major product or infrastructure changes land.
3. Continue avoiding secrets in repo docs, prompts, and `memory/`.
4. The n8n Buyer Engine workflow backup in `memory/` is from 2026-06-07 — re-export if the live workflow has changed since.

## Codespaces
1. Verify `OPENAI_API_KEY` is present in GitHub Codespaces secrets for `houseomegakennels-bit/blackspire-helix-group`.
2. Rebuild the Codespace container after startup/bootstrap changes.
3. If the automatic task does not launch, run `codex-workspace` manually inside the Codespace terminal.

## Product follow-through
1. Keep mobile QA tight across Seller / Harvester, Deal, Recon, and Social OS surfaces after each substantial UI change.
2. Run targeted build checks after touching shared shells, routes, or auth-sensitive flows.
3. Continue using real county/live-source validation whenever Seller or Buyer data-source work changes.

## Book Studio
1. Geminara Part One is complete: all 20 chapters produced (images, onyx narration, motion video) and Published at `/books/geminara-part-one`. Verified playable end-to-end (browser video-tag loading, not just file validity) after the faststart fix below. No further production work needed unless new chapters/content are added.
2. To add more chapters later, use `frontend/scripts/book-studio/runner-append-chapters.mts` (or call `appendChaptersFromText` directly) — do NOT call `analyzeBook` again on this book, it would reparse the whole manuscript and replace the entire scene list, orphaning every already-rendered chapter's images/audio/video.
3. `analyzeChapters`' scene-analysis quality gate now checks total text coverage (in `frontend/src/lib/book-studio/service.ts`), not just scene count/length, after chapters 11-20 initially came out with ~20% of their narration text silently dropped. If a future chapter's narration sounds like it's skipping content, compare scene `sourceText` word counts against the source manuscript per chapter before assuming it's fine — `repairSceneNarrationCoverage` exists to fix it in place without redoing images.
4. Chapter video muxing now always includes `-movflags +faststart` (`media.ts`) after a bug where all 20 chapters' videos had the moov atom at the end of the file, making them fail/hang in a browser `<video>` tag despite passing ffprobe validity checks. **Any future review of chapter media must include an actual browser/video-tag playback check, not just ffprobe duration/validity** — that gap is exactly why this shipped undetected through two production rounds. If a video ever needs remuxing after the fact, use `overwriteAssetBuffer` (`store.ts`) / `runner-faststart-videos.mts` rather than regenerating from scratch.
5. Verify chapter video render times stay inside the 300s route budget on Vercel for long chapters; drop motion render resolution if needed.
6. Confirm ffmpeg-static ships in the deployed render routes after the `outputFileTracingIncludes` change.
7. Vercel deploy status for `main` should be rechecked next session — if/when a deploy happens, confirm the BookPlayer listening room appears correctly and actually plays for all 20 chapters (real playback check, per point 4).

## Documentation
1. Refresh high-level docs like `PROJECT_CONTEXT.md` when the product scope materially changes.
2. Keep workflow and memory docs aligned so future sessions do not restart from stale assumptions.
