# Blackspire Active Context

Last reconciled: 2026-07-18 UTC. Verified implementation through local commit `9bdfa5f`; canonical base is `origin/main` at `cccfbba`.

Blackspire currently has two distinct surfaces: the Vercel-hosted Next.js public frontend and the root Node.js Blackspire Command control plane. Command includes Jarvis, Hermes orchestration, Telegram bridge code, deterministic policy/approvals, workspace and budget controls, evidence/audit, emergency controls, workers/providers, and SQLite persistence.

The Unified Input foundation and environment-readiness work is on local branch `feature/unified-input-foundation`. Its four original unpublished commits are preserved, backed up by `backup/unified-input-foundation-9bdfa5f`, and integrated non-destructively with `origin/main` by merge `b270ad3`. The locally fixed repository-creation regression now fails closed before Hermes/provider/worker dispatch; 139 full tests pass. Real Telegram and live providers remain disconnected/unverified.

The VPS is the planned sole durable Command state owner. Codespaces are disposable development/recovery/test environments, currently limited by exhausted usage credit. Vercel remains the public frontend owner and must not be assumed to host stateful Command SQLite.

Active blockers are unpublished implementation/integration commits, Codespaces budget, and operator iPhone device acceptance. The failed disposable staging surface was fully removed and not restarted during the policy fix; device acceptance requires a newly approved isolated restage from the fixed branch head. Live Command production state and the canonical Constitution location remain unverified. Monitoring Wave 1 is operator-recorded complete, but current dashboard/alert delivery is unverified.
