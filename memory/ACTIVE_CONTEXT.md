# Active Context
Last updated: 2026-06-02

- Source of truth repo: `houseomegakennels-bit/blackspire-helix-group`.
- Current shared workspace model: desktop VS Code, desktop Codex, mobile Codespaces VS Code, and Codex inside Codespaces all sync through the same GitHub repository.
- Required startup context: pull latest repo state, read `AGENTS.md`, `PROJECT_CONTEXT.md`, `AI_WORKSPACE_SYNC.md`, and all files in `memory/`.
- Required session closeout: update shared memory, run build checks when code changed, then commit and push successful changes.

## ⚠️ Active Conflict Warning
- `oracle-helix-frontend/` contains a large untracked directory of Codex-generated content (games, players, props, war-room, simulations, markets routes). Do NOT touch it without explicit instruction from Charles.
- Remaining local changes are now limited to `frontend/CLAUDE.md`, one Buyer Engine logo file, shared `memory/` notes, and the Oracle Helix worktree.

## Last Completed Work (2026-06-02)
- Added and pushed Buyer Engine admin + AI summary tools.
- Added and pushed Instagram growth planning docs.
- Stanly County fixed via direct ArcGIS Online endpoint (128 sales, 72 buyers)
- AI Storyboard Still Generator built and tested (`C:\Users\USER\Desktop\AI-Storyboard-Still-Generator\`)
- gpt-image-2 API fix: `response_format` param must NOT be passed to gpt-image-1/2 models
- n8n API key expires **2026-06-16** — must be renewed
