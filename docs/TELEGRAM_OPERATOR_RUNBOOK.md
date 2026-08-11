# Telegram operator runbook

## Current command surface

The implemented bridge in `apps/telegram/bot.js` supports `/start`, `/help`, `/task`, `/conversation`, `/tasks`, `/workspaces`, `/status` (or `/health`), and `/cancel`. `/halt`, `/resume`, and `/positions` are NOT YET IMPLEMENTED; do not advertise or rely on them.

Allowlisted users are configured through `TELEGRAM_ALLOWED_USERS`. Webhook mode requires `TELEGRAM_WEBHOOK_SECRET`. Token and webhook values are REQUIRES CREDENTIALS and must never be written to logs or this repository.

## Credential-free verification

```bash
npm test
```

The trusted suite covers allowlisting, duplicate protection, chunking, cancellation, webhook-secret validation, retryable delivery failure, and privileged-command denial with mocks.

## Starting a real bridge

```bash
npm run telegram:poll
```

This command REQUIRES CREDENTIALS and OPERATOR AUTHORIZATION. The reviewed production profile keeps Telegram dry-run/disconnected. Do not send a real message or activate polling/webhooks during staging validation unless an explicitly authorized sandbox bot is provided.

If delivery fails, preserve the task and outbox state, confirm the kill switch/status through the authenticated command API, and avoid replaying a command with a new idempotency identity.

