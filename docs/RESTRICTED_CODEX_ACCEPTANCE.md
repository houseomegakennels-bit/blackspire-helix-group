# Restricted Subscription Codex Acceptance

## 2026-07-18 normalized result

- Official client: Codex CLI 0.144.5, noninteractive `codex exec` interface.
- Authentication mode: ChatGPT subscription, verified with the official login-status command without inspecting authentication material.
- Invocation result: one attempted, zero successful, zero retries, zero fallback providers, and zero observed tool calls.
- Canonical task result: `failed`; the worker response did not pass the versioned response contract.
- Credential boundary: `OPENAI_API_KEY` was absent and explicitly removed from the child environment. No standalone OpenAI API request was made by Blackspire.
- Cleanup: disposable worker directory and SQLite state were removed after the attempt. No public listener, Telegram connection, production state, repository operation, or deployment was involved.

This is normalized failure evidence only. It contains no prompt/response payload, authentication material, account metadata, environment values, private runtime path, or internal stack trace. A second invocation was not attempted because the approval allowed exactly one.

## 2026-07-18 diagnostic invocation

- One additional invocation was attempted through the same official interface; no retry or fallback occurred.
- The child exited nonzero without a signal or timeout. Stdout was present (857 bytes), stderr was absent, and four structured JSONL records were detected before the final-output parser stage.
- Sanitized category: `nonzero_exit_with_structured_stdout_error`. The response contract did not validate and canonical task state remained failed.
- Confirmed adapter defect: nonzero failure classification inspected stderr but not structured JSONL error events written to stdout by `codex exec --json`. Classification now handles both channels without retaining their content.
- Zero tool calls were observed. No API key, standalone Responses API call, fallback provider, production access, Telegram connection, or repository operation was used.
- Disposable SQLite and worker state were removed and the diagnostic child terminated. No raw prompt, stdout, stderr, model reasoning, authentication material, account metadata, environment value, private runtime path, or stack trace was retained.
