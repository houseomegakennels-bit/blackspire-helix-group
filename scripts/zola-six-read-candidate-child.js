#!/usr/bin/env node
// This executable requires the private network namespace and scrubbed environment
// created by supervise(). It never consumes a production configuration/credential.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

let server, reader, journal, closeDb;
const output = process.stdout.write.bind(process.stdout);
try {
  assert.equal(process.argv.length, 2);
  assert.equal(process.getuid(), 0);
  assert.deepEqual(Object.keys(process.env).sort(), ['NODE_NO_WARNINGS','PATH','ZOLA_CANDIDATE_PARENT_NET','ZOLA_SIX_READ_DISPOSABLE_DIR'].sort());
  assert.match(process.env.ZOLA_CANDIDATE_PARENT_NET, /^net:\[\d+\]$/);
  const namespace = fs.readlinkSync('/proc/self/ns/net');
  assert.notEqual(namespace, process.env.ZOLA_CANDIDATE_PARENT_NET);
  const command = (file, args) => execFileSync(file, args, { cwd: sourceRoot, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_NO_REPLACE_OBJECTS: '1' }, encoding: 'utf8', timeout: 2000, maxBuffer: 65536 });
  command('/usr/sbin/ip', ['link','set','lo','up']);
  const assertNetwork = () => {
    assert.equal(fs.readlinkSync('/proc/self/ns/net'), namespace);
    assert.deepEqual(JSON.parse(command('/usr/sbin/ip', ['-j','link','show'])).map(link => link.ifname), ['lo']);
    for (const family of ['-4','-6']) assert.equal(command('/usr/sbin/ip', [family,'route','show','default']).trim(), '');
  };
  assertNetwork();
  process.chdir(sourceRoot);
  const root = process.env.ZOLA_SIX_READ_DISPOSABLE_DIR;
  assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('zola-six-read-'));
  const stat = fs.lstatSync(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o777) === 0o700);
  assert.deepEqual(fs.readdirSync(root), []);
  const releaseSha = command('/usr/bin/git', ['rev-parse','--verify','HEAD']).trim();
  assert.match(releaseSha, /^[a-f0-9]{40}$/);
  // No clean-tree claim: sourceDigest records the actual reviewed working bytes.
  const token = randomBytes(32).toString('hex');
  Object.assign(process.env, { BLACKSPIRE_DATA_DIR: root, BLACKSPIRE_DB_PATH: path.join(root, 'command.sqlite'),
    BLACKSPIRE_RUNTIME_MODE: 'test', COMMAND_ADMIN_TOKEN: token, SESSION_SECRET: randomBytes(32).toString('hex'),
    ALLOW_BEARER_AUTH: 'true', BLACKSPIRE_OPERATOR_PRINCIPAL_ID: 'candidate-reader' });
  const { prepareDisposableDatabase } = await import('../tests/helpers/prepare-disposable-database.js');
  prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
  const db = await import('../packages/task-engine/db.js'); closeDb = db.closeDb;
  const { run, all } = db;
  const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
  const { createSession } = await import('../packages/shared/sessions.js');
  const { claimNext } = await import('../packages/task-engine/tasks.js');
  const { processTask } = await import('../packages/hermes/hermes.js');
  const { createOfflineFixture } = await import('../packages/zola-six-reads/offline.js');
  const { collectSixReads, readCases, digest } = await import('../packages/zola-six-reads/collector.js');
  const { openCollectorDatabaseReader, openCollectorJournal, createCollectorHttpBoundary, boundedRequest } = await import('../packages/zola-six-reads/collector-host.js');
  const fixture = createOfflineFixture({ releaseSha });
  upsertWorkspace({ id: fixture.workspace, name: 'Disposable candidate', githubRepository: 'local/candidate', rootPath: root, providerPolicy: { preferred: ['mock'] }, budgetCents: 0 });
  const now = Date.now();
  for (const principal of ['candidate-reader','candidate-denied']) run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [principal, 'admin', principal, 'bearer', null, 'active', now, null, null, null, 1, now]);
  run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['candidate-grant', 'candidate-reader', fixture.workspace, 'service', JSON.stringify(['task.create','task.execute','task.read','workspace.read', ...readCases('DE-0001').flatMap(c => c.permissions)]), 'active', 1, null, now, null, null, 'fixture', 1, now]);
  const deniedSession = createSession({ principalId: 'candidate-denied' });
  // API startup has a normal sanitized console line. Keep stdout machine-readable.
  console.log = (...values) => process.stderr.write(`${values.join(' ')}\n`);
  const { start } = await import('../apps/api/server.js');
  server = start(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const config = { version: 1, releaseSha, frontendOrigin: 'https://offline.invalid', workspace: fixture.workspace, principal: 'candidate-reader', deniedPrincipal: 'candidate-denied', dealId: 'DE-0001',
    apiPid: process.pid, workerPid: process.pid, port: server.address().port, databasePath: process.env.BLACKSPIRE_DB_PATH, credentialPath: '/unused', journalDirectory: root, runId: 'candidate' };
  reader = openCollectorDatabaseReader(config);
  journal = openCollectorJournal(root, 'candidate');
  const generation = { apiGeneration: namespace, workerGeneration: 'in-process-dispatcher', workerId: 'candidate-worker', apiPid: process.pid, workerPid: process.pid,
    apiStartTime: fs.readFileSync('/proc/self/stat','utf8').split(')').at(-1).trim().split(/\s+/)[19] };
  generation.workerStartTime = generation.apiStartTime;
  const host = { ...createCollectorHttpBoundary(config, { bearer: token, deniedCookie: `bc_session=${deniedSession.sessionId}` }),
    generation: async () => { assertNetwork(); assert.equal(server.address().address, '127.0.0.1'); reader.assertIdentity(); return structuredClone(generation); },
    lookup: key => reader.lookup(key),
    denialSnapshot: () => reader.denialSnapshot(),
    pause: async () => {
      const task = claimNext({ workerId: generation.workerId }); assert.ok(task);
      assert.equal((await processTask(task, { capabilityOptions: { adapters: fixture.syntheticAdapters } })).status, 'completed');
    } };
  const count = () => all('SELECT id FROM tasks').length;
  const beforeDenial = count();
  for (const headers of [{}, { authorization: 'Bearer invalid-candidate' }]) {
    const denial = await boundedRequest(config, '/api/unified-input', { method: 'POST', headers, body: { workspaceId: fixture.workspace, text: 'Show seller opportunities' } });
    assert.equal(denial.status, 401);
  }
  assert.equal(count(), beforeDenial);
  const report = await collectSixReads(config, host, journal);
  assert.equal(report.admissionDenial.status,'AUTHENTICATED_ADMISSION_DENIED');
  assert.equal(report.results.length, 6); assert.equal(report.livePass, false); assert.equal(count(), 6);
  const dispatchCount = fixture.events.filter(e => e.kind === 'route_dispatch').length;
  assert.equal(dispatchCount, 6);
  journal.close(); journal = openCollectorJournal(root, 'candidate');
  const replay=await collectSixReads(config, host, journal);
  assert.equal(replay.admissionDenial.reused,true);
  assert.equal(count(), 6); assert.equal(fixture.events.filter(e => e.kind === 'route_dispatch').length, dispatchCount);
  assert.equal(all("SELECT id FROM provider_attempts WHERE provider <> 'blackspire-capability'").length, 0);
  assert.equal(all('SELECT * FROM provider_usage WHERE cost_cents > 0').length, 0);
  assert.equal(fixture.events.filter(e => /attempt$/.test(e.kind)).length, 0);
  assertNetwork();
  const sourceFiles = ['packages/zola-six-reads/collector.js','packages/zola-six-reads/collector-host.js','packages/zola-six-reads/offline.js','scripts/zola-six-read-candidate-child.js','apps/api/server.js'];
  output(`${JSON.stringify({ version: 1, mode: 'candidate', status: 'PASS_ISOLATED_API_COLLECTOR', candidatePass: true, livePass: false, releaseSha,
    sourceDigestFiles: sourceFiles, sourceDigest: digest(sourceFiles.map(file => [file, digest(fs.readFileSync(path.join(sourceRoot, file),'utf8'))])),
    scope: 'Actual API HTTP admission/disclosure, SQLite claim/dispatcher/receipt and collector with synthetic frontend database in private loopback-only network namespace',
    results: report.results.map(row => ({ ...row, frontendIdentityScope: 'Synthetic route source, not deployed frontend identity', runtimeIdentityScope: 'Current checkout in disposable test process, not sealed production runtime' })), admissionDenial:report.admissionDenial, exactRerunNewTasks: 0, exactRerunNewDispatches: 0, anonymousWrongTokenAdmissions: 0,
    paidProviderCalls: 0, paidProviderScope: 'Child network namespace has only loopback, no default route; synthetic frontend executes in process', observedFixtureMutationAttempts: 0,
    remainingGates: ['Production systemd API/worker collector integration', 'Authoritative production division row deltas and owner-policy witnesses', 'Production egress containment and real frontend deployment pairing'] })}\n`);
} catch {
  process.stderr.write('Candidate API collector failed closed.\n'); process.exitCode = 1;
} finally {
  try { journal?.close(); reader?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } closeDb?.(); }
  catch { process.exitCode = 1; }
}
