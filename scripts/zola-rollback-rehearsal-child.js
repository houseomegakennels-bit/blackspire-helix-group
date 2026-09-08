#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { computeArtifactDigest } from '../packages/shared/release-evidence.js';
import { createRehearsalIntake, RECOVERY_SHA, RECOVERY_ARTIFACT, INTAKE_PATH, RETIRED_PATHS } from '../packages/zola-rollback/intake.js';
import { rehearseRecoveryBoot } from '../packages/zola-rollback/boot.js';

try {
  assert.equal(process.argv.length, 2);
  assert.deepEqual(Object.keys(process.env).sort(), ['PATH', 'NODE_NO_WARNINGS', 'ZOLA_SIX_READ_DISPOSABLE_DIR', 'ZOLA_CANDIDATE_PARENT_NET'].sort());
  assert.equal(process.getuid(), 0);
  assert.match(process.env.ZOLA_CANDIDATE_PARENT_NET, /^net:\[\d+\]$/);
  const namespace = fs.readlinkSync('/proc/self/ns/net');
  assert.notEqual(namespace, process.env.ZOLA_CANDIDATE_PARENT_NET);
  const assertNetwork = () => {
    assert.equal(fs.readlinkSync('/proc/self/ns/net'), namespace);
    const ip = args => execFileSync('/usr/sbin/ip', args, { encoding: 'utf8', timeout: 2000, maxBuffer: 65536,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
    assert.deepEqual(JSON.parse(ip(['-j', 'link', 'show'])).map(link => link.ifname), ['lo']);
    for (const family of ['-4', '-6']) assert.equal(ip([family, 'route', 'show', 'default']).trim(), '');
  };
  assertNetwork();
  const { createOfflineFixture, cases } = await import('../packages/zola-six-reads/offline.js');
  const { prepareDisposableDatabase } = await import('../tests/helpers/prepare-disposable-database.js');
  const artifact = `/var/lib/blackspire-zola-rehearsal/releases/${RECOVERY_SHA}`;
  assert.equal(fs.readFileSync(path.join(artifact, 'COMMIT_SHA'), 'utf8').trim(), RECOVERY_SHA);
  assert.equal(computeArtifactDigest(artifact), RECOVERY_ARTIFACT);
  const root = process.env.ZOLA_SIX_READ_DISPOSABLE_DIR;
  assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('zola-six-read-'));
  const stat = fs.lstatSync(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700);
  assert.equal(fs.readdirSync(root).length, 0);
  process.env.BLACKSPIRE_DB_PATH = path.join(root, 'command.sqlite');
  process.env.BLACKSPIRE_DATA_DIR = root;
  process.env.BLACKSPIRE_RUNTIME_MODE = 'test';
  // Run the artifact's own migration entrypoint, through the approved disposable boundary.
  const cwd = process.cwd(); process.chdir(artifact);
  try { prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH); } finally { process.chdir(cwd); }
  const boot = await rehearseRecoveryBoot({ artifact, root });
  const load = (name) => import(pathToFileURL(path.join(artifact, name)).href);
  const { DB_PATH } = await load('packages/shared/config.js');
  assert.equal(DB_PATH, process.env.BLACKSPIRE_DB_PATH);
  const { run, all, closeDb } = await load('packages/task-engine/db.js');
  try {
    for (const table of ['tasks', 'unified_inputs', 'conversations', 'provider_attempts', 'provider_usage']) {
      assert.equal(all(`SELECT COUNT(*) AS count FROM ${table}`)[0].count, 0);
    }
    const { upsertWorkspace } = await load('packages/workspace-registry/workspaces.js');
    const { resolveAdminBearer, requireWorkspacePermission } = await load('packages/shared/authorization.js');
    const { createUnifiedInput } = await load('packages/unified-input/unified.js');
    const { getTask, claimNext, taskRecords } = await load('packages/task-engine/tasks.js');
    const { selectCapabilityForTask } = await load('packages/capabilities/execute.js');
    const { processTask } = await load('packages/hermes/hermes.js');
    const fixture = createOfflineFixture();
    const principalId = 'recovery-owner'; const token = randomBytes(32).toString('base64url');
    const apiGeneration = randomUUID(); let workerGeneration = randomUUID();
    const originalWorkerGeneration = workerGeneration;
    const now = Date.now();
    const permissions = ['task.create', 'task.execute', 'task.read', 'workspace.read', 'seller.opportunities.read', 'buyer.profiles.read', 'buyer.matches.read', 'deal.records.read', 'deal.analysis.read', 'nexus.enrichment.read'];
    upsertWorkspace({ id: fixture.workspace, name: 'Recovery isolated reads', githubRepository: 'local/recovery', rootPath: root, providerPolicy: { preferred: ['mock'] }, budgetCents: 0 });
    run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [principalId, 'admin', principalId, 'bearer', null, 'active', now, null, null, null, 1, now]);
    run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['recovery-grant', principalId, fixture.workspace, 'service', JSON.stringify(permissions), 'active', 1, null, now, null, null, 'fixture', 1, now]);
    const handle = createRehearsalIntake({ recoverySha: RECOVERY_SHA, artifactSha256: RECOVERY_ARTIFACT, token, principalId,
      workspaceId: fixture.workspace, apiGeneration, workerGeneration,
      currentGenerations: () => ({ apiGeneration, workerGeneration }), resolvePrincipal: resolveAdminBearer,
      requirePermission: requireWorkspacePermission, admit: createUnifiedInput });
    const request = (entry, changes = {}) => ({ method: 'POST', rawPath: INTAKE_PATH, authorization: `Bearer ${token}`, contentType: 'application/json',
      bodyBytes: Buffer.from(JSON.stringify({ version: 1, workspaceId: fixture.workspace, principalId, capabilityId: entry.id,
        apiGeneration, workerGeneration: originalWorkerGeneration, requestId: randomUUID(),
        ...(['buyer.matches.search', 'deal.analysis.get', 'nexus.enrichment.status'].includes(entry.id) ? { dealId: 'DE-0001' } : {}) })), ...changes });
    const snapshot = () => ['tasks', 'unified_inputs', 'conversations', 'provider_attempts', 'audit_events'].map((table) => all(`SELECT * FROM ${table} ORDER BY rowid`));
    const before = snapshot();
    for (const rawPath of RETIRED_PATHS) assert.equal(handle(request(cases[0], { rawPath })).status, 404);
    assert.equal(handle(request(cases[0], { authorization: undefined })).status, 404);
    assert.deepEqual(snapshot(), before);
    const reads = [];
    for (const entry of cases) {
      const req = request(entry); const admission = handle(req);
      assert.equal(admission.status, 202);
      assert.equal(handle(req).taskId, admission.taskId);
      const task = claimNext({ workerId: workerGeneration });
      assert.equal(task.id, admission.taskId); assert.equal(selectCapabilityForTask(task).id, entry.id);
      assert.equal((await processTask(task, { workerId: workerGeneration, claimToken: task.claim_token, capabilityOptions: { adapters: fixture.adapters } })).status, 'completed');
      const attempts = taskRecords(task.id).providerAttempts;
      assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'completed');
      assert.equal(getTask(task.id).actor_id, principalId);
      reads.push({ capability: entry.id, admission: 'PASS', durableReceipt: 'PASS', transport: 'synthetic actual current frontend routes' });
    }
    // Hold an actual recovery adapter result, reclaim through claimNext, then
    // release the stale worker result. It must not finalize under the new claim.
    const staleAdmission = handle(request(cases[0])); assert.equal(staleAdmission.status, 202);
    const staleTask = claimNext({ workerId: workerGeneration });
    let signalStarted; let releaseResult;
    const started = new Promise((resolve) => { signalStarted = resolve; });
    const held = new Promise((resolve) => { releaseResult = resolve; });
    let staleCalls = 0;
    const adapters = { ...fixture.adapters, sellerOpportunities: async (input) => {
      staleCalls += 1; const result = await fixture.adapters.sellerOpportunities(input);
      signalStarted(); await held; return result;
    } };
    const processing = processTask(staleTask, { workerId: workerGeneration, claimToken: staleTask.claim_token, capabilityOptions: { adapters } });
    await started;
    run("UPDATE tasks SET heartbeat_at='2000-01-01T00:00:00.000Z' WHERE id=?", [staleTask.id]);
    const reclaimed = claimNext({ workerId: 'replacement-worker', staleAfterSeconds: 1 });
    assert.equal(reclaimed.id, staleTask.id); assert.notEqual(reclaimed.claim_token, staleTask.claim_token);
    releaseResult(); await processing;
    assert.notEqual(getTask(staleTask.id).status, 'completed');
    await processTask(getTask(staleTask.id), { workerId: reclaimed.worker_id, claimToken: reclaimed.claim_token, capabilityOptions: { adapters } });
    assert.equal(staleCalls, 1); assert.equal(getTask(staleTask.id).status, 'outcome_unknown');
    assert.equal(taskRecords(staleTask.id).providerAttempts.length, 1);
    assert.notEqual(taskRecords(staleTask.id).providerAttempts[0].status, 'completed');
    const completed = snapshot();
    workerGeneration = randomUUID();
    assert.equal(handle(request(cases[0])).status, 404);
    assert.deepEqual(snapshot(), completed);
    workerGeneration = originalWorkerGeneration;
    run("UPDATE auth_workspace_grants SET status='superseded' WHERE id='recovery-grant'");
    const revoked = snapshot(); assert.equal(handle(request(cases[0])).status, 404); assert.deepEqual(snapshot(), revoked);
    assert.equal(all('SELECT * FROM provider_usage WHERE cost_cents > 0').length, 0);
    assert.equal(fixture.events.filter((event) => /attempt$/.test(event.kind)).length, 0);
    assertNetwork();
    process.stdout.write(`${JSON.stringify({ scope: 'isolated recovery admission and dispatch', recoverySha: RECOVERY_SHA, artifactDigest: RECOVERY_ARTIFACT,
      networkIsolation: 'private kernel namespace; only loopback; no IPv4/IPv6 default route before and after rehearsal',
      productionAccepted: false, boot, reads, retiredWrapperPathsDenied: true, revokedGrantDenied: true, staleAdmissionGenerationDenied: true, staleWorkerResultRejected: true, reclaimedDispatchNotReplayed: true,
      syntheticMutationAttempts: 0, paidProviderCalls: 0, intendedAuthorizationAuditAppends: all('SELECT COUNT(*) AS count FROM auth_decisions')[0].count,
      limitations: ['No canonical services or live frontend URL containment', 'No production database or owner policies', 'Dispatch generation supplied by fixture; systemd supervisor fence acceptance still required', 'Recovery backend uses current offline route fixtures; no recovery frontend live claim'] })}\n`);
  } finally { closeDb(); }
} catch { process.stderr.write('isolated recovery child failed\n'); process.exitCode = 1; }
