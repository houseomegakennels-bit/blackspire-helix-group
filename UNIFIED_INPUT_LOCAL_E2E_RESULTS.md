# Unified Input Local E2E Results

Date: 2026-07-18 UTC
Branch: `feature/unified-input-foundation`
Base: `cccfbba8dc56c086e0ff8e6bd5ca5d2bd972ba4e`
Implementation: `dddfb1bdbe48765753a0c37cf1c794e006578e55`

## Credential-free result

The isolated loopback validation passed using Node 22.23.1, mock Hermes, mock Telegram delivery, a temporary Git workspace, and temporary SQLite state.

- Telegram conversation: `conv_441af8846f93024e`
- Telegram task: `task_21c3cf092cc0c7e1`
- Jarvis follow-up task: `task_d0b683d745c68e6d`
- Jarvis reused the Telegram conversation: yes
- Mock provider attribution: `mock` / `mock`
- Non-loopback request attempts: 0
- Temporary server, repository, database, WAL files, and directory removed: yes

## Targeted commands

```bash
PATH=/opt/blackspire-staging/wave1/e2b/node-v22.23.1-linux-x64/bin:$PATH node --test --test-concurrency=1 tests/unified-input-e2e.test.js
PATH=/opt/blackspire-staging/wave1/e2b/node-v22.23.1-linux-x64/bin:$PATH node --test --test-concurrency=1 tests/unified-input.test.js tests/core.test.js tests/orchestration.test.js tests/hardening.test.js
PATH=/opt/blackspire-staging/wave1/e2b/node-v22.23.1-linux-x64/bin:$PATH node --test --test-concurrency=1 tests/jarvis.test.js tests/telegram-files.test.js tests/persistence.test.js tests/integration.test.js
```

Final targeted result: 70 passed, 0 failed, 0 skipped. Complete regression result: 125 passed, 0 failed, 0 skipped. The identifiers above are from the final complete regression. Two red E2E iterations exposed and corrected a fixture workspace mismatch and the missing cancellation-event import before the first passing run.

## Behavior verified

Canonical sharing, ordered events, Telegram replay protection, Jarvis idempotency, deterministic policy, workspace/budget/emergency-stop denial, provider attribution, authenticated cancellation lifecycle, sanitized cancellation delivery, bounded outbox failure, redaction, cross-channel binding denial, and external-call prevention all passed.

Real Telegram, production providers, paid APIs, production databases, Vercel, deployment, push, PR, merge, host security, and trading were not used.
