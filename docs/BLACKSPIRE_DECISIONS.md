# Blackspire Decisions

## 2026-07-18

- GitHub repository `houseomegakennels-bit/blackspire-helix-group` is durable authority; canonical living memory is the `docs/BLACKSPIRE_*.md` set.
- Code, commits, tests, deployment evidence, and operator-confirmed results outrank summaries. Unsupported claims are `UNVERIFIED`.
- Persist canonical task/conversation state before channel delivery; delivery failure must remain observable and retryable.
- Deterministic policy precedes Hermes/providers. Telegram cannot grant privileged authority.
- Use mock Hermes, mock Telegram, loopback services, and disposable SQLite for credential-free acceptance.
- VPS is the planned sole production-state owner. Codespaces and Quick Tunnels are disposable and never uptime dependencies.
- GitHub headless authentication uses the root-owned Blackspire GitHub CLI wrapper with an operator-provided fine-grained personal access token; document the method only.
- Prefer Codex/code automation for safe repeatable work while preserving operator approval boundaries.
- Preserve unpublished commits and unrelated artifacts. Roll back shared work with reviewed reverts, not reset/history rewriting.
- Legacy `memory/`, `PROJECT_CONTEXT.md`, workflow, and delivery documents are historical evidence and are superseded for current-state recovery.
- Restricted Hermes receives only the versioned low-risk contract; Blackspire-owned identity, authority, canonical IDs, provider allowlist, budget, policy, cancellation, deadlines, replay, evidence, and emergency controls are immutable across the boundary.
- Runtime modes are explicit: mock is the credential-free default, restricted test permits only loopback fake Hermes with mock providers, and production can never be selected by fallback.
- The Command API remains tested same-origin-only; no permissive CORS behavior or misleading cross-origin promise is configured.
- Subscription Codex workers use only the official ChatGPT-authenticated Codex CLI with ephemeral, read-only, schema-bound execution; API-key conversion, direct Responses API calls, retries, fallback providers, and authentication-material access are prohibited.
