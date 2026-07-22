# Blackspire Decisions

## 2026-07-22

- Root test-inventory authorization must never be derived from TAP, stdout/stderr, worker-writable artifacts, child IPC, or externally supplied paths. The trusted contract exists only in the parent process and is finalized after real `node:test` lifecycle events, child status, output EOF, process-tree reaping, identity revalidation, and sticky interruption checks.
- Test execution is Linux PID-namespace isolated with a PID-1 signal-forwarding reaper and a dedicated process group. Canonical test identity uses locale-independent UTF-8 byte order, no-follow descriptors, canonical containment, device/inode/type/link count, size/metadata, SHA-256 content, and full-tree mutation detection before and after execution.
- The repository-root Vercel project is not an application deployment target: Blackspire Command is stateful and VPS-owned. Root `vercel.json` therefore always exits the Ignored Build Step successfully; the separate `frontend` Root Directory keeps its Next.js deployment behavior. Do not satisfy root checks by publishing Command files or inventing a static output directory.
- PR #30 remains OPEN and draft pending an eligible submitted independent exact-head review. PR #29 remains OPEN/draft; its former root Vercel blocker is repaired, but neither PR is authorized for merge, and neither Gate 3 nor production activation is authorized.

## 2026-07-21

- PR #26 (repository durable-VPS readiness tooling) merged into `main` at `a9602496c0c0f3f50e62b63aeedfb348fa5da857` using a merge commit after independent review and independent second review (253/253 tests, zero confirmed defects). Reviewed history is preserved; squash and rebase were prohibited. The merge covers repository readiness tooling only and authorizes no host or production change.
- VPS production deployment stays gated behind six separately approved host-side blockers: reverse proxy/TLS, least-privileged non-root runtime ownership, installed and alert-tested monitoring/log rotation, approved production backup/migration, a recorded exact known-good live release/database rollback target, and readiness tooling incorporated into the deployment artifact.
- The intended durable production runtime is a non-root systemd service (`User=blackspire`, `Group=blackspire`) running `npm run start:production` from an immutable `/opt/blackspire-command/releases/<sha>` via the `current` symlink, with persistent state under `shared/`. TLS terminates at a reverse proxy that forwards to the private app port 8787 and preserves the application's own strict CSP and security headers rather than overriding them. Proxy/TLS and ownership plans are reviewed `ops/` templates and are never installed or applied by a repository change.

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
