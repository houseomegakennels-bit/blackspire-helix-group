# Jarvis UI Implementation Status

Branch `feature/jarvis-pwa-ui` · 2026-07-18 · local only (not pushed).
Baseline: branch created from `feature/unified-input-foundation` head
`7dbe07f`.

## Implemented and verified on this branch

| Item | Status | Evidence |
|---|---|---|
| Seven screens (Command, Conversation, Task, Events, Approvals, System, Evidence) + sign-in | DONE | `index.html` views; Chromium screenshots at 390×844 / 393×852 / 430×932 |
| Blackspire Helix Core (9 states, CSS/SVG, reduced-motion freeze, hidden-page pause, SR text) | DONE | `data-core` states; geometry verified centered via DOM measurement |
| Typed API layer over existing contracts only | DONE | `api` object; no invented routes (see architecture doc) |
| Vertical slice: submit → conversation+task IDs → ordered events → follow-up reuse → refresh recovery → cancel → duplicate prevention | VERIFIED | live tests in `tests/jarvis-pwa-ui.test.js` + curl slice against a disposable server |
| Policy-denial rendering | DONE (UI) | denial responses render "Denied by policy"; note: Jarvis-channel repo-create is `approval_required` backend-side, Telegram-channel denial already covered by existing suites |
| Approvals (server-authorized approve/reject, expirations, explanations) | DONE | Approval Center + per-task approvals fetch |
| Telegram delivery states incl. retry and terminal failure | DONE (renderer) | delivery lines from `conversation.deliveries`; mock-failure path covered by existing iPhone suite |
| Safe Mode indicator | HONEST GAP | renders "Not reported by control plane" — backend exposes no flag (gaps doc §2) |
| Emergency stop / reset with two-step confirm | DONE | `/api/stop`, `/api/stop/reset` with confirmation header |
| PWA: manifest (any+maskable original icons), offline shell SW, explicit update flow | DONE | `manifest.webmanifest`, `sw.js`; first-install reload bug found and fixed (controllerchange guard) |
| No web storage; hash-based refresh recovery | DONE | tested literal absence |
| Accessibility floor (landmarks, live regions, focus-visible, 44px targets, labels, skip link, reduced motion) | DONE | markup tests + focus screenshot |
| Voice-ready boundary (disabled mic, state machine doc, no speech APIs) | DONE | `JARVIS_VOICE_UI_CONTRACT.md`; tests assert absence of speech APIs |
| Frontend tests | DONE | 28 new tests in `tests/jarvis-pwa-ui.test.js`; existing 5 `jarvis.test.js` kept green; `acceptance.test.js` PWA block updated |

## Validation gates (Node 22.23.1, this branch)

Recorded at commit time — see the final session log entry for exact totals:
full `npm test` suite, `npm run build`, `npm run lint`, `npm run typecheck`,
`npm run security:scan`, `npm audit` (zero dependencies), `git diff --check`.

## Explicitly not done (by instruction or dependency)

- No push, PR, merge, deploy, Vercel/DNS/host change.
- No real Telegram, no voice provider, no paid service, no new npm
  dependency.
- No WebGL/three.js Helix layer (needs backend static chunk route — gaps §1).
- No Fontsource self-hosted fonts (same gap); system stacks in use.
- No Playwright in the repo (zero-dependency test harness preserved);
  browser verification ran from an isolated scratchpad harness instead.
- `test-mode.html` untouched (operator-accepted evidence).

## Independent verification pass (2026-07-19)

Re-verified against a live disposable server; one defect found and fixed.

- **Fixed — update bar reported a false update on first install.**
  `initServiceWorker` latched `updateBar` on via `classList.add('show')` during
  the brief installing→activating window and never cleared it, so a first visit
  claimed "A new Jarvis version is ready." Now gated on a pre-existing
  `navigator.serviceWorker.controller` and toggled (not latched) on each state
  change. Confirmed in-browser: first load `bannerVisible` went `true` → `false`
  with `waiting: false`. Covered by a new regression test (UI suite now 34).
- Test suite: 190 tests, 189 pass. The single failure
  (`environment profiles fail closed…`) is **pre-existing** — it fails
  identically on the untouched baseline worktree at the same commit `7dbe07f`.
- `npm test` requires Node ≥22.5 (`node:sqlite`); this host ships Node 18, so
  the suite cannot run here without a Node 22 obtained outside the repo.
- Browser verification: Chromium at 390×844, 393×852, 430×932 — no horizontal
  overflow, no page errors, screenshots inspected visually. Refresh recovery
  reconfirmed in-browser (hash + canonical task ID + state survive reload).
- **WebKit could not be run**: Playwright's WebKit needs host libraries whose
  installation would exceed this session's boundary. Safari/WebKit behavior
  remains unverified by automation — the manual iPhone guide still applies.

## Known limitations

- Production CSP blocks inline scripts — pre-existing, backend-owned
  (gaps §1). The UI works in the current non-production/test topologies.
- Approval expirations require per-task fetches (gaps §3).
- Recent-conversations list derives from the last-50 task list, not a
  dedicated conversations index.
