# Decisions

## 2026-05-22

- Treat GitHub repo `houseomegakennels-bit/blackspire-helix-group` as the source of truth for shared workspace state and memory.
- Treat mobile Codespaces as the same shared workspace model as desktop VS Code, desktop Codex, and Codex inside Codespaces.
- Use the admin override phrase `ADMIN OVERRIDE: skip memory sync` only to skip memory load/save for a single session.

## 2026-06-01

- **Stanly County routing:** Use direct ArcGIS Online endpoint (`services6.arcgis.com/w1igg0Q14weqYXUh/...`), NOT NC OneMap. Stanly removed from NC OneMap routing in n8n and frontend.
- **Johnston/Columbus/Dare:** NC OneMap lag is the root cause of 0/0 results. Do NOT add workarounds — wait for NC OneMap to update.
- **AI image model:** All new image generation uses `gpt-image-2`. Never pass `response_format` to gpt-image-1 or gpt-image-2 — these models reject that parameter with a 400 error.
- **AI Storyboard app:** Standalone CLI tool, never merged into the Blackspire repo. Lives at `C:\Users\USER\Desktop\AI-Storyboard-Still-Generator\`.
- **Repo safety rule:** Always check git status before editing. Never overwrite `oracle-helix-frontend/` without explicit direction — it contains untracked Codex work.

