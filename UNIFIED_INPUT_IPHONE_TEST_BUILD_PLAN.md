# Unified Jarvis iPhone Test Build Plan

Date: 2026-07-18 UTC
Branch: `feature/unified-input-foundation`
Base: `cccfbba8dc56c086e0ff8e6bd5ca5d2bd972ba4e`
Implementation: `dddfb1bdbe48765753a0c37cf1c794e006578e55`
Local validation: `875a78e252f0c2b173248826f3ac715f32fe3ff9`

## Deployment choice

Use one private, disposable GitHub Codespace with an authenticated HTTPS forwarded port. Transfer the local commit with a Git bundle; do not push a branch or use a Vercel project. The application binds to loopback, and the Codespace port remains private to the authenticated GitHub operator.

Vercel preview was rejected for this build because the current API and worker are long-running processes sharing one SQLite database. A stateless preview would not provide the required canonical persistence boundary.

## Runtime

- Start `npm run start:iphone-test` on Node 22.5 or newer.
- Generate a disposable data directory, SQLite database, test session material, actor, workspace, and two-hour expiry.
- Unset Telegram and provider credentials before importing application code.
- Enable only mock Hermes and mock Telegram delivery.
- Block application fetches to non-loopback destinations.
- Serve the private mobile test UI and test-only API routes.
- Stop and delete state on signal or expiry.

## Acceptance

Validate the harmless status task, same-conversation Jarvis follow-up, deterministic Telegram denial, eligible cancellation, outbox retry/failure visibility, idempotent replay, ordered events, provider/model attribution, redaction, and lack of privileged controls.
