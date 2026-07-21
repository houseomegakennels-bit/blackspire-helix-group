# Jarvis UI Security Boundary

The browser is an instrument panel, never an authority. Enforced properties
of `apps/jarvis-pwa/public/` on branch `feature/jarvis-pwa-ui` (each backed
by tests in `tests/jarvis-pwa-ui.test.js` unless noted):

## Authority

- No frontend code path can authorize deployment, merge, repository
  changes, credentials, host/Docker/firewall changes, budgets, provider or
  model changes, emergency-control changes, trading, or funds movement.
  The UI only calls the existing server-authorized routes; policy,
  approvals, Safe Mode, and emergency stop are decided by the control plane.
- Privileged actions (approve, reject, cancel, emergency stop/reset) render
  only the backend's response. There is no optimistic success. Emergency
  stop and reset are two-step (arm → confirm); reset additionally requires
  the server's fresh-session confirmation header.
- Disabled buttons are UX, not security; every route stays protected
  server-side (verified: unauthenticated reads return 401).

## Data handling

- **No web storage at all**: no `localStorage`, `sessionStorage`, or
  `indexedDB` anywhere in the bundle (tested by literal absence). Refresh
  recovery uses URL-hash canonical IDs plus re-fetch; conversation IDs alone
  grant nothing — every request still requires the session cookie.
- Session cookie is HttpOnly (server-set); the CSRF token lives in JS memory
  only and is attached to non-GET requests.
- All dynamic rendering uses `textContent`/DOM construction; `innerHTML`
  assignment, `insertAdjacentHTML`, and `outerHTML` are absent (tested).
  User and backend content is never interpreted as HTML.
- Evidence views show only backend-sanitized kinds/metadata; exports are
  redacted server-side. No secrets, env dumps, auth headers, cookies, hidden
  prompts, chain of thought, raw stack traces, or internal paths are
  rendered; error surfaces show the server's sanitized `error` strings.

## Network surface

- Same-origin requests only; zero external scripts, fonts, images,
  analytics, or trackers (tested: no non-w3c `http(s)://` literal exists).
- Service worker: never intercepts non-GET requests, never touches
  `/api/*`, `/health`, `/ready`, or the Telegram webhook; caches only the
  Jarvis/root navigation and manifest under a versioned cache; unrelated
  navigations cannot overwrite the Jarvis shell. Updates apply only after explicit
  operator confirmation (no silent replay of anything privileged).
- No voice/microphone surface: no `getUserMedia`, `SpeechRecognition`, or
  `speechSynthesis`; the mic control is disabled and requests no permission.

## Workspace isolation

The UI displays only what the authenticated session's endpoints return and
filters task/conversation summaries to the active workspace. Changing the
workspace clears an active conversation/task whose canonical workspace no
longer matches. This is defense in depth; server-side authorization remains
required. Test mode is labeled ("TEST FIXTURE") from the backend's own
`/api/test-mode` response.

## Known limitation (backend-owned)

Production CSP `script-src 'self'` conflicts with the inline-only asset
model — documented in `JARVIS_UI_BACKEND_GAPS.md` §1. This is inherited from
the pre-existing architecture, not introduced here.
