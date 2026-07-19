# Jarvis PWA Architecture

Branch `feature/jarvis-pwa-ui`, 2026-07-18.

## Shape

The Jarvis PWA is a no-build, dependency-free surface owned by four files in
`apps/jarvis-pwa/public/`, served by the existing control-plane
routes (`/` and `/jarvis` → `index.html`, `/manifest.webmanifest`, `/sw.js`).
`test-mode.html` is untouched operator-acceptance evidence and is served
instead of `index.html` only when the backend enables test mode.

- `index.html` — the entire application: design tokens, seven screens,
  Blackspire Helix Core, typed API layer, hash router, polling engine,
  and accessibility scaffolding, all inline (the backend serves no other
  frontend assets; see `JARVIS_UI_BACKEND_GAPS.md` for the production-CSP
  consequence).
- `helix-core.js` — optional first-party native WebGL enhancement, requested
  through dynamic `import()` after boot. The backend does not yet serve this
  asset, so import failure is expected and the inline SVG/CSS core remains
  the permanent functional path.
- `sw.js` — offline shell only: precaches `/jarvis` + manifest, network-first
  navigations with cached-shell fallback, never touches `/api/*`, `/health`,
  `/ready`, or any non-GET request; explicit `SKIP_WAITING` update flow.
- `manifest.webmanifest` — installable Blackspire identity with original
  inline-SVG icons (any + maskable), standalone display, `#04070C` chrome.

## Screens (hash-routed views inside index.html)

`#/command` (Helix Core, status rail, composer, current task, attribution,
recent conversations) · `#/conversation[/:id]` (canonical ID + copy, unified
Jarvis/web/Telegram message timeline, follow-up composer) · `#/task[/:id]`
(all canonical task facts, cancel, sanitized evidence downloads, approval
history) · `#/events` (ordered canonical events; unknown types render as
sanitized "System event") · `#/approvals` (server-authorized approve/reject)
· `#/system` (health, ready, Safe Mode "not reported", polling, PWA update,
emergency controls) · `#/evidence` (sanitized evidence summary).

Refresh recovery is credential-free: the hash carries only canonical IDs;
all state is refetched from the control plane. No web storage is used at all.

## Data flow

One JSDoc-typed `api` object wraps every consumed contract:
`/api/auth/{login,session,logout}`, `/api/unified-input`,
`/api/conversations/:id`, `/api/tasks`, `/api/tasks/:id/approvals`,
`/api/tasks/:id/{approve,reject,cancel}`, `/api/tasks/:id/export.{json,md}`, `/api/workspaces`,
`/health`, `/ready`, `/api/test-mode`, `/api/stop[/reset]`. No invented
routes, no invented shapes. Canonical backend state always wins: privileged
actions render only the server's response, never optimistic success.

Polling: 2.5s base interval, ×1.7 exponential backoff capped at 30s on
failure, `AbortController` cancellation on teardown/hide,
visibility-aware pause (plus CSS animation pause), online/offline listeners,
stale-state labeling via "Last sync". `pagehide` clears timers, aborts the
active refresh, and destroys optional WebGL resources. Submissions carry a
`crypto.randomUUID()` idempotency key that survives connection failures and
resets on text edit; the submit path is single-flight to block double
submits.

## Helix Core

The inline SVG + CSS core (`.helix-card[data-core=…]`) renders three nested tilted
elliptical orbits with on-ring nodes, dashed vector arcs, radial-gradient
nucleus. States: dormant, listening, processing, approval, completed,
denied, cancelled, offline, emergency — driven by health, connectivity, and
the current task's canonical status. Reduced motion freezes everything;
hidden pages pause all animation; a `.sr-only` live region mirrors the state
in text. `helix-core.js` can add a subtle native WebGL line layer after idle;
it caps DPR, uses low-power context settings, handles context loss, and owns
no model or texture. Its route is not currently served, so failure is silent
and leaves the SVG untouched. Core function can never depend on WebGL.
