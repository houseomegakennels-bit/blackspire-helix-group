# Unified Jarvis + Telegram Input Foundation

## Status and architecture

Implemented locally on `feature/unified-input-foundation`. Telegram-style and authenticated Jarvis/API inputs use one intake service and persist canonical conversations, inputs, tasks, events, and channel deliveries in the existing SQLite control plane. Permitted queued tasks continue through the existing worker and Hermes path.

`POST /api/unified-input` accepts a request plus an optional conversation ID and returns the canonical conversation, input, and task IDs. `GET /api/conversations/:id` returns shared task history and events; `/events?after=<event-id>` supports cursor polling. Telegram binds an allowed chat to the same conversation and receives sanitized task events from a retryable outbox.

## Security boundary

- Workspace existence, emergency stop, input size, idempotency, categorical live-trading/funds denial, and secret-exposure denial are enforced before provider execution.
- Telegram is an input/status channel, not an administrator. It cannot approve or reject work, deploy, merge, reset emergency stop, obtain secrets, or trade. Those actions remain behind authenticated Jarvis/API authority and existing approval policy.
- Task budgets come from the selected workspace and are checked before each provider attempt. Provider/mode attribution, usage, approvals, commands, changed files, and evidence remain canonical task records.
- Events and delivery errors pass through redaction. A channel delivery failure remains pending for retry and never changes task state.
- Conversation-bound Telegram task status and cancellation reject cross-conversation task IDs.
- Tests use a mock provider, mocked Telegram delivery, local temporary databases, and loopback-only API servers. No production credential or Telegram token is required.

## Rollback

Revert the local implementation commit before any deployment. The migration is additive, so older code ignores the new tables and nullable task columns. If an operator later needs to remove stored foundation data, first stop API/worker processes and take the normal SQLite backup; table removal is a separate destructive migration and is not part of this implementation.

## Future iPhone test

Only after a separate approval for a credential-free test environment:

1. In the mocked Telegram test client, send `/task Create a harmless status summary`.
2. Copy the returned conversation ID and canonical task ID.
3. Open authenticated Jarvis, paste the conversation ID into Conversation ID, and send `Report the canonical task history without changing files`.
4. Confirm Jarvis lists both canonical tasks and the Telegram-origin task events under the same conversation.
5. Create a harmless queued task, cancel it from Jarvis, and confirm the mocked Telegram client receives the sanitized `task.cancelled` event.
6. Confirm Telegram rejects `/approve`, `/deploy`, `/merge`, `/reset`, `/secret`, and `/trade` commands.

Do not use a real bot token, production credential, deployment, live trading account, or privileged Telegram command for this test.
