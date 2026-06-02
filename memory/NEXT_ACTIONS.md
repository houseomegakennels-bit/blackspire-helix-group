# Next Actions
Last updated: 2026-06-02

## Session startup
- Keep using `./scripts/agent-start.sh` or the equivalent safe startup flow at the beginning of each session.
- Keep using `./scripts/agent-save.sh` or the `Agent Save` VS Code task before closing a session.
- Approve automatic folder tasks if VS Code prompts for trust/permission.

## Buyer Engine — Pending Frontend Wire-ups
1. **Realtime subscriptions** — `SearchJobDetail.tsx` → subscribe to `SearchJob` + `BuyerReport` channels
2. **Export button** → call `export-csv` edge function, show download link
3. **First operator account** → hit `/api/auth/bootstrap`
4. **User roles admin** → extend admin tooling beyond `CountyDataSource`
5. **Validate edge-function paths** → confirm `generate-outreach` and `summarize-buyer` behave correctly in production data flows

## Buyer Engine — County Data
- Johnston, Columbus, Dare: 0/0 due to NC OneMap lag — monitor, will auto-resolve
- n8n API key expires **2026-06-16** — renew before that date

## Repo Hygiene
- `frontend/CLAUDE.md` and shared `memory/` notes are still local — commit when ready
- inspect whether `frontend/public/brand/blackspire-buyer-engine-logo.png` should be kept, replaced, or discarded
- `oracle-helix-frontend/` untracked Codex work — ask Charles what to do with it

## AI Storyboard Still Generator
- App is complete and working at `C:\Users\USER\Desktop\AI-Storyboard-Still-Generator\`
- Potential enhancements: batch mode, video script output, custom shot count via CLI flag
