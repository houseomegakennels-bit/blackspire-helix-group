#!/usr/bin/env node
// Hermes development live smoke test (Milestone 2) — PREPARED, NOT auto-run.
//
// Runs ONE tightly-bounded live development call through the real Claude (Anthropic API) adapter to
// confirm the runtime end-to-end. It is credentialed and may incur a (tiny) cost, so it refuses to
// run unless an operator explicitly opts in AND the development gates are set. It never touches
// production, never mutates files, never runs shell, uses a temporary workspace, a tiny budget and
// timeout, stores only redacted events, produces a verifier result, and creates at most a pending
// memory candidate.
//
// Required to run (all of them):
//   HERMES_SMOKE_CONFIRM=i-understand-this-makes-a-paid-call
//   HERMES_RUNTIME_PROFILE=development
//   HERMES_DEV_REAL_PROVIDER=true
//   HERMES_DEV_PROVIDER_ALLOWLIST=anthropic
//   ANTHROPIC_API_KEY=<via the approved secret mechanism, never on argv>
//   BLACKSPIRE_DB_PATH=<a disposable database>
//
// This script is intentionally NOT wired into npm test or CI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const env = process.env;
  if (env.HERMES_SMOKE_CONFIRM !== 'i-understand-this-makes-a-paid-call') {
    console.error('refused: set HERMES_SMOKE_CONFIRM=i-understand-this-makes-a-paid-call to run the live smoke test');
    process.exit(2);
  }
  if (env.BLACKSPIRE_RUNTIME_MODE === 'production' || env.BLACKSPIRE_STATE_OWNER === 'vps-production') {
    console.error('refused: the smoke test must never run under the production profile');
    process.exit(2);
  }
  if (!env.ANTHROPIC_API_KEY) { console.error('refused: ANTHROPIC_API_KEY is not configured'); process.exit(2); }
  if (!env.BLACKSPIRE_DB_PATH || !env.BLACKSPIRE_DB_PATH.includes('smoke')) {
    console.error('refused: point BLACKSPIRE_DB_PATH at a disposable database whose path contains "smoke"');
    process.exit(2);
  }

  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-smoke-ws-'));
  const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
  const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
  upsertWorkspace({ id: 'hermes-smoke', name: 'hermes-smoke', description: 'disposable smoke workspace', githubRepository: 'local/smoke', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: ['true'], providerPolicy: { preferred: ['mock'] }, riskLevel: 'low', budgetCents: 5, secretReferences: [], enabledTools: ['status', 'read'], lastHealthStatus: 'ok', rootPath: workspaceRoot });

  // Harmless read-only status objective, tiny budget, short timeout.
  const result = await runHermesWorkflow(
    { id: 'hermes-smoke-1', workspace_id: 'hermes-smoke', request: 'report a one-line harmless status summary', source_channel: 'api', actor_id: 'operator', budget_cents: 5, idempotency_key: 'hermes-smoke-1', requestedProvider: 'anthropic' },
    { env: { ...env, HERMES_DEV_WORKSPACE_ALLOWLIST: workspaceRoot }, deadlineMs: 20_000 },
  );
  // Report only safe fields.
  console.log(JSON.stringify({ status: result.status, outcome: result.outcome, executionMode: result.executionMode, verified: result.verification?.passed ?? null, memoryCandidate: result.memoryCandidate?.created ? 'pending' : 'none' }, null, 2));
  try { fs.rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(result.status === 'completed' ? 0 : 1);
}

main().catch((e) => { console.error('smoke test error:', e?.message || e); process.exit(1); });
