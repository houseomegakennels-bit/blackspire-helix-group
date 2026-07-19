# Jarvis UI — iPhone Test Guide

Manual acceptance guide for the rebuilt Jarvis PWA (`index.html`). This does
not replace `UNIFIED_INPUT_IPHONE_TEST_GUIDE.md` (test-mode surface, already
operator-accepted); it covers the production-contract console. Use only a
disposable local/tunnel environment with mock providers — never production
credentials.

## Setup

1. Start a disposable API (`BLACKSPIRE_DB_PATH` in a throwaway dir,
   `COMMAND_ADMIN_TOKEN` set, `HERMES_TEST_PROVIDER=mock`), expose it to the
   iPhone (LAN or Quick Tunnel; HTTPS required for service-worker install).
2. Open `/jarvis` in iPhone Safari. Verify dark chrome (`#04070C`) and no
   text-size zoom when tapping inputs (all inputs are 16px).

## Checks (each maps to a build requirement)

1. **Sign-in**: nav rail hidden; token field is password-type; wrong token →
   inline "Sign-in failed"; too many attempts → rate-limit message.
2. **Command slice**: submit a harmless command → accepted notice, jump to
   Conversation with canonical conversation ID + Copy; task appears with
   Queued state; Helix Core animates to Processing.
3. **Follow-up**: send from the follow-up composer → same conversation ID,
   second task in timeline.
4. **Duplicate**: hit Send twice fast → single task (button disables while
   in flight); resubmitting after a network drop reuses the idempotency key
   and shows "Duplicate submission" if the first arrived.
5. **Refresh recovery**: pull-to-refresh Safari on `#/conversation/<id>` and
   `#/task/<id>` → canonical state fully restored from the URL + backend.
6. **Cancellation**: open an eligible (queued) task → Cancel task →
   "Canonical cancellation recorded", events show cancellation_requested /
   cleanup / cancelled; Cancel disabled on terminal tasks.
7. **Approvals**: a `waiting_for_approval` task appears in Approval Center
   with risk class and explanation; Approve/Reject show only the server
   outcome (403 for non-elevatable tasks renders the server's message).
8. **Emergency stop**: two-step confirm; status rail badge flips to ACTIVE;
   Helix freezes red without flashing; reset requires second confirm.
9. **Offline/reconnect**: airplane mode → amber offline bar, Helix goes
   low-contrast static, System shows backoff; disable airplane mode →
   auto-reconnect and "Last sync" updates.
10. **Keyboard**: composer and Send remain visible with the keyboard open
    (page scrolls; nothing fixed covers them); no double submit via
    keyboard.
11. **Safe areas**: standalone PWA (Add to Home Screen) → content clears the
    notch and home indicator; installed icon is the Helix mark.
12. **Viewports**: 390×844 (iPhone 12/13/14), 393×852 (15/16), 430×932
    (Pro Max): no horizontal scroll anywhere, IDs wrap, touch targets ≥44px.
13. **Reduced motion**: Settings → Accessibility → Motion → Reduce Motion:
    Helix static, states still readable via labels and color.
14. **VoiceOver spot-check**: status rail announces; task state changes are
    announced (live region); mic button reads "Voice input (not yet
    enabled), dimmed".
15. **PWA update**: redeploy a changed `index.html`/`sw.js` → "A new Jarvis
    version is ready" bar; the page must NOT reload on its own — only after
    tapping Reload.
16. **Helix fallback**: block `/helix-core.js`, disable WebGL, and force a
    context loss when the optional route is available → the SVG core, labels,
    command composer, and navigation remain usable throughout.

## Evidence discipline

Record pass/fail per item with screenshots. Until this run is performed on a
real iPhone or Playwright WebKit, record its result as `UNVERIFIED`; static
tests are not a substitute. Tear down the disposable DB,
listener, and tunnel afterwards, as in the Unified Input teardown runbook.
