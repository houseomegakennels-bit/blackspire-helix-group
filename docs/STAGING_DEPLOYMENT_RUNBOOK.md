# Isolated staging deployment runbook

## Safety contract

This runbook is for disposable, non-production state. It does not authorize changing the currently running staging service. Real provider calls and real Telegram delivery are INTENTIONALLY DISABLED.

## Verify a checkout

**VERIFIED:**

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm run security:scan
npm audit --audit-level=high
npm run production:preflight
```

Use the repository's bounded iPhone/PWA harness only with its documented disposable environment:

```bash
npm run start:iphone-test
npm run stop:iphone-test
```

The start command refuses unsafe profiles and the stop command only targets its managed test process. A shared staging-bot credential, public callback URL, DNS change, or service restart REQUIRES OPERATOR AUTHORIZATION and is not performed by these commands.

## Readiness

For an explicitly selected loopback service:

```bash
BLACKSPIRE_HEALTH_URL=http://127.0.0.1:<port> npm run health:check
```

Current `main` checks `/health`; dependency-specific `/ready` behavior is available only in the separate readiness lifecycle draft and is therefore PARTIALLY VERIFIED here.

## Pre-cutover recovery rehearsal

**TESTED WITH DISPOSABLE FIXTURES:** run the repository rehearsal before requesting any staging
cutover. This is evidence preparation, not deployment authorization:

```bash
npm run recovery:rehearse -- --root /tmp/blackspire-rehearsal-OPERATOR-UNIQUE --environment disposable-staging --operator-ack REHEARSE-DISPOSABLE-CUTOVER --commit <candidate-40-character-sha> --rollback <rollback-40-character-sha>
```

Only `GO_FOR_DISPOSABLE_REHEARSAL` permits recording that the temporary drill passed. It does not
permit a staging or production switch. A real target, backup, maintenance window, queue drain,
rollback release, credentials, and operator authorization must be verified separately.
