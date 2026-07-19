# Blackspire Jarvis Design System

Companion to `.agents/skills/blackspire-jarvis-interface/SKILL.md` (the two
must stay consistent). Applies to the Jarvis PWA only
(`apps/jarvis-pwa/public/`), not the Vercel public frontend.

## Direction

A cinematic engineering command instrument: obsidian and smoked-glass
materials, disciplined ion-cyan light, layered telemetry set in monospace,
one luminous signature (the Blackspire Helix Core) and quiet everything else.
It evokes precision aerospace instrumentation without copying any film or
Marvel property. The product name is Blackspire Jarvis.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--void` | `#04070C` | Page background (near-black blue) |
| `--obsidian` | `#080D15` | Panel fill |
| `--graphite` | `#101826` | Raised surfaces, inputs |
| `--line` | `#1C2A3D` | Hairline borders, dividers |
| `--white` | `#EAF3F8` | Primary text (controlled white) |
| `--muted` | `#7C93AB` | Secondary text, dormant states |
| `--ion` | `#4FD8FF` | Primary luminous accent, active/processing |
| `--arc` | `#A8E9FF` | Pale electric highlights, values |
| `--amber` | `#F5B84A` | Pending, attention, awaiting approval |
| `--red` | `#E25B5B` | Denied, failed, emergency, destructive |
| `--green` | `#57B98A` | Confirmed healthy / completed only |

Prohibited: purple-on-white AI gradients, neon overload, bloom stacks,
unreadable transparency, glow on more than one element per viewport,
decorative hex strings, invented metrics, decorative charts.

## Typography

System-hosted stacks only (no font route exists yet; remote fonts are
prohibited — see `JARVIS_UI_BACKEND_GAPS.md` for the Fontsource plan:
Oxanium Variable display / Sora Variable body / JetBrains Mono Variable
telemetry, all SIL OFL-1.1).

| Role | Stack | Treatment |
|---|---|---|
| Display | `system-ui, -apple-system, sans-serif` | 20–28px, weight 700, −0.01em |
| Eyebrow | same | 11px, weight 700, uppercase, +0.14em, `--muted`/`--ion` |
| Body / controls | same | 15px/1.5, weight 400–600 |
| Telemetry / IDs | `ui-monospace, SFMono-Regular, Menlo, monospace` | 12–13px, `overflow-wrap:anywhere` |

## Spacing, radius, borders

Base-4 scale: 4/8/12/16/20/24/32. Panels radius 16, controls 12, pills 999.
Borders are 1px `--line`; the Helix card and `:focus-visible` are the only
luminous borders. Touch targets ≥44px. Content column `min(100%, 560px)`
on phones, two columns ≥760px.

## Motion

| Class | Duration | Notes |
|---|---|---|
| Micro (press, copy, badge) | 160ms ease-out | |
| Panel / view change | 320ms ease | opacity+4px translate |
| Animated list entry | 240ms, 40ms stagger | adapted concept from Magic UI (MIT), re-implemented |
| Helix orbits | 20–36s linear | pauses when page hidden |
| Reduced motion | ≤200ms opacity only | Helix frozen, states shown by color+label |

No flashing, no rapidly pulsing emergency effects: emergency red is static.

## Status language (single vocabulary everywhere)

| Canonical | Label | Color |
|---|---|---|
| `queued` | Queued | amber |
| `running` | Processing | ion |
| `waiting_for_approval` | Awaiting approval | amber |
| `completed` | Completed | green |
| `failed` + `policy_decision=denied` | Denied by policy | red |
| `failed` | Failed | red |
| `cancelled` | Cancelled | muted |
| delivery `pending` (0 attempts) | Delivery pending | amber |
| delivery `pending` (>0 attempts) | Retrying delivery | amber |
| delivery `delivered` | Delivered | green |
| delivery `failed` | Delivery failed (terminal) | red |
| unknown event type | System event | muted |

Status is always label + color, never color alone.

## The Blackspire Helix Core

Original signature: a vertical spire — three nested elliptical orbits tilted
about the y-axis, each carrying luminous orbit nodes, crossed by thin dashed
vector arcs, around a concentric nucleus whose restrained energy field is a
radial gradient. The SVG/CSS core is permanent and fully functional. A
first-party native WebGL layer in `helix-core.js` is dynamically imported as
an optional enhancement; it uses no external asset, model, texture, expensive
shadow, or postprocessing and never gates navigation or submission. The
current backend does not serve its route, so runtime loading remains a
documented backend gap and the SVG path remains visible.

State map: dormant (slow 6s nucleus pulse) · listening (expanding input
ring) · processing (orbital rotation) · awaiting approval (amber, orbit
dash interrupted) · completed (stable cyan alignment) · denied (static red
lock ring) · cancelled (orbit decelerates and dims) · offline (low-contrast
static) · emergency stop (frozen red, no animation). Screen readers get an
offscreen text equivalent; `prefers-reduced-motion` freezes all orbits. The
enhancement caps DPR at 1.5, pauses while hidden, destroys resources on
`pagehide`, and falls back after load, WebGL, or context failure.

## Security boundary in design terms

No secrets, env dumps, headers, cookies, hidden prompts, chain of thought,
raw stack traces, or internal paths ever render. Evidence views show only
sanitized kinds/metadata from the backend. Buttons never imply an authority
the server hasn't granted; denial states are rendered exactly as returned.

## Visual regression checklist

1. 390×844, 393×852, 430×932 — no horizontal overflow, safe-area respected.
2. Keyboard open — composer and submit visible, no double submit.
3. Long conversation/task IDs wrap and copy.
4. All six task states + denial render with correct label/color.
5. Helix Core state transitions; SVG fallback; WebGL failure/context loss;
   reduced-motion freeze; hidden-page pause.
6. Offline banner and stale "last synced" label appear when disconnected.
7. Focus order and visible focus on every interactive element.
8. Dark iOS chrome (`theme-color`) and standalone display verified.
