# Decisions

## 2026-05-22

- Treat GitHub repo `houseomegakennels-bit/blackspire-helix-group` as the source of truth for shared workspace state and memory.
- Treat mobile Codespaces as the same shared workspace model as desktop VS Code, desktop Codex, and Codex inside Codespaces.
- Use the admin override phrase `ADMIN OVERRIDE: skip memory sync` only to skip memory load/save for a single session.

## 2026-06-01

- **Stanly County routing:** Use the direct ArcGIS Online endpoint for Stanly instead of NC OneMap.
- **Johnston / Columbus / Dare lag:** Treat NC OneMap delay as a data issue, not a code issue, unless evidence changes.
- **AI image model usage:** Use `gpt-image-2` for current image generation flows and do not pass `response_format`.
- **AI Storyboard tool location:** Keep the storyboard generator as a standalone app outside this repo.
- **Repo safety:** Always check git status before editing and avoid overwriting unrelated local work.

## 2026-06-04 to 2026-06-16

- **Division theming:** Each ecosystem division page should match its own logo palette, not inherit Buyer amber by default.
- **Division backgrounds:** Workspace and marketing backgrounds should stay black-dominant and use logo-matched accent colors plus translucent watermark treatment.
- **Seller Engine direction:** Keep Seller Engine focused on lead discovery, scoring, dossier intelligence, and clean handoff. Do not add automated texting/calling as part of Seller Engine scope.
- **Buyer / Seller county strategy:** Prefer direct county or curated endpoints when they are more reliable than shared statewide feeds.
- **Deal workflow:** Keep approved contract/document generation inside the Deal Engine and gate write actions on persistence readiness.

## 2026-06-16 to 2026-06-23

- **Codespaces Codex auth:** Codespaces should authenticate Codex with `OPENAI_API_KEY` from GitHub Codespaces secrets rather than desktop auth state.
- **Codespaces startup:** The repo-managed `Codex Workspace` folder-open task is the preferred path for getting straight into the Codex workspace.
- **Memory hygiene:** Shared memory belongs in repo-tracked docs under `memory/`; keep it current and do not leave the canonical state in local-only notes.
- **Social OS scope:** Social OS client workspace and account settings live inside the same shared frontend and should follow the same shell, auth, and routing discipline as the rest of Helix.

## 2026-07-07

- **Postiz (Social OS):** Postiz is AGPL-3.0 — never copy its code into Social OS. If adopted, run it as a separate self-hosted service and integrate only through its public API; its provider architecture may be read for design ideas only.
- **Remotion (Book Studio):** Hold off. The free license currently covers for-profit companies up to 3 employees (recheck at adoption — a 5.0 license revision is pending), but rendering requires headless Chromium (`@remotion/lambda` / Cloud Run), which doesn't fit the current Vercel ffmpeg pipeline. Revisit when React-authored motion graphics (animated captions, kinetic typography) are needed.
- **Paper Shaders (frontend):** Adopted `@paper-design/shaders-react` for WebGL background gradients on parent-brand marketing pages — desktop + motion-ok gated, CSS layers remain the fallback, division pages keep their logo palettes.
- **Hero postprocessing:** Adopted `@react-three/postprocessing` bloom on the 3D hero, inside the existing desktop/motion/WebGL gates.
