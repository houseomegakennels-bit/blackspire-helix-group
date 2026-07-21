# Session Log

## 2026-05-22 - Shared workspace baseline

- Verified the workspace source of truth is `houseomegakennels-bit/blackspire-helix-group`.
- Established the shared memory model across desktop Codex, desktop VS Code, and Codespaces.
- Added the baseline repo memory files and startup/save conventions.

## 2026-06-01 to 2026-06-02 - Buyer Engine county fixes and memory foundations

- Fixed Stanly County routing with a direct ArcGIS endpoint.
- Documented NC OneMap lag issues for other counties as data problems rather than code regressions.
- Added repo safety docs, startup automation helpers, and shared memory workflow.
- Added Buyer Engine admin/source improvements and related operational notes.

## 2026-06-04 to 2026-06-08 - Ecosystem visual alignment and Seller expansion

- Brought ecosystem division pages in line with their logo palettes.
- Added black-dominant, logo-matched backgrounds and translucent logo watermark treatment across division surfaces.
- Expanded Seller Engine county coverage substantially and improved live-source ingestion behavior.
- Added buyer follow-up and registry improvements alongside county/source enhancements.

## 2026-06-07 to 2026-06-09 - Deal, Nexus, and Harvester workflow growth

- Integrated Nexus skip-trace contact syncing into deal workflows.
- Added Deal Engine persistence readiness, investor uploads, outreach drafting, underwriting, ARV, and closing coordination improvements.
- Added approved contract PDF support and stabilized document-generation flows.
- Built out Harvester intake, OCR, extraction, buyer matching, and seller-lead creation improvements.

## 2026-06-09 to 2026-06-13 - Recon, Sentinel, shared shell, and mobile hardening

- Added Recon Engine phases including landing, billing, ingest, opportunity dashboard, and related public/product surfaces.
- Added Sentinel Phase 1 as a command-intelligence layer.
- Improved shared shell/navigation consistency across workspaces.
- Tightened mobile layouts and removed multiple build/runtime blockers.

## 2026-06-13 to 2026-06-16 - Codespaces and environment hardening

- Added repo-managed Codespaces env hydration from GitHub Codespaces secrets.
- Added repo-managed Codespaces Codex authentication flow using `OPENAI_API_KEY`.
- Added a direct Codespaces startup path so the workspace can open into Codex with the `Codex Workspace` task.
- Documented Codespaces secret requirements and manual recovery commands.

## 2026-06-16 to 2026-06-23 - Social OS and memory refresh

- Added Social OS client workspace flows and account-setting surfaces on `main`.
- Kept `main` clean and aligned with `origin/main`.
- Refreshed shared `memory/` docs so current sessions no longer start from stale early-June context.

## 2026-06-29 - Visual revamp follow-ups (PR #6)

- "2056 aesthetic" visual revamp landed in batches; two follow-up commits (WCAG AA contrast lift for `--copy-muted`, WebGL-fallback fix so the CSS hero core stays visible when WebGL is unavailable) remained open on PR #6, originally based against the stale `claude/hello-r0FRI` branch.

## 2026-07-06 to 2026-07-07 - Book Studio production hardening (PRs #7, #8)

- Hardened Book Studio media routes for Vercel (300s route budgets, per-chapter publish rendering with resume, ffmpeg-static bundling).
- Added Ken Burns motion chapter videos and the public `BookPlayer` listener experience with Range-request seeking.
- Fixed chapter narration cutoff (scene durations now fit probed narration length), raised OpenAI media timeouts to 240s, and capped motion-video bitrate under the Supabase 50MB object limit.

## 2026-07-07 - Open-source adoption: shader backdrop and hero bloom

- Evaluated Postiz (AGPL — service-only integration if adopted) and Remotion (license OK at current size, but rendering infra doesn't fit Vercel yet); recorded both in `DECISIONS.md`.
- Adopted `@paper-design/shaders-react`: gold grain-gradient WebGL backdrop on parent-brand marketing pages, desktop + motion-ok gated with CSS fallback; division pages intentionally excluded.
- Adopted `@react-three/postprocessing`: soft bloom pass on the hero 3D scene inside the existing gates.
- Verified with production build, tsc, and headless-Chromium screenshots (desktop home, mobile fallback, Recon division page).
- Root-caused and fixed the hero `canvasReady` handshake from PR #6: React effects inside the R3F canvas tree (and `Canvas onCreated`) never flush under the current React 19 + R3F 9 pairing, so readiness is now detected from the DOM side (canvas element still mounted a frame after mount = context creation succeeded; failures still unmount via the error boundary). Verified: the CSS core now gets `opacity-0` once the 3D scene is live.
- Fixed the one standing lint error (`react-hooks/set-state-in-effect` in `book-player.tsx`) by resetting playback state during render on chapter change; lint is now fully clean.
- Confirmed the mobile home layout is structurally sound (headline in the first viewport); the earlier empty-looking capture was a transient render state.

## 2026-07-07 - Fable-mode skill and repo maintenance

- Added the `fable-mode` Claude Code skill at `.claude/skills/fable-mode/SKILL.md` (branch `claude/opus-skill-file-triggers-ajmhjd`) — a disciplined operating mode activated by phrases like "fable mode".
- Retargeted stalled PR #6 from the stale `claude/hello-r0FRI` base to `main`; against trunk it reduced to two small visual-only fix commits (a11y contrast lift, WebGL hero fallback). Merged to `main` after a clean local frontend build of the merged result.
- Refreshed this session log, which had been stale since June 23.

## 2026-07-08 - Geminara Part One: chapters 7-10 finished, book complete

- Resumed production from `BOOK_STUDIO_HANDOFF.md` on branch `claude/geminara-part-one-production-rpi8a7`: chapter 7 had stopped 2/3 scene images in on an OpenAI billing limit; chapters 8-10 hadn't started.
- Container setup: installed system ffmpeg (apt, since the `ffmpeg-static` postinstall download is blocked by egress) and symlinked it in for `ffmpeg-static`, stubbed `server-only`, pulled the three `BOOK_STUDIO_*` secrets from Supabase Vault straight into `frontend/.env.local` (gitignored, never printed to the transcript).
- Ran `runner-produce-chapters.mts 7 8 9 10` end to end with no billing errors this time: finished chapter 7's scene 3 image/audio/video, then produced all of chapters 8, 9, and 10 (11 scene images, narration, 3 chapter videos).
- Review gates: spot-checked probed audio/video duration for all four chapter videos (0.00s diff each). Compared scene art for the recurring cast (Kael, Orin, Nyx, Commander Solen) against the canon character sheets; Orin's "older, weathered" rendering and Nyx's mixed quadruped/humanoid-feline forms are documented, intentional book-aligned refinements already present in the approved chapters 1-6 art, not new drift, and Orin stays visually distinct from Commander Solen when both share a frame.
- Geminara — Part One is now fully produced end-to-end: all 10 chapters, 33 scenes, images + onyx narration + Ken Burns motion video, still Published and live at `/books/geminara-part-one`.

## 2026-07-08 - Geminara Part One: chapters 11-20 added, narration-coverage bug found and fixed

- User supplied a new manuscript master file with 10 more chapters. `analyzeBook` (the existing import/analysis function) reparses a book's *entire* manuscript and replaces the whole scene list, which would have orphaned every already-rendered image/audio/video for chapters 1-10, so instead added `appendChaptersFromText` in `frontend/src/lib/book-studio/service.ts`: runs scene/character analysis only on the new chapters and merges the result in additively (existing characters matched and reused via `mergeCharacterBibles`, new incidental characters demoted to optional to match the original import's precedent, given the book's uniform onyx narration voice). Verified with a one-chapter test first (chapter 11) that chapters 1-10's scene/asset IDs were byte-identical before and after, then appended chapters 12-20 in a second batch.
- Ran `runner-produce-chapters.mts 11..20`. It got through chapter 18 before hitting an OpenAI TTS quota/billing error on chapter 19 (`insufficient_quota`) - a separate, coincidental blocker from what's described next.
- **Found a real narration-coverage bug** while spot-checking the batch: chapters 11-20 were only capturing 75-81% of each chapter's word count in their scene `sourceText` (chapters 1-10 sit at 99.7-99.9%). Root cause: `analyzeChapters`'s quality gate only checked scene count and average excerpt length before trusting the model's scene split; the model is told to keep excerpts "short and representative," which it can satisfy while silently dropping large stretches of text between excerpts, and narration audio is generated straight from `sourceText`. Fixed the gate to also check total text coverage and fall back to the full-text mechanical split when coverage is too low.
- Added `repairSceneNarrationCoverage` to fix the already-analyzed chapters 11-20 in place: since each scene's existing excerpt is a verbatim, in-order substring of the original chapter text, its position can be located exactly, so the full chapter text can be redistributed across the existing scene boundaries (same scene IDs and images, only sourceText/summary/duration change). It also deletes and clears the now-stale audio/video assets so production regenerates them from the corrected text. Ran it against chapters 11-20; coverage came back to 99.7-99.8%, matching chapters 1-10.
- After the user topped up OpenAI billing, re-ran `runner-produce-chapters.mts 11..20`: it correctly skipped the still-valid images for chapters 11-19 and regenerated audio/video from the corrected text, then produced chapter 20 (images+audio+video) from scratch. Completed cleanly with no errors.
- Review gates: audio/video duration match is exact (0.00s diff) for all 10 chapters; narration word coverage re-verified at 99.7-99.8% after the full production run; spot-checked chapter 20's images (Kael, Nyx, and new supporting characters Vell/Renn/Iyla Marrow) against the established art style, consistent.
- Geminara — Part One is now 20 chapters, 67 scenes, fully produced and Published at `/books/geminara-part-one`.

## 2026-07-09 - Geminara Part One: fixed chapters not playing in the browser

- User reported chapters weren't loading when trying to play them on the live site. Confirmed via curl that the underlying video files download fine (200, correct content-type, valid MP4 per `file`), so the server-side asset route and data were not the problem; read through `BookPlayer` (`frontend/src/components/book-player.tsx`) and found no chapter-count-related logic bugs either.
- Root-caused it by inspecting a downloaded chapter video's MP4 box layout directly (a small Python atom scanner): the `moov` atom (the index a browser needs before it can begin decoding) was at the very end of the file, after all the `mdat` video data - the classic non-faststart MP4 layout. A plain progressive `<video src>` tag effectively can't start playback until it reaches that atom, which on a 30-40MB file reads as "never loads." This affected every chapter, not just the new ones - prior review passes (this session and presumably earlier ones) only verified file validity via `ffprobe`, never actual browser video-tag playback, which is why it went undetected through two full production rounds.
- Fixed both ffmpeg mux commands in `frontend/src/lib/book-studio/media.ts` (motion video and the legacy slideshow fallback) to add `-movflags +faststart`, so all future chapter renders are correct at the source.
- Added `overwriteAssetBuffer` to `frontend/src/lib/book-studio/store.ts` (replaces an asset's bytes in place at its existing relativePath - no ID/data changes elsewhere) and `runner-faststart-videos.mts`, which downloads each chapter's existing video, remuxes it with ffmpeg (`-c copy`, no re-encode, no quality loss), and overwrites it in place. Ran it against all 20 already-produced chapters.
- Verified the fix directly: moov now sits right after `ftyp` (before `mdat`) both via a direct storage read and via a fresh fetch from the live `blackspirehelix.com` endpoint, and durations are unchanged (confirmed exact match for chapter 20 before/after: 343.85s).
- Noted in `NEXT_ACTIONS.md` that any future chapter-media review needs an actual browser/video-tag playback check, not just ffprobe validity - that's precisely the gap that let this ship twice.

## 2026-07-21 - Unified Input branch: authorized the bounded mock acceptance path (local, unmerged)

- Branch `feature/unified-input-foundation` (local merge of the Jarvis PWA UI at `5fc2606`, unpushed). Closed the one confirmed blocker to a credential-free happy-path acceptance: a harmless command could not reach `completed` without a real provider.
- Root cause: the read-only test adapter (`processReadOnlyTestTask` in `packages/hermes/hermes.js`) was entered on the bare `UNIFIED_IPHONE_TEST_MODE` env flag alone, so a task in **any** workspace — including the real `blackspire-command` workspace (`rootPath: .`) — would complete through it. Proven empirically before editing.
- Fix: added `authorizeReadOnlyTestTask(workspace, env)` to `packages/shared/testMode.js` and gated adapter entry on it. Entry now requires valid canonical test-mode config (`testModeConfig().ok`) + the designated synthetic test workspace (`iphone-test`) + mock-only policy + mock Hermes + non-production runtime; otherwise the task **fails closed** (recorded `mock_acceptance_denied`), never reaching the real provider pipeline. Nothing is trusted from the request or a frontend flag. No new provider exception; the safe existing read-only adapter is the completing path.
- Tests: `tests/mock-acceptance-authorization.test.js` (17 cases) — happy completion + mock attribution + read-only, plus denial when each condition flips (test mode off, wrong/missing workspace, non-mock policy, invalid config, credential present, non-mock Hermes, production runtime), replay idempotency, cancellation, evidence redaction. Core suite 225 pass / 0 fail; Jarvis UI source suite 194 pass / 0 fail; build/lint/typecheck/secret-scan/living-memory/`git diff --check` all clean.
- Acceptance: isolated credential-free TEST_MODE run (temporary Node 22, disposable SQLite, mock Hermes/provider/Telegram, no keys) — harmless `status check` via `/api/unified-input` reaches canonical `completed` (`provider: mock`, `model: mock-hermes-status-v1`, `changedFiles: []`).
- Docs: `MOCK_ACCEPTANCE_AUTHORIZATION.md` (conditions, production protection, rollback, acceptance result, limitations) and `JARVIS_UI_BACKEND_GAPS.md` #9. No push, no PR, no deploy; production/Vercel/DNS/Telegram unchanged.
