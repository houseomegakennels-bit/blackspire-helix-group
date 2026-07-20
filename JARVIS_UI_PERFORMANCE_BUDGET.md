# Jarvis UI Performance Budget

Measured on branch `feature/jarvis-pwa-ui`, 2026-07-18.

## Payload budget (no-build, single-file surface)

| Asset | Budget | Actual (this branch) |
|---|---|---|
| `index.html` (uncompressed) | ≤ 96 KB | 66.6 KB |
| `sw.js` | ≤ 4 KB | 2.3 KB |
| `manifest.webmanifest` | ≤ 4 KB | 1.5 KB |
| External requests for core UI | 0 | 0 |
| npm bundle dependencies | 0 | 0 |
| Images/fonts fetched | 0 (inline SVG + system fonts) | 0 |

The previous Jarvis console was ~8 KB but rendered raw JSON dumps; the new
budget buys seven real screens, the Helix Core, and the full status system
while remaining a single request smaller than one webfont file.

## Runtime rules (enforced in code; regression-tested where practical)

- Core command UI has no 3D chunk to block on; the Helix Core is CSS/SVG.
  A future WebGL layer must be a lazy chunk behind a static route
  (see gaps doc) and must never gate navigation or submission.
- All ambient animation pauses when the page is hidden
  (`document.hidden` → `.paused` class + polling stops + inflight fetches
  abort). Verified via the visibility handler tests.
- Polling is bounded: 2.5s active, exponential backoff ×1.7 to a 30s cap
  offline, zero polling while hidden.
- Re-render is view-scoped (only the active view renders per sync); event
  and message lists render bounded, staggered entries (first 8 staggered).
- No autoplay audio/video, no background images, no blur radii over 60px
  (single radial gradient halo only), DPR handled by the browser for SVG
  (vector, no canvas cost), particle count: zero.
- Icons are hand-drawn inline SVGs (7 nav + 2 control glyphs), tree-shaking
  not applicable — nothing unused ships.

## Measurement notes

Chromium (Playwright) at 390×844/393×852/430×932: zero console errors, zero
horizontal overflow, first render is a single HTML request plus API calls.
The service worker adds offline shell capability without adding any request
to the warm path (network-first navigation).
