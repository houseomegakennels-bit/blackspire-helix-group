# Unified Jarvis iPhone Acceptance Results

Date: 2026-07-18 UTC

## Automated pre-deployment result

The local iPhone test-mode contract passes against temporary SQLite, loopback API access, mock Hermes, and mock Telegram. It proves canonical sharing, policy denial before provider dispatch, read-only provider attribution, idempotency, cancellation, outbox failure isolation, mobile markup, and cleanup.

- Targeted iPhone test mode: 5 passed, 0 failed
- Targeted Unified Input, security, and Jarvis regression: 25 passed, 0 failed
- Complete repository regression: 130 passed, 0 failed, 0 skipped
- Build: passed
- Lint: passed
- Typecheck: passed
- Secret scan: passed
- Dependency audit: 0 vulnerabilities
- Launcher smoke: loopback status/UI passed; expiry cleanup reported `cleaned: true`

## Device acceptance

Pending creation of the private Codespace URL and operator execution in iPhone Safari.

| Scenario | Result |
|---|---|
| A. Happy path | Pending device run |
| B. Conversation reuse | Pending device run |
| C. Telegram policy denial | Pending device run |
| D. Cancellation | Pending device run |
| E. Delivery failure | Pending device run |
| F. Idempotency | Pending device run |
| G. Browser security inspection | Pending device run |

No screenshot is retained before device acceptance. Automated evidence is metadata-only and contains no session material, environment values, internal paths, or raw logs.
