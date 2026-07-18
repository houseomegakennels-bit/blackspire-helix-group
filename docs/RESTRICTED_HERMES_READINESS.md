# Restricted Hermes Readiness Foundation

Blackspire is the final authority. The default runtime is `mock`: it uses the in-process mock Hermes selector and mock provider without credentials or network access. `restricted-test` permits only a credential-free HTTP endpoint on loopback. `production` is separate and cannot be inferred or entered through fallback.

The version 1 Hermes request is a narrow data contract: request and canonical conversation/task IDs; actor, workspace, and channel IDs; a normalized low-risk objective; permitted and denied capability classes; cost ceiling; deadline; cancellation, evidence, and idempotency references. It contains no approvals, credentials, environment values, hidden prompts, provider payloads, private paths, or authority-changing fields.

Every response has an exact schema and must preserve request, canonical, actor, workspace, channel, and budget values. Unknown versions, fields, providers, malformed JSON, and responses over 16 KiB fail closed. Hermes may select only a provider already allowlisted by Blackspire.

One dispatch guard is called before Hermes and before every provider attempt. It rechecks deterministic policy, task cancellation, emergency stop, deadline, workspace/channel identity, budget, provider allowlisting/configuration, runtime mode, and replay. Restricted test modes cannot select paid providers. There is no implicit provider fallback or default production credential.

The Command API is same-origin-only. `CORS_MODE=same-origin` documents that behavior; no permissive CORS headers are emitted. A cross-origin allowlist is not implemented because no verified requirement exists.

Configuration modes:

- `mock`: default, credential-free Hermes and provider; development/disposable state only.
- `restricted-test`: fake/local Hermes over loopback HTTP; mock provider only; no credential loading.
- `production`: separately approved configuration and credentials; never selected automatically by tests.
