# Active Context
Last updated: 2026-07-07

- Source of truth repo: `houseomegakennels-bit/blackspire-helix-group`.
- Current default branch state: `main` is clean locally and aligned with `origin/main`.
- Shared workspace model: desktop Codex, desktop VS Code, Codespaces on desktop/mobile, and Claude/Codex sessions all sync through GitHub.
- Required startup context: read `AGENTS.md`, `PROJECT_CONTEXT.md`, `AI_WORKSPACE_SYNC.md`, and all files in `memory/` before editing.
- Required closeout: update shared memory when the repo state materially changes, run relevant verification, then commit and push.

## Current platform scope
- Marketing site and ecosystem shell are live in the `frontend/` Next.js app.
- Core ecosystem work now exists on `main` for Buyer Engine, Seller Engine / Harvester, Deal Engine, Recon Engine, Sentinel, Social OS, Helix Lawn Command, and supporting shared shells.
- Book Studio (audiobook/visual-book pipeline) is live: admin console at `/studio/books`, public listener pages at `/books`. Core logic in `frontend/src/lib/book-studio/`. Pipeline: import manuscript → analyze chapters/scenes/characters → character bible + reference imports → approve canonical looks → assign voices → render scene images (OpenAI) → TTS audio → Ken Burns motion chapter videos (ffmpeg) → incremental publish.
- Book Studio storage is dual-mode: Supabase (tables `book_studio_*`, private bucket `blackspire-book-studio`) when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set (required on Vercel), local `frontend/data/book-studio/` otherwise. Media generation needs `OPENAI_API_KEY`; `BOOK_STUDIO_MOTION_VIDEO=off` forces legacy still-slideshow chapter videos.
- Codespaces bootstrap is configured to install Codex CLI, hydrate env files from GitHub Codespaces secrets, and open the repo through the `Codex Workspace` startup task.
- A `fable-mode` Claude Code skill lives at `.claude/skills/fable-mode/SKILL.md` on `main`; say "fable mode" in a Claude Code session in this repo to activate it.

## Current operating assumptions
- Treat GitHub as the only shared authority for workspace state and memory.
- Treat GitHub Codespaces secrets as the source of truth for runtime secrets and Codespaces Codex auth.
- Do not store private keys, passwords, tokens, or raw credentials in repo docs or `memory/`.

## Current watch items
- If Codespaces still prompts for login, verify `OPENAI_API_KEY` exists in GitHub Codespaces secrets and rebuild the container.
- Keep an eye on mobile quality, especially Seller / Harvester surfaces and any newly added workspace pages.
- Keep memory files current when major capability changes land; the older June 2026 notes were stale before this refresh.

## Recent completed work snapshot
- Division pages were aligned to their logo palettes with page-specific backgrounds and translucent watermark treatments.
- Seller Engine expanded county coverage and live-source search support.
- Buyer Engine gained registry/admin improvements, hedge-fund group tagging, and stronger workflow support.
- Deal Engine added contract, outreach, underwriting, persistence, and closing workflow improvements.
- Recon Engine phases, public pages, and matching flows were integrated into the broader Helix site.
- Codespaces startup/auth was hardened so the workspace can open directly into Codex with repo-managed bootstrap.
- Social OS client workspace and account-setting flows were added on top of the existing ecosystem.
