# Blackspire Active Context

Last reconciled: 2026-07-18 UTC. Verified baseline is local `db078a4`; canonical base is `origin/main` at `029e38a`.

Blackspire currently has two distinct surfaces: the Vercel-hosted Next.js public frontend and the root Node.js Blackspire Command control plane. Command includes Jarvis, Hermes orchestration, Telegram bridge code, deterministic policy/approvals, workspace and budget controls, evidence/audit, emergency controls, workers/providers, and SQLite persistence.

The Unified Input foundation and environment-readiness work is on local branch `feature/unified-input-foundation`. Its four original unpublished commits are preserved, backed up by `backup/unified-input-foundation-9bdfa5f`, and integrated non-destructively with `origin/main` by merge `b270ad3`. The locally fixed repository-creation regression now fails closed before Hermes/provider/worker dispatch; 139 full tests pass. Real Telegram and live providers remain disconnected/unverified.

The credential-free Restricted Hermes Readiness Foundation is locally verified at `ac3d887`. It adds a strict version 1 low-risk contract, exact and size-bounded response validation, a loopback-only fake restricted adapter, one Hermes/provider dispatch guard, explicit provider allowlisting with mock default, paid-provider isolation outside production, propagated deadlines/cancellation references, replay prevention, cancelled-state finality, and evidence redaction. The expanded suite has 148 tests; no real Hermes, credential, paid provider, or production surface was used.

A subscription-authenticated Codex worker adapter is implemented and locally tested. Codex CLI 0.144.5 reported ChatGPT authentication. An additional authorized diagnostic invocation exited nonzero with four structured stdout records, no stderr, timeout, signal, retry, fallback, or observed tool call. The response contract did not pass, canonical state remained failed, and disposable state was removed. The confirmed JSONL stdout classification defect is fixed locally; another live invocation is not authorized.

The VPS is the planned sole durable Command state owner. Codespaces are disposable development/recovery/test environments, currently limited by exhausted usage credit. Vercel remains the public frontend owner and must not be assumed to host stateful Command SQLite.

Operator iPhone Safari acceptance is complete at `eceb921`: harmless task, shared-conversation follow-up, idempotent replay, Telegram policy denial, eligible cancellation, and bounded mock delivery failure passed. The disposable application, authentication material, SQLite workspace, listener, and Quick Tunnel were removed and verified absent afterward. Active blockers are the unpublished implementation/integration commits and Codespaces budget. Live Command production state and the canonical Constitution location remain unverified. Monitoring Wave 1 is operator-recorded complete, but current dashboard/alert delivery is unverified.
