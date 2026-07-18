# Unified Input First iPhone Test Guide

This guide is approval-gated. Do not begin it from this validation record alone.

## Approved future boundary

Use a non-production iPhone-accessible test build backed by disposable state, mock Hermes, and mock Telegram delivery. Use test-only authentication and sanitized fixtures. Do not connect a real Telegram bot, paid provider, production database, production domain, or live infrastructure.

## Acceptance flow

1. Open the test Jarvis build on iPhone Safari and authenticate with a test-only session.
2. Use the mock Telegram client to create a harmless task and capture its conversation/task IDs.
3. Enter that conversation ID in Jarvis and submit a harmless follow-up.
4. Confirm both tasks, ordered events, provider attribution, and delivery state appear in the same conversation.
5. Cancel an eligible queued task in Jarvis and confirm cancellation request, cleanup, final state, and mock Telegram event.
6. Simulate a delivery failure and confirm bounded attempts are visible without changing task state.
7. Confirm restricted Telegram requests are denied and all displayed secret-shaped fixtures are redacted.
8. Remove the test build and disposable state after evidence capture.

## Exact next approval prompt

> Approve the first real iPhone test build for Unified Jarvis using only a non-production test URL, disposable local/test SQLite state, mock Hermes, mock Telegram delivery, test-only authentication, and sanitized fixtures. Do not connect a real Telegram bot, use production credentials or providers, make paid API calls, use a production database, change DNS or host security, deploy to production, push, open a PR, merge, trade, or move funds. Build the temporary iPhone-accessible test surface, run the documented acceptance flow, capture sanitized evidence, and remove the test build and state afterward.
