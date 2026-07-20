# Jarvis UI — Merged iPhone Acceptance Results

Sanitized record of the manual iPhone acceptance run for the locally merged
Jarvis production-contract console. No credentials, tokens, cookies, tunnel
URLs, or private network details are recorded here by design.

## Run metadata

- Merged commit under test: `5fc2606bf76c95f5da04b7b69bb55622e1f0d14f`
  (`feature/unified-input-foundation`; `--no-ff` merge of Jarvis UI
  `80b17f7abf185b25c2132e54ab6ce9551ab5165e`)
- Acceptance start: 2026-07-20 ~22:35 UTC
- Acceptance complete: 2026-07-20 ~23:35 UTC
- Device / browser (operator-supplied): iPhone 15, latest iOS, Safari (393×852)
- Surface served: merged `apps/jarvis-pwa/public/index.html` (production-contract
  console). `UNIFIED_IPHONE_TEST_MODE` intentionally OFF so `/jarvis` served the
  merged console rather than `test-mode.html`; isolation enforced instead by mock
  providers, disposable state, and credential stripping.
- Runtime: temporary Node 22.14 (host Node unchanged), `NODE_ENV=production`
  (for strict CSP / HSTS / Secure cookies), `HERMES_TEST_PROVIDER=mock`,
  `TELEGRAM_MODE=mock`, disposable SQLite, freshly generated admin token
  (discarded at teardown), external network egress blocked to non-loopback.
- Exposure: cloudflared quick tunnel from the repo's digest-pinned image
  (`sha256:18626b1b…`), TTL-bounded, torn down at completion.

## Pre-exposure server validation (local + through tunnel)

- `/jarvis`, `/jarvis.css`, `/jarvis.js`, `/helix-core.js`,
  `/manifest.webmanifest`, `/sw.js`: all HTTP 200 with exact MIME types,
  byte-identical to source, bare and `?v=2`, unauthenticated and authenticated.
- Traversal (`/../package.json`, `/%2e%2e/…`, `/jarvis.css/../../…`,
  `/etc/passwd`, `/.env`): all 401, no content leaked.
- Query strings do not widen the public surface (`/package.json?v=2`,
  `/api/tasks?v=2` → 401).
- Production CSP verified live: `default-src 'self'; script-src 'self';
  style-src 'self'; connect-src 'self'; img-src 'self' data:` — no
  `unsafe-inline`, no nonce, no hash; HSTS present.
- Backend refresh-recovery proven: session cookie alone → `/api/auth/session`
  `authenticated:true` and `/api/tasks` returns the full task list.

## On-device checks — 11 verified PASS, 0 FAIL

| # | Check | Result |
|---|-------|--------|
| 1 | Jarvis page loads, no horizontal overflow | PASS |
| 2 | Mock state clearly identified (`Telegram: mock` badge) | PASS |
| 3 | Helix Core renders (WebGL core animated, not the SVG fallback) | PASS |
| 4 | No false "new version ready" banner on first visit | PASS |
| 5 | Command composer reachable with the keyboard open | PASS |
| 6 | Touch controls comfortably usable | PASS |
| 7 | Submit command → accepted, canonical conversation ID + task ID + timeline/attribution render | PASS |
| 8 | Follow-up submission reuses the same conversation, adds a task | PASS |
| 9 | Refresh recovery: reloading a conversation deep link (ID in URL) restores canonical state | PASS |
| 10 | Policy-denied command is denied and never appears to execute | PASS |
| 11 | Mock Telegram delivery **mode** clearly identified in the status rail | PASS |

Note on #9: reloading a route with **no** selection (e.g. the bare Task-detail
tab, no ID in the URL) renders empty field labels with no values. This is
expected behavior for an unselected route — not a data-loss defect. Deep-link
reload with an ID present restores state correctly. Session persists across
reload; the app does not log out.

Note on the Command screen "Recent conversations" list occasionally appearing
empty: it filters by the selected workspace (confirmed showing
`Blackspire Command`). Transient empty state only; backend retained all tasks.

## UNVERIFIED — documented backend gap (see JARVIS_UI_BACKEND_GAPS.md #8)

The merged production-contract console cannot drive a task to completion in a
credential-free, non-production environment: the canonical workspace is
re-seeded on every read to prefer real providers, and `allowedProviders()`
authorizes `mock` only in production mode, so mock tasks fail (~200 ms) with
"Hermes selected unauthorized provider". This is a backend dependency, not a UI
defect — the shell rendered the genuine `failed` state honestly. Consequently:

| Check | Status | Reason |
|-------|--------|--------|
| Task reaches `completed` (happy-path timeline) | UNVERIFIED | Mock provider never authorized on this console |
| Cancel an eligible (queued/running) task → cancellation state | UNVERIFIED | Tasks fail instantly; no cancellable window exists |
| Mock Telegram delivery of a **completed** task | UNVERIFIED | Delivery is tied to a completing task; none complete here |

These were recorded as UNVERIFIED with explicit operator agreement rather than
resolved by a source change or by using production credentials.

## Synthetic canonical IDs observed (disposable, non-sensitive)

- Conversations: `conv_663b910da6011c4e`, `conv_eac5418db18764db`,
  `conv_daf062890085534d`
- Tasks (representative): `task_bcc3e271c37d8874` (failed — mock provider gap),
  `task_b4bd072fc8d5bc53` (failed — policy-denied credential exposure),
  `task_8c00b23a2746d497` (waiting_for_approval)

## Cleanup

- Temporary application stopped; verified not listening (127.0.0.1:8795 → 000).
- Quick tunnel stopped; public URL proven dead (HTTP 530).
- Disposable SQLite state and all temporary runtime files removed.
- No background acceptance process or container remains.
- Merged branch unchanged at `5fc2606…`; source branches untouched.
- Not pushed, no PR, not deployed; Vercel, DNS, Telegram, and production
  unchanged. `origin/feature/unified-input-foundation` remains at `7dbe07f`.
- A pre-existing local dev container on port 8787 (unrelated to this run) is
  healthy; it was briefly interrupted by an over-broad process match during
  setup and self-recovered via its restart policy.

## Outcome

Merged Jarvis UI passes all on-device checks that are verifiable credential-free
(11/11). Remaining items are UNVERIFIED strictly due to the documented backend
provider-authorization gap, not UI defects. Real-device manual acceptance of the
production-contract console is otherwise satisfied. No merge, push, PR, or
deployment performed or authorized by this run.
