# Blackspire Decisions

## 2026-07-23

- The production listener binds loopback only. `vps-production` requires `BIND_HOST=127.0.0.1` and rejects wildcard (`0.0.0.0`, `::`, `*`), unspecified, and non-loopback addresses. The production application port is private and is never opened publicly; the reverse proxy is the only public surface.
- Production requires an explicit `PORT`. There is no default and no fallback to 8787. Malformed, privileged (< 1024), out-of-range, and the reserved `8787` (existing API/worker) and `8788` (restricted staging) ports are rejected.
- One canonical contract (`packages/shared/bind.js`) is the sole source of the host and port for the supervisor, the real `server.listen` call, `verifyVpsRuntime`, the shell preflight, the systemd unit, the nginx upstream, monitoring, and rollback. Divergent listener arguments fail closed in production.
- An occupied production port fails closed. The supervisor preflights with a read-only probe and the server exits on `EADDRINUSE`; neither ever terminates, signals, or modifies the existing listener, and neither retries or selects a fallback port at runtime.
- `8789` is the selected future production port, confirmed free by read-only inspection on 2026-07-23; `8790`-`8799` are the only reviewed fallbacks, chosen by `scripts/select-production-port.js` before activation and then set explicitly. This supersedes the earlier statement that the reverse proxy forwards to private app port 8787.

## 2026-07-22

- Root test-inventory authorization must never be derived from TAP, stdout/stderr, worker-writable artifacts, child IPC, or externally supplied paths. The trusted contract exists only in the parent process and is finalized after real `node:test` lifecycle events, child status, output EOF, process-tree reaping, identity revalidation, and sticky interruption checks.
- Test execution is Linux PID-namespace isolated with a PID-1 signal-forwarding reaper and a dedicated process group. Canonical test identity uses locale-independent UTF-8 byte order, no-follow descriptors, canonical containment, device/inode/type/link count, size/metadata, SHA-256 content, and full-tree mutation detection before and after execution.
- The contained suite executes from a parent-created snapshot containing only tracked and non-ignored files. The test identity is unprivileged, has no supplementary groups or Linux capability sets, runs with `no_new_privs`, and requires a ptrace restriction that prevents same-UID descendants from inspecting the trusted parent. Lifecycle transitions are validated at event arrival; later sorting is presentation-only and cannot repair an illegal causal order.
- The repository-root Vercel project is not an application deployment target: Blackspire Command is stateful and VPS-owned. Root `vercel.json` therefore always exits the Ignored Build Step successfully; the separate `frontend` Root Directory keeps its Next.js deployment behavior. Do not satisfy root checks by publishing Command files or inventing a static output directory.
- PR #30 was independently reviewed and merged into `main` as `588ea6e`. PR #29 remains OPEN/draft, now reconciled with merged `origin/main` by a merge commit; its former root Vercel blocker is repaired, but it is not authorized for merge and awaits a fresh independent exact-head review. Neither Gate 3 nor production activation is authorized.

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
