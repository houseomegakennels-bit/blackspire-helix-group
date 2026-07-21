# Jarvis UI — Core-Side Response to Reported Backend Gaps

Core-side findings for the gaps raised in `JARVIS_UI_BACKEND_GAPS.md` on
`feature/jarvis-pwa-ui` (`bdbdd49580486dc091d39ece287b9fae13e0d2ab`). Reviewed
2026-07-19 on `feature/unified-input-foundation`. The UI branch is not merged,
cherry-picked, pushed, or deployed.

## 1. `/helix-core.js` — route added, but it was never a blocker

The handoff describes this as a 404 to fix. Both halves of that need qualifying:

- `apps/jarvis-pwa/public/helix-core.js` exists **only on the UI branch**. On this
  branch the file is absent, so a route here serves nothing until that branch lands.
- The asset is **not required**. `index.html` calls
  `import('/helix-core.js').catch(...)` and sets `data-helix-fallback="svg"` on
  failure, behind `requestIdleCallback` and a `prefers-reduced-motion` guard. Boot
  never awaits it. The CSS/SVG core is the shipped permanent fallback.

So the UI does not need this route to be correct — it needs it to be *enhanced*.
The route was still added, because the asset is first-party, same-origin is the
only permitted delivery (remote CDNs are prohibited), and the entry is one
allowlist line. It answers 404 until the asset lands, which is the same graceful
degradation the UI already handles.

It is served through an exact-match allowlist: the request pathname is used only
as a literal object key and never as a path segment, so traversal is not
reachable. `text/javascript`, immutable caching for content-addressed assets only
— `sw.js` and the manifest stay revalidatable so clients can still update.

## 2. Production CSP — cause confirmed, NOT fixable core-side

Confirmed and reproduced. Cause is exact and singular:

- `apps/jarvis-pwa/public/index.html` on the UI branch has one inline `<style>`
  (line 11) and one inline `<script>` (line 435).
- `setSecurityHeaders()` emits `script-src 'self'` with no `'unsafe-inline'` when
  `NODE_ENV=production`, so both blocks are blocked.

This is **pre-existing**, not introduced by the UI branch — the previous
`index.html` was also fully inline.

No core-side fix was applied, deliberately. Ranked against the required order:

1. **Extract inline JS/CSS into same-origin assets — correct fix, but it is
   frontend work.** It edits `index.html` on `feature/jarvis-pwa-ui`, which this
   session may not modify. Core is already ready for it: the allowlist makes
   `/jarvis.js` and `/jarvis.css` one line each once the files exist. Those
   entries were deliberately **not** pre-added, because the files exist on no
   branch and dead routes are not a contract.
2. **Build-generated CSP hash — rejected.** The inline script is ~760 lines and
   changes on every UI edit; a hash pinned core-side silently breaks the PWA on
   the next frontend commit, and no build step currently generates one.
3. **Nonce — unavailable.** No nonce mechanism exists in `setSecurityHeaders()`;
   adding one is larger than the extraction it would work around.

CSP was not weakened, no `'unsafe-inline'` was added, no wildcard origin was
added, and no Vercel or production configuration was touched.

**This is the remaining blocker for the UI branch in production.** It does not
block review, and it does not affect development (`'unsafe-inline'` is still set
when `NODE_ENV !== 'production'`).

## 3. Safe Mode — no canonical source exists; nothing was invented

The System screen renders "Not reported by control plane". That is **correct
behavior and was left in place.**

Searched `apps/` and `packages/`: there is no `safe_mode` flag, field, or
concept anywhere in the backend. The only adjacent canonical values are:

| Value | Meaning | Already exposed? |
|---|---|---|
| `emergency_stop` flag | halt all execution | yes — `emergencyStop` on `/health` |
| `requireSafeTestMode()` / `TEST_MODE` | disposable mock-only test surface | yes — via `publicTestModeStatus` |

Neither is Safe Mode. `emergencyStop` is a kill switch, not a safety posture, and
`TEST_MODE` describes a disposable test build. Mapping either onto a "Safe Mode"
indicator would create a **second authority for a state nothing owns**, and would
let the UI report "safe" on the strength of a flag that does not mean safe. That
is the specific failure worth avoiding: a falsely reassuring safety indicator is
worse than an honest "not reported".

**Missing canonical source:** no owner, no definition, no storage. Before any
endpoint exposes Safe Mode, it needs a decided definition (what postures exist,
what transitions them, who may set them), a single owning module, and persistence
alongside the existing flags. Until then `/health` must not grow a `safeMode`
field and the UI must keep degrading honestly.

Gaps 3–7 in the handoff (global approvals endpoint, event vocabulary, worker
heartbeat, cost metadata, conversation titles) are real but out of scope here;
none blocks integration review.
