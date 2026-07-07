# Next Actions
Last updated: 2026-07-06

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
1. Produce Geminara Part One end-to-end (manuscript + world bible import → reviewed renders → publish to `/books`).
2. Verify chapter video render times stay inside the 300s route budget on Vercel for long chapters; drop motion render resolution if needed.
3. Confirm ffmpeg-static ships in the deployed render routes after the `outputFileTracingIncludes` change.

## Documentation
1. Refresh high-level docs like `PROJECT_CONTEXT.md` when the product scope materially changes.
2. Keep workflow and memory docs aligned so future sessions do not restart from stale assumptions.
