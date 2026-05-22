# Active Context

- Source of truth repo: `houseomegakennels-bit/blackspire-helix-group`.
- Current shared workspace model: desktop VS Code, desktop Codex, mobile Codespaces VS Code, and Codex inside Codespaces all sync through the same GitHub repository.
- Required startup context: pull latest repo state, read `AGENTS.md`, `PROJECT_CONTEXT.md`, `AI_WORKSPACE_SYNC.md`, and all files in `memory/`.
- Required session closeout: update shared memory, run build checks when code changed, then commit and push successful changes.

