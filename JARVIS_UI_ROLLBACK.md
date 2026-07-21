# Jarvis UI Rollback

Scope of this branch's changes (all frontend or frontend-test):

- `apps/jarvis-pwa/public/index.html` — rebuilt console (was a 23-line stub)
- `apps/jarvis-pwa/public/helix-core.js` — optional first-party WebGL layer
- `apps/jarvis-pwa/public/sw.js` — rewritten safe service worker
- `apps/jarvis-pwa/public/manifest.webmanifest` — expanded manifest
- `tests/jarvis-pwa-ui.test.js` — new suite
- `tests/acceptance.test.js` — one test block updated to the new markup and
  the no-browser-speech policy
- `.agents/skills/blackspire-jarvis-interface/` — new Codex project skill
- Documentation: `OPEN_SOURCE_UI_STACK.md`,
  `BLACKSPIRE_JARVIS_DESIGN_SYSTEM.md`, `JARVIS_PWA_ARCHITECTURE.md`,
  `JARVIS_UI_IMPLEMENTATION_STATUS.md`, `JARVIS_UI_SECURITY_BOUNDARY.md`,
  `JARVIS_UI_IPHONE_TEST_GUIDE.md`, `JARVIS_UI_BACKEND_GAPS.md`,
  `JARVIS_VOICE_UI_CONTRACT.md`, `JARVIS_UI_PERFORMANCE_BUDGET.md`,
  `JARVIS_UI_ROLLBACK.md`

Not touched: backend services, packages, migrations, Hermes, policy,
Telegram, `test-mode.html`, Docker/Vercel/CI/DNS/host config,
`package.json`/`package-lock.json` (zero dependency changes).

## Rollback procedure

Shared-history rule: revert, never reset or rewrite.

1. Identify the branch commit: `git log --oneline feature/jarvis-pwa-ui`
   (single commit: "feat: build open-source Jarvis mobile command
   interface").
2. `git revert <commit>` on the affected branch, then rerun
   `npm test`, `npm run build`, `npm run lint`, `npm run typecheck`,
   `npm run security:scan` under Node 22.23.1.
3. Reverting restores the previous minimal console and the old cache-first
   service worker. Because the new worker uses cache name `jarvis-shell-v3`
   and deletes unknown caches on activate, moving in either direction
   converges: any client that saw v2 will re-install v1's `jarvis-v1` cache
   on its next update cycle. If a client appears stuck on a cached shell,
   Safari → Settings → Clear History and Website Data for the host, or bump
   the cache name in whichever `sw.js` is current.
4. No data migration is involved; the UI holds no persistent state
   (no web storage), so rollback has no client-side data consequences.

## Partial rollback

Each documentation file and the project skill are standalone; reverting the
three `apps/jarvis-pwa/public/` files alone restores the old UI while
keeping the audit/docs. `tests/acceptance.test.js` must be reverted together
with `index.html` (it asserts the new markup).
