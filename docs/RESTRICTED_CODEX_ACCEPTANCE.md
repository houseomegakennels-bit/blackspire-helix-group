# Restricted Subscription Codex Acceptance

## 2026-07-18 normalized result

- Official client: Codex CLI 0.144.5, noninteractive `codex exec` interface.
- Authentication mode: ChatGPT subscription, verified with the official login-status command without inspecting authentication material.
- Invocation result: one attempted, zero successful, zero retries, zero fallback providers, and zero observed tool calls.
- Canonical task result: `failed`; the worker response did not pass the versioned response contract.
- Credential boundary: `OPENAI_API_KEY` was absent and explicitly removed from the child environment. No standalone OpenAI API request was made by Blackspire.
- Cleanup: disposable worker directory and SQLite state were removed after the attempt. No public listener, Telegram connection, production state, repository operation, or deployment was involved.

This is normalized failure evidence only. It contains no prompt/response payload, authentication material, account metadata, environment values, private runtime path, or internal stack trace. A second invocation was not attempted because the approval allowed exactly one.
