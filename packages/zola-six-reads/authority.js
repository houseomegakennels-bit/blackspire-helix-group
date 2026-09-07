// Fresh synthetic authority state only. Must run in the credential-scrubbed child.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createOfflineFixture, cases } from './offline.js';

export async function runAuthority(root) {
  assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('zola-six-read-'));
  const stat = fs.lstatSync(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700);
  assert.equal(fs.readdirSync(root).length, 0, 'disposable directory must be empty');
  process.env.BLACKSPIRE_DATA_DIR = root;
  process.env.BLACKSPIRE_DB_PATH = path.join(root, 'command.sqlite');
  process.env.BLACKSPIRE_RUNTIME_MODE = 'test';
  const { DB_PATH } = await import('../shared/config.js');
  assert.equal(DB_PATH, process.env.BLACKSPIRE_DB_PATH, 'cached configuration refused');
  const { prepareDisposableDatabase } = await import('../../tests/helpers/prepare-disposable-database.js');
  const { run, all, closeDb } = await import('../task-engine/db.js');
  try {
    prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
    const { upsertWorkspace } = await import('../workspace-registry/workspaces.js');
    const { createUnifiedInput } = await import('../unified-input/unified.js');
    const { getTask, taskRecords } = await import('../task-engine/tasks.js');
    const { processTask } = await import('../hermes/hermes.js');
    const { selectCapabilityForTask } = await import('../capabilities/execute.js');
    const fixture = createOfflineFixture();
    const now = Date.now();
    const basePermissions = ['task.create', 'task.execute', 'task.read', 'workspace.read'];
    const capabilityPermissions = ['seller.opportunities.read', 'buyer.profiles.read', 'buyer.matches.read', 'deal.records.read', 'deal.analysis.read', 'nexus.enrichment.read'];
    for (const workspace of [fixture.workspace, 'foreign-workspace']) upsertWorkspace({ id: workspace, name: workspace, githubRepository: 'houseomegakennels-bit/blackspire-helix-group', rootPath: '.', providerPolicy: { preferred: ['mock'] }, budgetCents: 0 });
    for (const principal of ['read-principal', 'denied-principal']) {
      run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [principal, 'admin', principal, 'bearer', null, 'active', now, null, null, null, 1, now]);
      run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [`grant-${principal}`, principal, fixture.workspace, 'service', JSON.stringify([...basePermissions, ...(principal === 'read-principal' ? capabilityPermissions : [])]), 'active', 1, null, now, null, null, 'fixture', 1, now]);
    }
    const objectives = ['Show seller opportunities', 'Find buyer profiles', 'Find buyer matches for deal DE-0001', 'Show active deals', 'Show underwriting for deal DE-0001', 'Show Nexus status for DE-0001'];
    let sequence = 0;
    function task(text, principal = 'read-principal', workspace = fixture.workspace) {
      const key = `six-read-${sequence++}`;
      const input = createUnifiedInput({ channel: 'jarvis', actorId: principal, channelKey: key, workspaceId: workspace, text, idempotencyKey: key, authority: 'authenticated_admin', executionIntent: 'read_only' });
      assert.ok(input.taskId, 'synthetic task creation failed');
      return getTask(input.taskId);
    }
    const evidence = [];
    for (const [index, entry] of cases.entries()) {
      const created = task(objectives[index]);
      assert.equal(selectCapabilityForTask(created).id, entry.id);
      const before = fixture.events.length;
      // Production dispatcher persists the attempt before invoking any HTTP adapter.
      const options = { capabilityOptions: { adapters: fixture.adapters, beforeAdapter: () => {
        const attempts = taskRecords(created.id).providerAttempts;
        assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'dispatching');
        assert.equal(JSON.parse(attempts[0].request_packet).principalId, 'read-principal');
      } } };
      assert.equal((await processTask(created, options)).status, 'completed', entry.id);
      const dispatchCount = fixture.events.slice(before).filter((event) => event.kind === 'route_dispatch').length;
      assert.equal(dispatchCount, 1);
      await processTask({ ...getTask(created.id), status: 'queued' }, options);
      assert.equal(fixture.events.slice(before).filter((event) => event.kind === 'route_dispatch').length, 1);
      const receipt = taskRecords(created.id).providerAttempts;
      assert.equal(receipt.length, 1); assert.equal(receipt[0].status, 'completed');
      assert.equal(receipt[0].provider, 'blackspire-capability');
      const completedResult = JSON.parse(receipt[0].response_packet).result;
      assert.ok(completedResult && Object.keys(completedResult).length > 0);
      for (const denied of [task(objectives[index], 'denied-principal'), task(objectives[index], 'read-principal', 'foreign-workspace')]) {
        const beforeDenial = fixture.events.length;
        assert.equal((await processTask(denied, { capabilityOptions: { adapters: fixture.adapters } })).status, 'failed');
        assert.equal(fixture.events.length, beforeDenial);
        assert.equal(taskRecords(denied.id).providerAttempts.length, 0);
      }
      evidence.push({ capability: entry.id, principal: 'read-principal', workspace: fixture.workspace, durableReceipt: 'PASS',
        attemptPersistedBeforeAdapter: 'PASS', duplicateDispatchPrevented: 'PASS', missingPermissionDenied: 'PASS', foreignWorkspaceDenied: 'PASS' });
    }
    // An actual post-handler response failure becomes outcome_unknown, then a
    // second invocation reconciles the durable state without replaying the read.
    const uncertain = task(objectives[0]); let calls = 0;
    const uncertainOptions = { capabilityOptions: { adapters: { ...fixture.adapters, sellerOpportunities: async (input) => {
      calls += 1; await fixture.adapters.sellerOpportunities(input); throw new Error('synthetic response loss');
    } } } };
    assert.equal((await processTask(uncertain, uncertainOptions)).status, 'outcome_unknown');
    await processTask({ ...getTask(uncertain.id), status: 'queued' }, uncertainOptions);
    assert.equal(calls, 1);
    assert.equal(taskRecords(uncertain.id).providerAttempts.length, 1);
    assert.equal(taskRecords(uncertain.id).providerAttempts[0].status, 'outcome_unknown');
    assert.equal(all("SELECT * FROM provider_attempts WHERE provider <> 'blackspire-capability'").length, 0);
    assert.equal(all('SELECT * FROM provider_usage WHERE cost_cents > 0').length, 0);
    assert.equal(fixture.events.filter((event) => /attempt$/.test(event.kind)).length, 0);
    return { scope: 'fresh SQLite actual dispatcher with synthetic division database', evidence, paidProviderCalls: 0,
      observedDivisionMutationAttempts: 0, lostResponseNotReplayed: 'PASS',
      limitations: ['No API/worker boot, production identities, row-owner database policies or live deployment exercised'] };
  } finally { closeDb(); }
}
