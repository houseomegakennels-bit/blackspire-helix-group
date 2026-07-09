# Next Actions
Last updated: 2026-07-09

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

## Hermes agent / skills / tools (added 2026-07-09)
1. **Verified this session (in this sandbox, not a real Codespace):** `pip3 install aider-chat` and `pip3 install "headroom-ai[all]"` both succeed, `aider --version` and `headroom wrap aider` (a real, documented subcommand) both work, and `write_aider_config` correctly generates `.aider.conf.yml` / `.aider-conventions.md` from the committed `fable-mode` skill. The one step that could NOT be verified here: `curl https://ollama.com/install.sh` fails with a 403 because this sandbox's outbound proxy doesn't allowlist `ollama.com` — a real Codespace should have normal outbound internet access and should actually complete this step. On the next real Codespace rebuild, confirm `ollama list` shows `hermes3:8b`, `aider --model ollama/hermes3:8b` responds, and a question is answered with visible fable-mode discipline (e.g. it verifies before declaring a task done).
2. **Bug found and fixed this session:** `scripts/setup-hermes-agent.sh` ran under `set -euo pipefail` with its top-level step calls unguarded, so the blocked Ollama install aborted the *entire* script — Aider, Headroom, and the conventions file never got installed/written even though none of them depend on Ollama. Fixed by guarding each step (`|| true`) so they run independently; re-ran end-to-end afterward and confirmed Aider + Headroom + conventions file all complete correctly even with Ollama unreachable.
3. Confirm Headroom's own reported token-reduction stats on a real tool-output-heavy Aider exchange (not just that the `wrap` subcommand exists).
4. **Verified this session:** spot-checked SKILL.md frontmatter/trigger descriptions across both skill packs (`security-and-hardening`, `test-driven-development`, `stitch-design-taste`, `industrial-brutalist-ui`, `brandkit`, `using-agent-skills`) — all well-formed with clear trigger phrases. Still worth exercising a couple of actual trigger phrases in a live Claude Code session to confirm activation, not just frontmatter correctness.
5. Before ever starting `scripts/telegram-aider-bridge.py`, test the allowlist with a message from an unauthorized Telegram account first and confirm it's silently ignored, before testing with the allowed account. Not testable in this sandbox — no live Telegram bot token/chat available.
6. If `jo-inc/camofox-browser` is ever used, keep it to the approved scope in `scripts/setup-camofox.sh`'s header comment (existing legitimate public-records pulls only).
7. `TOOLS_AVAILABLE.md` lists further tools (Whisper, yt-dlp, browser-use, Firecrawl, Fooocus, VoxCPM2) that are documented but not installed — revisit if Book Studio's OpenAI costs or Seller/Buyer Engine ingestion work call for one of them specifically.
