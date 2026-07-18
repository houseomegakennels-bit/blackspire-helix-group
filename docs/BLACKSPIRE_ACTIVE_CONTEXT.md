# Blackspire Active Context

Last reconciled: 2026-07-18 UTC. Verified implementation through local commit `9bdfa5f`; canonical base is `origin/main` at `cccfbba`.

Blackspire currently has two distinct surfaces: the Vercel-hosted Next.js public frontend and the root Node.js Blackspire Command control plane. Command includes Jarvis, Hermes orchestration, Telegram bridge code, deterministic policy/approvals, workspace and budget controls, evidence/audit, emergency controls, workers/providers, and SQLite persistence.

The Unified Input foundation and environment-readiness work exists in a clean separate worktree at local branch `feature/unified-input-foundation`, four commits ahead of its upstream. It is validated locally but not merged. Real Telegram and live providers remain disconnected/unverified.

The VPS is the planned sole durable Command state owner. Codespaces are disposable development/recovery/test environments, currently limited by exhausted usage credit. Vercel remains the public frontend owner and must not be assumed to host stateful Command SQLite.

Active blockers are unpublished implementation commits, Codespaces budget, missing device acceptance, unverified live Command production state, and unresolved canonical Constitution location. Monitoring Wave 1 is operator-recorded complete, but current dashboard/alert delivery is unverified.
