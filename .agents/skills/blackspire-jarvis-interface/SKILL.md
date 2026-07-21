---
name: blackspire-jarvis-interface
description: Design, build, test, or review the Blackspire Jarvis mobile command PWA. Use for any Jarvis frontend interface, design-system, API-client, state, accessibility, Helix Core, PWA asset, iPhone layout, frontend security, or frontend test change.
---

# Blackspire Jarvis Interface

Keep this skill and `BLACKSPIRE_JARVIS_DESIGN_SYSTEM.md` aligned with the
implemented interface. Treat code and canonical backend contracts as the
source of truth; mark unsupported verification claims `UNVERIFIED`.

## Product purpose and operator

Build an iPhone-first instrument panel for one trusted Blackspire operator to
submit bounded commands, inspect canonical conversations, tasks, and events,
decide approvals, cancel eligible work, and read sanitized evidence. Keep the
browser observational and request-oriented: canonical server state always
wins, and the UI never creates authority or simulates privileged success.

## Engineering and security boundaries

- Preserve the dependency-free static PWA in `apps/jarvis-pwa/public`. Do not
  add remote scripts, fonts, images, models, analytics, trackers, secrets, or
  frontend command execution.
- Consume only existing backend routes and shapes. Document missing contracts
  in `JARVIS_UI_BACKEND_GAPS.md`; never implement backend, policy, Hermes,
  Telegram, provider, deployment, or infrastructure behavior here.
- Render backend content with DOM nodes and `textContent`, never unsafe HTML.
  Keep tokens, commands, evidence payloads, and credentials out of browser
  storage. Use URL hashes containing canonical IDs for refresh recovery.
- Treat approve, reject, cancel, emergency-stop, and reset controls as request
  surfaces. Report only the server response, then refresh canonical state.
  Disabled controls are usability affordances, not security controls.
- Keep the service worker network-only for API, auth, health, readiness, and
  privileged traffic. Cache only the Jarvis static shell; never replay a
  privileged request.

## Mobile-first behavior and data density

- Design first for 390×844, 393×852, and 430×932. Apply safe-area insets, keep
  inputs at 16px, make targets at least 44px, avoid horizontal overflow, and
  keep the composer usable above the software keyboard.
- Use a single column through phone widths and two columns only when space is
  genuinely useful. Prefer labeled facts and ordered timelines to raw JSON.
- Render identifiers in monospace with safe wrapping and adjacent copy
  controls. Render missing fields as `—` or an explicit “Not reported”.
- Filter task and conversation summaries to the active workspace. Never imply
  that a canonical ID alone grants access.

## Design tokens and materials

Use the authoritative CSS variables in `index.html`:

- `--void #04070C`, `--obsidian #080D15`, `--graphite #101826`,
  `--line #1C2A3D`
- `--white #EAF3F8`, `--muted #7C93AB`, `--ion #4FD8FF`,
  `--arc #A8E9FF`
- `--amber #F5B84A`, `--red #E25B5B`, `--green #57B98A`

Construct panels from flat obsidian or raised graphite, a 1px hairline, 16px
panel radius, and 12px control radius. Use smoked-glass depth through tonal
contrast rather than transparency. Reserve luminous treatment for the Helix
Core and focus rings. Avoid purple gradients, generic AI glow, excess blur,
fake telemetry, and decorative hex strings.

## Typography and spacing

- Display: local system UI, 600–800 weight, tight tracking.
- Body and controls: system UI at 15px/1.5; all editable controls remain 16px.
- Utility telemetry: `ui-monospace` at 12–13px.
- Use a 4px spacing system: 4, 8, 12, 16, 20, 24, 32.

## Status language

Use text plus color, consistently:

- `queued` → “Queued” / amber
- `running` → “Processing” / ion cyan
- `waiting_for_approval` → “Awaiting approval” / amber
- `completed` → “Completed” / desaturated green
- `failed` → “Failed” / restrained red
- policy denial → “Denied by policy” / restrained red
- `cancelled` → “Cancelled” / muted
- delivery pending, retrying, delivered, and terminal failure use those exact
  plain-language labels

Render unknown event types as sanitized “System event” entries without
assuming payload shape or allowing the timeline to crash.

## Blackspire Helix Core

Maintain the original Blackspire geometry: three nested tilted orbital paths,
task-state nodes, thin vector arcs, and a central nucleus. Keep the SVG/CSS
implementation permanently present and usable. Load the optional first-party
WebGL enhancement dynamically and never await it during boot, submission, or
navigation. Use no downloaded model, texture, expensive shadow, or
postprocessing. Cap DPR at 1.5, pause while hidden, honor reduced motion,
recover from context loss, and destroy resources on `pagehide`.

Map real state to motion and labels: dormant slow pulse; listening expanding
input ring; processing controlled orbits; approval interrupted amber orbit;
completed stable alignment; denied locked red; cancelled winding down;
offline dim static; emergency frozen red. Never reproduce Marvel, Iron Man,
Arc Reactor, Stark, film HUD, dialogue, sound, or character imagery.

## Animation and icons

Use 160ms ease-out for direct feedback and restrained long-duration motion for
the Helix. Stop all nonessential animation under reduced motion and while the
page is hidden. Never flash or animate emergency red aggressively. Draw icons
as original inline 24×24 SVGs with 1.75px round strokes, `currentColor`,
`aria-hidden="true"`, and adjacent visible labels.

## Accessibility requirements

Preserve semantic landmarks, logical keyboard order, visible focus, explicit
labels, correct button semantics, polite live regions for state changes,
color-independent statuses, WCAG AA contrast, 44px touch targets, no flashing,
and an offscreen Helix state equivalent. Keep loading, empty, offline,
reconnecting, stale, and error states actionable and plain-language.

## Component naming

Use product-language names: Command Center, Conversation View, Task Detail,
Event Timeline, Approval Center, System Status, Evidence View, Helix Core,
status rail, fact, state pill, channel chip, and command composer. Do not name
components after implementation libraries or film references.

## Visual regression checklist

Before declaring completion, verify all three iPhone viewports; safe areas;
keyboard-safe composer; long IDs; copy controls; readable event ordering;
focus order and focus visibility; live regions; reduced motion; hidden-tab
polling; offline and reconnect messaging; refresh recovery; standalone PWA
chrome; SVG fallback; WebGL failure/context loss; no external requests; and no
horizontal overflow. Run the targeted Jarvis tests, full suite, build, lint,
typecheck, dependency/license/secret audits, and `git diff --check`. If a real
browser cannot run, record browser and screenshot results as `UNVERIFIED`.
