# Unified Input First iPhone Test Guide

This build is approved. Use only the private temporary URL recorded in the test-build status after deployment.

## Approved boundary

Use a non-production iPhone-accessible test build backed by disposable state, mock Hermes, and mock Telegram delivery. Use test-only authentication and sanitized fixtures. Do not connect a real Telegram bot, paid provider, production database, production domain, or live infrastructure.

## Acceptance flow

1. Open the test Jarvis build on iPhone Safari and authenticate with a test-only session.
2. Submit `Report the current task status without changing files.` and copy the displayed conversation/task IDs.
3. Tap **Submit follow-up** and confirm the same conversation ID remains displayed.
4. Confirm both tasks, ordered events, provider attribution, and delivery state appear in the same conversation.
5. Cancel an eligible queued task in Jarvis and confirm cancellation request, cleanup, final state, and mock Telegram event.
6. Simulate a delivery failure and confirm bounded attempts are visible without changing task state.
7. Confirm restricted Telegram requests are denied and all displayed secret-shaped fixtures are redacted.
8. Send the observed results to the agent, then remove the test build and disposable state after evidence capture.

The TEST MODE banner and expiry must remain visible throughout the run. Stop if either is missing.
