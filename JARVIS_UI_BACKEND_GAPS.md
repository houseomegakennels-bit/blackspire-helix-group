# Jarvis UI — Backend Gaps

Capabilities the Jarvis frontend needs (or will need) that the Codex-owned
backend does not currently provide. Nothing here was implemented frontend-side;
the UI degrades honestly instead. Do not treat entries as commitments — they
are documented dependencies for backend planning.

## 1. Static asset routes (blocks several roadmap items)

`apps/api/server.js` serves exactly four fixed frontend paths. There is no
static-directory handler, so the frontend cannot execute separate CSS/JS
chunks, font files, PNG icons, or the lazy-loaded WebGL Helix enhancement.
Consequences today:

- Everything is inline in `index.html`.
- **Production CSP breaks the PWA**: `setSecurityHeaders` emits
  `script-src 'self'` (no `'unsafe-inline'`) when `NODE_ENV=production`, which
  blocks the inline script. This predates this branch (the previous
  `index.html` was also fully inline). Needed backend-side: either static
  routes for `/jarvis.js` / `/jarvis.css`, or a CSP hash/nonce for the inline
  blocks.
- Fonts: the intended Fontsource families (Oxanium Variable / Sora Variable /
  JetBrains Mono Variable, SIL OFL-1.1) cannot be self-hosted; the UI uses
  system font stacks meanwhile. Remote font CDNs are prohibited.
- Optional Helix layer: `apps/jarvis-pwa/public/helix-core.js` is implemented
  as first-party native WebGL and requested only after boot, but
  `/helix-core.js` currently returns 404. Add an explicit same-origin static
  route with `text/javascript`; the CSS/SVG core is the shipped permanent
  fallback and must remain.

## 2. Safe Mode is not exposed

No `/health` or `/ready` field reports a Safe Mode flag, and no `safe_mode`
system flag exists in the backend. The System screen renders
"Not reported by control plane". Needed: a sanitized boolean on `/health`.

## 3. No global pending-approvals endpoint

Only `/api/tasks/:id/approvals` exists. The Approval Center derives pending
work from `GET /api/tasks` (status `waiting_for_approval`) plus per-task
approval fetches (bounded). A `GET /api/approvals?status=pending` endpoint
would remove N+1 fetches and expose expirations directly.

## 4. Event vocabulary is narrower than the product language

The backend emits `task.<status>`, `policy.denied`,
`task.cancellation_requested`, and `task.cancellation_cleanup` as
conversation events. It does not emit `input.received`, `policy.allowed`,
`hermes.selected`, `provider.selected`, `approval.granted`,
`approval.denied`, or any `delivery.*` events (delivery state lives on the
`channel_deliveries` rows returned with the conversation; Hermes/provider
attribution lives in evidence and `providerAttribution`). The UI already
labels the full target vocabulary and renders unknown types safely, so new
backend event types light up without frontend changes.

## 5. Worker heartbeat / availability

`/ready` reports provider modes but no Hermes/worker liveness. The System
screen says "Reported per task". A sanitized worker/Hermes availability
field would allow a real indicator.

## 6. Cost metadata

`provider_usage.cost_cents` exists in the schema but is not exposed on any
consumed endpoint; the UI shows the task budget only.

## 7. Conversation titles, Hermes skill, and canonical timing

Consumed responses expose no canonical conversation title or Hermes skill
identifier. Jarvis derives a display title from the first message and labels
Hermes skill “Not reported by control plane”. Task start/completion times are
derived from canonical events when those events exist, otherwise the start
falls back to task creation. A sanitized title, selected-skill identifier,
and explicit start/completion fields would remove these fallbacks.

## 8. Test-mode surface conflict (not a gap, a note)

When `TEST_MODE` is enabled the backend serves `test-mode.html` — preserved
untouched as operator-accepted evidence. The new `index.html` therefore only
ever renders against production contracts.
