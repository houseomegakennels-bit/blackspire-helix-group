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

The disconnected-session recovery reran the credential-free targeted suites and complete repository gates on 2026-07-18. The complete regression remained 130 passed, 0 failed, 0 skipped; build, lint, typecheck, secret scan, dependency audit, source-memory, and whitespace checks remained green. An initial attempt with the shell's Node 18.19.1 failed before application execution because `node:sqlite` is unavailable there; rerunning with the repository's required Node 22.23.1 runtime passed without code changes.

## Device acceptance

Pending creation of the private Codespace URL and operator execution in iPhone Safari.

The first approved VPS Quick Tunnel restage was stopped before device delivery after live validation found that “Create a new repository” returned HTTP 202. The disposable application, tunnel, authentication material, and SQLite state were removed. The local policy fix now returns HTTP 403 with zero Hermes/provider/worker dispatch and passed 7 focused policy tests, 35 focused integration tests, and the complete 139-test regression. A fresh isolated restage requires separate explicit approval.

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
