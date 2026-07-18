# Unified Jarvis Test Build Security Boundary

## Trust boundaries

1. GitHub authenticates access to the private Codespace forwarded URL.
2. Jarvis issues a separate short-lived test session in a Secure, HttpOnly, SameSite cookie after a request whose origin matches the exact temporary Codespace host.
3. CSRF validation protects every state-changing authenticated request.
4. The authenticated actor is fixed to `iphone-test-operator` and the workspace is fixed to `iphone-test`.
5. Unified Input runs deterministic Blackspire policy before the worker can dispatch mock Hermes.
6. Canonical state is written to disposable SQLite before mock Telegram delivery.

## Fail-closed controls

Test mode refuses startup unless `NODE_ENV=test`, mock Hermes, mock Telegram, a future expiry of at most four hours, and a disposable database path are present. It rejects configured Telegram, OpenAI, Anthropic, or Codex API credentials. The launcher removes those values before application imports and blocks non-loopback application fetches.

Test-only endpoints return `404` outside safe test mode. While enabled, the API allowlist excludes approvals, task pause/resume, evidence export, emergency controls, sessions administration, webhook ingestion, deployment, merge, repository creation, credential access, host security, budget increase, constitutional changes, trading, and funds actions.

## Data disclosure

The UI uses text-only DOM assignment for API data. It displays only canonical IDs, sanitized task state, event types/timestamps, provider/model attribution, evidence kinds, and delivery status/attempt counts. It does not expose raw logs, request packets, stack traces, environment values, workspace paths, authentication material, or evidence bodies.

No production database, provider, Telegram bot, public port, production URL, or paid API participates in this build.
