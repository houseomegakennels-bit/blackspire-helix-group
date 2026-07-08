# Book Studio — Geminara Part One: Session Handoff

Continuation guide for finishing the Geminara Part One audiobook from a fresh Claude Code cloud session. Written 2026-07-08.

## Current state

- Book: `Geminara — Part One` (`book_hk7iuemqv2j5ld`), slug `geminara-part-one`, **Published and live** at https://blackspirehelix.com/books/geminara-part-one
- Storage: Supabase project `kchtrvfcixnimvxxctkj` ("blackspire insight"), tables `book_studio_*`, bucket `blackspire-book-studio`
- **Chapters 1–6: fully produced** (scene images, onyx-voiced narration, Ken Burns motion videos) — narration-cutoff bug fixed and all six re-rendered with exact audio/video duration match
- **Chapter 7: 2 of 3 scene images done** (stopped on OpenAI billing limit; scene 3 image, all audio, and the video remain)
- **Chapters 8–10: not started** (11 scene images, narration, 3 videos)
- Character roster: the 14 bible-canon cast (GH-001…GH-014) are locked with canonical looks and `required_for_render`; the other 76 extracted names were demoted to optional
- Narration voice: uniform **onyx** across all scenes (set in `voice_assignment.characterVoice` for every character)

## Credentials (do NOT commit; never print values)

All three secrets are in **Supabase Vault** on the same project. Fetch via the Supabase MCP connector:

```sql
SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name LIKE 'BOOK_STUDIO_%';
```

Names: `BOOK_STUDIO_OPENAI_API_KEY`, `BOOK_STUDIO_SUPABASE_URL`, `BOOK_STUDIO_SUPABASE_SERVICE_ROLE_KEY`.

Write them to `frontend/.env.local` (gitignored) as `OPENAI_API_KEY`, `SUPABASE_URL` (also `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`. Do not echo the values into the transcript — pipe query output straight to the file.

## One-time container setup

The environment ("iPhone") must have open/custom network access (api.openai.com, *.supabase.co, blackspirehelix.com). Then:

```bash
cd frontend
npm install --no-audit --no-fund --ignore-scripts   # ffmpeg-static's download is blocked by egress; skip scripts
apt-get update && apt-get install -y ffmpeg          # system ffmpeg instead
ln -sf /usr/bin/ffmpeg node_modules/ffmpeg-static/ffmpeg
mkdir -p node_modules/server-only                    # stub Next's server-only marker for the runner
printf '{"name":"server-only","version":"0.0.0","main":"index.js"}' > node_modules/server-only/package.json
printf 'module.exports = {};\n' > node_modules/server-only/index.js
```

## Running the pipeline

All runners execute the app's real service functions against production Supabase. Always run from `frontend/` with:

```bash
set -a && . ./.env.local && set +a
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  npx -y tsx scripts/book-studio/runner-produce-chapters.mts 7 8 9 10
```

- `runner-produce-chapters.mts <order>...` — produces chapters strictly in order (images → audio → video per chapter); skips existing assets, so it resumes wherever it stopped; aborts cleanly on billing errors
- `runner-rerender-videos.mts <order>...` — re-renders chapter videos only (no OpenAI cost)
- `runner-ping.mts` — sanity check of store access
- `runner-produce-all.mts` — full remaining production + publish (publish will succeed once every chapter has media)

## Review gates (match what was done for chapters 1–6)

1. After each chapter's images land, download 1–2 from the bucket and compare against the canon character sheets (references `reference-12`…`reference-25` in the bucket = GH-001…GH-014); re-render mismatches with `renderSceneImage`
2. Spot-check chapter videos: probed audio duration must equal video duration (the fix in `media.ts` guarantees this — verify once per batch)
3. The live page updates automatically per chapter; no republish needed (book is already Published)

## Known constraints

- Supabase per-object upload cap is 50 MB (free plan): motion video bitrate is capped at 800k in `media.ts` — do not raise
- OpenAI image calls need up to 240s (already configured); scene images cost ~$0.20–0.30 each at high quality
- Vercel has NOT auto-deployed the merged `main` (site runs older page code; book plays fine). If a deploy happens, the new BookPlayer listening room appears automatically
- Closeout per repo rules: update `memory/ACTIVE_CONTEXT.md` + `memory/NEXT_ACTIONS.md` when the book completes; commit on branch `claude/blackspire-helix-audiobook-n1gclo`
