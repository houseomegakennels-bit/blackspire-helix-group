import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-codex-contract-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'test.sqlite');

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { activeModes, codexCliAvailable, resolveProviderAvailability, parseCodexCliResult, runCodexCliPacket, runCliChild } = await import('../packages/providers/providers.js');
const { createTask, claimNext, heartbeat, transition, prepareCodexDispatch, finishCodexDispatch, finishCodexDispatchWithUsage, recordUsage, taskRecords, monetarySpend, getTask } = await import('../packages/task-engine/tasks.js');
const { closeDb, execSql, query } = await import('../packages/task-engine/db.js');
const { upsertWorkspace, quarantineKeys, quarantineWorkspace, workspaceDispatchEligibility, recoverWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { guardDispatch } = await import('../packages/execution/dispatchGuard.js');

const bin = path.join(root, 'bin');
fs.mkdirSync(bin, { recursive: true });
process.env.CODEX_HOME = path.join(root, 'codex-home');
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env bash
if [[ -n "\${COMMAND_ADMIN_TOKEN:-}" || -n "\${SESSION_SECRET:-}" || -n "\${GITHUB_TOKEN:-}" || -n "\${OPENAI_API_KEY:-}" || -n "\${ANTHROPIC_API_KEY:-}" || -n "\${CODEX_API_KEY:-}" ]]; then
  exit 66
fi
case "\${1:-}" in
  --version) printf 'codex-cli 999.0.0-test\\n' ;;
  doctor) printf '{"schemaVersion":1,"checks":{"auth.credentials":{"status":"ok"},"network.provider_reachability":{"status":"ok"},"network.websocket_reachability":{"status":"ok"},"installation":{"status":"fail"}}}\\n'; exit "\${TEST_CODEX_DOCTOR_EXIT:-0}" ;;
  *) exit 64 ;;
esac
`);
fs.chmodSync(path.join(bin, 'codex'), 0o755);
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

function jsonlFinal(summary = 'ok') {
  return [
    { type: 'thread.started', thread_id: 't1' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'message', message: { content: [{ text: 'progress only' }] } } },
    { type: 'turn.completed' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

test('real-shaped Codex JSONL is parsed only through the terminal final output', () => {
  const final = path.join(root, 'final.json');
  fs.writeFileSync(final, JSON.stringify({ artifacts: [{ path: 'docs/x.md', content: 'ok' }], summary: 'done' }));
  const parsed = parseCodexCliResult({ status: 0, stdout: jsonlFinal(), stderr: '' }, final);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.summary, 'done');
  assert.equal(parsed.artifacts[0].path, 'docs/x.md');
});

test('malformed JSONL is refused', () => {
  const parsed = parseCodexCliResult({ status: 0, stdout: '{"type":"turn.started"}\nnot-json\n', stderr: '' });
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /malformed JSONL/);
});

test('missing terminal Codex result is refused', () => {
  const parsed = parseCodexCliResult({ status: 0, stdout: '{"type":"turn.started"}\n', stderr: '' });
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /terminal result/);
});

test('nonzero Codex process result is refused even with structured stdout', () => {
  const parsed = parseCodexCliResult({ status: 1, stdout: `${JSON.stringify({ type: 'error', message: 'bad' })}\n${JSON.stringify({ type: 'turn.completed' })}\n`, stderr: '' });
  assert.equal(parsed.ok, false);
});

test('Codex availability probes use the sanitized child environment', async () => {
  const prior = {
    COMMAND_ADMIN_TOKEN: process.env.COMMAND_ADMIN_TOKEN,
    SESSION_SECRET: process.env.SESSION_SECRET,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.COMMAND_ADMIN_TOKEN = 'secret-admin';
  process.env.SESSION_SECRET = 'secret-session';
  process.env.GITHUB_TOKEN = 'secret-github';
  process.env.OPENAI_API_KEY = 'secret-openai';
  try {
    assert.equal(await codexCliAvailable(), true);
    assert.equal(activeModes().codex, 'cli');
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('production provider availability does not probe disabled Claude Code', async () => {
  const prior = {
    BLACKSPIRE_RUNTIME_MODE: process.env.BLACKSPIRE_RUNTIME_MODE,
    COMMAND_ADMIN_TOKEN: process.env.COMMAND_ADMIN_TOKEN,
    PATH: process.env.PATH,
  };
  const probeBin = path.join(root, 'no-claude-probe-bin');
  const marker = path.join(root, 'claude-probed');
  fs.mkdirSync(probeBin, { recursive: true });
  fs.writeFileSync(path.join(probeBin, 'codex'), fs.readFileSync(path.join(bin, 'codex')));
  fs.chmodSync(path.join(probeBin, 'codex'), 0o755);
  fs.writeFileSync(path.join(probeBin, 'claude'), `#!/usr/bin/env bash\nprintf '%s' "\${COMMAND_ADMIN_TOKEN:-missing}" > ${JSON.stringify(marker)}\nexit 0\n`);
  fs.chmodSync(path.join(probeBin, 'claude'), 0o755);
  process.env.BLACKSPIRE_RUNTIME_MODE = 'production';
  process.env.COMMAND_ADMIN_TOKEN = 'secret-admin';
  process.env.PATH = `${probeBin}${path.delimiter}${prior.PATH}`;
  try {
    const modes = await resolveProviderAvailability(['codex']);
    assert.equal(modes.codex, 'cli');
    assert.equal(Object.hasOwn(modes, 'claudeCode'), false, 'ineligible providers must not even enter the probe result');
    assert.equal(fs.existsSync(marker), false, 'production availability must not spawn disabled Claude Code');
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Codex availability probes are bounded when the CLI hangs', async () => {
  const priorPath = process.env.PATH;
  const hangingBin = path.join(root, 'hanging-codex-bin');
  fs.mkdirSync(hangingBin, { recursive: true });
  fs.writeFileSync(path.join(hangingBin, 'codex'), '#!/usr/bin/env bash\nsleep 10\n');
  fs.chmodSync(path.join(hangingBin, 'codex'), 0o755);
  process.env.PATH = `${hangingBin}${path.delimiter}${priorPath}`;
  const started = Date.now();
  try {
    assert.equal(await codexCliAvailable(), false);
    assert.ok(Date.now() - started < 5_000, 'hanging Codex probe must be bounded');
  } finally {
    process.env.PATH = priorPath;
  }
});

function controlledProbe({ hangDoctor = false } = {}) {
  const calls = [];
  const spawnImpl = (_cmd, args, options) => {
    calls.push({ args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = null;
    child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); };
    queueMicrotask(() => {
      if (args[0] === '--version') {
        child.stdout.end('codex-cli test\n'); child.stderr.end(); child.emit('close', 0, null);
      } else if (!hangDoctor) {
        child.stdout.end('{"schemaVersion":1,"checks":{"auth.credentials":{"status":"ok"},"network.provider_reachability":{"status":"ok"},"network.websocket_reachability":{"status":"ok"},"installation":{"status":"fail"}}}\n'); child.stderr.end(); child.emit('close', 0, null);
      }
    });
    return child;
  };
  return { calls, spawnImpl };
}

test('Codex doctor hangs are bounded and fail closed', async () => {
  const probe = controlledProbe({ hangDoctor: true });
  assert.equal(await codexCliAvailable({ spawnImpl: probe.spawnImpl, timeoutMs: 20 }), false);
  assert.deepEqual(probe.calls.map((call) => call.args[0]), ['--version', 'doctor']);
});

test('Codex capability accepts healthy auth and transports despite unrelated doctor exit failure', async () => {
  const probe = controlledProbe();
  const original = probe.spawnImpl;
  probe.spawnImpl = (command, args, options) => {
    const child = original(command, args, options);
    if (args[0] === 'doctor') {
      const emit = child.emit.bind(child);
      child.emit = (event, code, signal) => emit(event, event === 'close' ? 17 : code, signal);
    }
    return child;
  };
  assert.equal(await codexCliAvailable({ spawnImpl: probe.spawnImpl }), true);
});

test('Codex capability verification observes cancellation and deadline controls', async () => {
  const cancelled = controlledProbe({ hangDoctor: true });
  assert.equal(await codexCliAvailable({ spawnImpl: cancelled.spawnImpl, timeoutMs: 5_000, shouldCancel: () => true }), false);
  const deadline = controlledProbe({ hangDoctor: true });
  assert.equal(await codexCliAvailable({ spawnImpl: deadline.spawnImpl, timeoutMs: 5_000, deadline: new Date(Date.now() + 10).toISOString() }), false);
});

test('capability verification is bound to CODEX_HOME and production config fingerprint', async () => {
  const verified = controlledProbe();
  assert.equal(await codexCliAvailable({ spawnImpl: verified.spawnImpl }), true);
  assert.equal(activeModes().codex, 'cli');
  const prior = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(root, 'different-codex-home');
  try { assert.equal(activeModes().codex, 'capability-unknown'); } finally { process.env.CODEX_HOME = prior; }
});

function fakeChild(run) {
  return (_cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; child.emit('close', null, 'SIGTERM'); };
    queueMicrotask(() => run({ child, args, options }));
    return child;
  };
}

test('Codex spawn args carry server model, workspace cwd, read-only sandbox, and final-output file', async () => {
  const workspace = path.join(root, 'workspace-a');
  fs.mkdirSync(path.join(workspace, '.hermes-task-packets'), { recursive: true });
  const packet = path.join(workspace, '.hermes-task-packets', 'task-1.json');
  fs.writeFileSync(packet, '{}');
  let observed;
  const result = await runCodexCliPacket(packet, {
    workspaceRoot: workspace,
    model: 'MODEL_A',
    executionIntent: 'read_only',
    spawnImpl: fakeChild(({ child, args, options }) => {
      observed = { args, options };
      const final = args[args.indexOf('--output-last-message') + 1];
      fs.writeFileSync(final, JSON.stringify({ artifacts: [], summary: 'ok' }));
      child.stdout.end(jsonlFinal());
      child.stderr.end();
      child.emit('close', 0, null);
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(observed.options.cwd, workspace);
  assert.deepEqual(observed.args.slice(0, 2), ['exec', '--json']);
  assert.equal(observed.args[observed.args.indexOf('--model') + 1], 'MODEL_A');
  assert.equal(observed.args[observed.args.indexOf('--cd') + 1], workspace);
  assert.equal(observed.args[observed.args.indexOf('--sandbox') + 1], 'read-only');
  assert.match(observed.args.at(-1), /This is a read-only task[\s\S]*artifacts must be empty/);
});

test('workspace cwd follows the selected workspace and never the service checkout', async () => {
  for (const name of ['workspace-a', 'workspace-b']) {
    const workspace = path.join(root, name);
    fs.mkdirSync(path.join(workspace, '.hermes-task-packets'), { recursive: true });
    const packet = path.join(workspace, '.hermes-task-packets', `${name}.json`);
    fs.writeFileSync(packet, '{}');
    let cwd;
    await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', spawnImpl: fakeChild(({ child, args, options }) => {
      cwd = options.cwd;
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
      child.stdout.end(jsonlFinal());
      child.stderr.end();
      child.emit('close', 0, null);
    }) });
    assert.equal(cwd, workspace);
    assert.notEqual(cwd, '/opt/blackspire');
  }
});

test('provider direct workspace mutation is rejected before artifact application', async () => {
  const workspace = path.join(root, 'mutation-workspace');
  fs.mkdirSync(path.join(workspace, '.hermes-task-packets'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'tracked.txt'), 'before');
  const packet = path.join(workspace, '.hermes-task-packets', 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', spawnImpl: fakeChild(({ child, args }) => {
    fs.writeFileSync(path.join(workspace, 'tracked.txt'), 'after');
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
    child.stdout.end(jsonlFinal());
    child.stderr.end();
    child.emit('close', 0, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('unproven containment durably quarantines only the affected workspace until explicit verified recovery', async () => {
  const workspaceA = path.join(root, 'containment-quarantine-a');
  const workspaceB = path.join(root, 'containment-quarantine-b');
  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });
  for (const [id, rootPath] of [['quarantine-a', workspaceA], ['quarantine-b', workspaceB]]) {
    upsertWorkspace({ id, name: id, githubRepository: `local/${id}`, allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['codex'] }, budgetCents: 100, enabledTools: ['read'], lastHealthStatus: 'ok', rootPath });
  }
  upsertWorkspace({ id: 'quarantine-alias', name: 'quarantine-alias', githubRepository: 'local/quarantine-alias', allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['codex'] }, budgetCents: 100, enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: workspaceA });
  const taskA = createTask({ workspaceId: 'quarantine-a', request: 'inspect containment', idempotencyKey: 'quarantine-a-task', executionIntent: 'read_only' });
  const taskB = createTask({ workspaceId: 'quarantine-b', request: 'inspect unrelated', idempotencyKey: 'quarantine-b-task', executionIntent: 'read_only' });
  const packet = path.join(workspaceA, 'task.json');
  fs.writeFileSync(packet, '{}');
  let childRuns = 0;
  const result = await runCodexCliPacket(packet, {
    workspaceId: 'quarantine-a', taskId: taskA.id, workspaceRoot: workspaceA, executionIntent: 'read_only',
    runCliChildImpl: async () => { childRuns += 1; return { status: 125, signal: null, stdout: '', stderr: '', containmentFailed: true }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcomeUnknown, true);
  assert.match(result.error, /containment could not be proven; workspace remains quarantined/);
  closeDb();
  assert.deepEqual(workspaceDispatchEligibility('quarantine-a').eligible, false);
  assert.deepEqual(workspaceDispatchEligibility('quarantine-alias').eligible, false, 'an alias of the same physical root cannot bypass quarantine');
  assert.deepEqual(workspaceDispatchEligibility('quarantine-b'), { eligible: true, state: 'available' });
  assert.match(guardDispatch({ task: taskA, workspace: { id: 'quarantine-a' }, phase: 'hermes' }).reason, /workspace unavailable/);
  assert.equal(guardDispatch({ task: taskB, workspace: { id: 'quarantine-b' }, phase: 'hermes' }).ok, true);
  assert.equal(childRuns, 1, 'the failed provider attempt is never replayed automatically');

  assert.throws(() => recoverWorkspace('quarantine-a', { containmentVerified: true }), /requires verified process containment and workspace integrity/);
  assert.equal(workspaceDispatchEligibility('quarantine-a').eligible, false, 'failed recovery survives through the durable registry state');
  assert.deepEqual(recoverWorkspace('quarantine-a', { containmentVerified: true, integrityVerified: true }), { eligible: true, state: 'available' });
  assert.equal(workspaceDispatchEligibility('quarantine-alias').eligible, true);
  assert.equal(guardDispatch({ task: taskA, workspace: { id: 'quarantine-a' }, phase: 'hermes' }).ok, true);
});

test('quarantine keys share directory identity across distinct path spellings', () => {
  const identityA = { logicalRoot: '/mount/a', physicalRoot: '/physical/a', rootDevice: '2049', rootInode: '8193' };
  const identityB = { logicalRoot: '/mount/b', physicalRoot: '/physical/b', rootDevice: '2049', rootInode: '8193' };
  const shared = quarantineKeys(identityA).filter((key) => quarantineKeys(identityB).includes(key));
  assert.equal(shared.length, 1, 'the same device/inode must have one shared durable lookup key');
  assert.equal(quarantineKeys(identityA).filter((key) => key.startsWith('workspace_quarantine_root:')).length, 2, 'logical and physical path keys remain present');
  assert.equal(quarantineKeys({ ...identityB, rootInode: '8194' }).some((key) => shared.includes(key)), false, 'a different directory identity must not share a lookup key');
  assert.throws(() => quarantineKeys({ logicalRoot: '/a', physicalRoot: '/a' }), /directory identity unavailable/);
});

test('verified recovery through an alias clears every path key for the shared directory identity', () => {
  const workspace = path.join(root, 'containment-recovery-alias-target');
  const unrelated = path.join(root, 'containment-recovery-unrelated');
  const aliasA = path.join(root, 'containment-recovery-alias-a');
  const aliasB = path.join(root, 'containment-recovery-alias-b');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(unrelated, { recursive: true });
  fs.symlinkSync(workspace, aliasA, 'dir');
  fs.symlinkSync(workspace, aliasB, 'dir');
  for (const [id, rootPath] of [['recovery-alias-a', aliasA], ['recovery-alias-b', aliasB]]) {
    upsertWorkspace({ id, name: id, githubRepository: `local/${id}`, allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['codex'] }, budgetCents: 100, enabledTools: ['read'], lastHealthStatus: 'ok', rootPath });
  }
  upsertWorkspace({ id: 'recovery-unrelated', name: 'recovery-unrelated', githubRepository: 'local/recovery-unrelated', allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['codex'] }, budgetCents: 100, enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: unrelated });

  quarantineWorkspace('recovery-alias-a');
  quarantineWorkspace('recovery-unrelated');
  assert.equal(workspaceDispatchEligibility('recovery-alias-b').eligible, false);
  assert.throws(() => recoverWorkspace('recovery-alias-b', { integrityVerified: true }), /requires verified process containment and workspace integrity/);
  assert.throws(() => recoverWorkspace('recovery-alias-b', { containmentVerified: true }), /requires verified process containment and workspace integrity/);
  assert.deepEqual(recoverWorkspace('recovery-alias-b', { containmentVerified: true, integrityVerified: true }), { eligible: true, state: 'available' });
  assert.deepEqual(workspaceDispatchEligibility('recovery-alias-a'), { eligible: true, state: 'available' });
  assert.equal(workspaceDispatchEligibility('recovery-unrelated').eligible, false, 'shared-identity recovery must not clear an unrelated quarantine');
  quarantineWorkspace('recovery-alias-b');
  assert.equal(workspaceDispatchEligibility('recovery-alias-a').eligible, false, 'quarantine is symmetric across aliases');
  recoverWorkspace('recovery-alias-a', { containmentVerified: true, integrityVerified: true });
});

test('a failed durable quarantine write prevents provider launch', async () => {
  const workspace = path.join(root, 'containment-quarantine-write-failure');
  fs.mkdirSync(workspace, { recursive: true });
  upsertWorkspace({ id: 'quarantine-write-failure', name: 'quarantine-write-failure', githubRepository: 'local/quarantine-write-failure', allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['codex'] }, budgetCents: 100, enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: workspace });
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  let childRuns = 0;
  await assert.rejects(() => runCodexCliPacket(packet, {
    workspaceId: 'quarantine-write-failure', workspaceRoot: workspace, executionIntent: 'read_only',
    quarantineWorkspaceImpl: () => { throw new Error('durable quarantine unavailable'); },
    runCliChildImpl: async () => { childRuns += 1; return { status: 0, stdout: '', stderr: '', containmentFailed: false }; },
  }), /durable quarantine unavailable/);
  assert.equal(childRuns, 0, 'no workspace is touched unless quarantine is durable first');
});

test('a failed directory-identity quarantine write rolls back path keys before provider launch', async () => {
  const workspace = path.join(root, 'containment-quarantine-identity-write-failure');
  fs.mkdirSync(workspace, { recursive: true });
  upsertWorkspace({ id: 'quarantine-identity-write-failure', name: 'quarantine-identity-write-failure', githubRepository: 'local/quarantine-identity-write-failure', allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['codex'] }, budgetCents: 100, enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: workspace });
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const quarantineCount = () => query("SELECT COUNT(*) AS count FROM system_flags WHERE key LIKE 'workspace_quarantine_root:%' OR key LIKE 'workspace_quarantine_identity:%';")[0].count;
  const baselineQuarantineCount = quarantineCount();
  execSql("CREATE TRIGGER reject_quarantine_identity BEFORE INSERT ON system_flags WHEN NEW.key LIKE 'workspace_quarantine_identity:%' BEGIN SELECT RAISE(ABORT, 'identity quarantine unavailable'); END;");
  let childRuns = 0;
  try {
    await assert.rejects(() => runCodexCliPacket(packet, {
      workspaceId: 'quarantine-identity-write-failure', workspaceRoot: workspace, executionIntent: 'read_only',
      runCliChildImpl: async () => { childRuns += 1; return { status: 0, stdout: '', stderr: '', containmentFailed: false }; },
    }), /identity quarantine unavailable/);
    assert.equal(childRuns, 0);
    assert.equal(quarantineCount(), baselineQuarantineCount, 'the failed transaction leaves no partial quarantine keys');
  } finally {
    execSql('DROP TRIGGER reject_quarantine_identity;');
  }
});

test('a quarantined workspace root retarget cannot redirect provider launch', async () => {
  const original = path.join(root, 'containment-root-original');
  const replacement = path.join(root, 'containment-root-replacement');
  const registered = path.join(root, 'containment-root-registered');
  fs.mkdirSync(original, { recursive: true });
  fs.mkdirSync(replacement, { recursive: true });
  fs.symlinkSync(original, registered, 'dir');
  upsertWorkspace({ id: 'quarantine-retarget', name: 'quarantine-retarget', githubRepository: 'local/quarantine-retarget', allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['codex'] }, budgetCents: 100, enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: registered });
  const packet = path.join(original, 'task.json');
  fs.writeFileSync(packet, '{}');
  let childRuns = 0;
  await assert.rejects(() => runCodexCliPacket(packet, {
    workspaceId: 'quarantine-retarget', workspaceRoot: registered, executionIntent: 'read_only',
    quarantineWorkspaceImpl: (...args) => {
      const quarantine = quarantineWorkspace(...args);
      fs.unlinkSync(registered);
      fs.symlinkSync(replacement, registered, 'dir');
      return quarantine;
    },
    runCliChildImpl: async () => { childRuns += 1; return { status: 0, stdout: '', stderr: '', containmentFailed: false }; },
  }), /ELOOP|ENOTDIR|symbolic link|Workspace root identity changed/);
  assert.equal(childRuns, 0);
  assert.equal(workspaceDispatchEligibility('quarantine-retarget').eligible, false, 'logical-root quarantine survives retargeting');
});

test('a quarantined directory replacement at the same pathname cannot redirect provider launch or recovery', async () => {
  const registered = path.join(root, 'containment-root-replaced-in-place');
  const moved = path.join(root, 'containment-root-replaced-in-place-old');
  fs.mkdirSync(registered, { recursive: true });
  upsertWorkspace({ id: 'quarantine-inode-replacement', name: 'quarantine-inode-replacement', githubRepository: 'local/quarantine-inode-replacement', allowedPaths: ['.'], buildCommands: [], providerPolicy: { preferred: ['codex'] }, budgetCents: 100, enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: registered });
  const packet = path.join(registered, 'task.json');
  fs.writeFileSync(packet, '{}');
  let childRuns = 0;
  await assert.rejects(() => runCodexCliPacket(packet, {
    workspaceId: 'quarantine-inode-replacement', workspaceRoot: registered, executionIntent: 'read_only',
    quarantineWorkspaceImpl: (...args) => {
      const quarantine = quarantineWorkspace(...args);
      fs.renameSync(registered, moved);
      fs.mkdirSync(registered);
      return quarantine;
    },
    runCliChildImpl: async () => { childRuns += 1; return { status: 0, stdout: '', stderr: '', containmentFailed: false }; },
  }), /Workspace root identity changed/);
  assert.equal(childRuns, 0);
  assert.equal(workspaceDispatchEligibility('quarantine-inode-replacement').eligible, false);
  assert.throws(() => recoverWorkspace('quarantine-inode-replacement', { containmentVerified: true, integrityVerified: true }), /quarantined directory identity/);
});

test('provider mutation is rejected even when the Codex child fails', async () => {
  const workspace = path.join(root, 'failed-mutation-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'tracked.txt'), 'before');
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', spawnImpl: fakeChild(({ child }) => {
    fs.writeFileSync(path.join(workspace, 'tracked.txt'), 'after');
    child.stdout.end(`${JSON.stringify({ type: 'error', message: 'provider failed' })}\n`);
    child.stderr.end('provider failed');
    child.emit('close', 1, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('provider mutation of the workspace root mode is rejected', async () => {
  const workspace = path.join(root, 'root-mode-mutation-workspace');
  fs.mkdirSync(workspace, { recursive: true, mode: 0o755 });
  fs.chmodSync(workspace, 0o755);
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', executionIntent: 'read_only', spawnImpl: fakeChild(({ child, args }) => {
    fs.chmodSync(workspace, 0o700);
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
    child.stdout.end(jsonlFinal());
    child.stderr.end();
    child.emit('close', 0, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('provider same-mode replacement of a traversed workspace directory is rejected', async () => {
  const workspace = path.join(root, 'directory-identity-workspace');
  const directory = path.join(workspace, 'empty-directory');
  const replacement = path.join(root, 'directory-identity-replacement');
  fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
  fs.mkdirSync(replacement, { recursive: true, mode: 0o755 });
  fs.chmodSync(directory, 0o755);
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, executionIntent: 'read_only', spawnImpl: fakeChild(({ child, args }) => {
    fs.rmdirSync(directory);
    fs.renameSync(replacement, directory);
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
    child.stdout.end(jsonlFinal());
    child.stderr.end();
    child.emit('close', 0, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('provider same-mode replacement beneath an external Git root is rejected', async () => {
  const workspace = path.join(root, 'external-directory-identity-workspace');
  const gitDirectory = path.join(root, 'external-directory-identity-git');
  fs.mkdirSync(workspace, { recursive: true });
  assert.equal(spawnSync('git', ['init', '--separate-git-dir', gitDirectory, workspace], { encoding: 'utf8' }).status, 0);
  const directory = path.join(gitDirectory, 'empty-directory');
  const replacement = path.join(root, 'external-directory-identity-replacement');
  fs.mkdirSync(directory, { mode: 0o755 });
  fs.mkdirSync(replacement, { mode: 0o755 });
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, executionIntent: 'read_only', spawnImpl: fakeChild(({ child, args }) => {
    fs.rmdirSync(directory);
    fs.renameSync(replacement, directory);
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
    child.stdout.end(jsonlFinal());
    child.stderr.end();
    child.emit('close', 0, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('provider replacement of a workspace file with an external hard link is rejected', async () => {
  const workspace = path.join(root, 'hard-link-mutation-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const tracked = path.join(workspace, 'tracked.txt');
  const external = path.join(root, 'external-hard-link-source.txt');
  fs.writeFileSync(tracked, 'identical');
  fs.writeFileSync(external, 'identical');
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', executionIntent: 'read_only', spawnImpl: fakeChild(({ child, args }) => {
    fs.unlinkSync(tracked);
    fs.linkSync(external, tracked);
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
    child.stdout.end(jsonlFinal());
    child.stderr.end();
    child.emit('close', 0, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('provider Git-control mutation is rejected even when size and timestamp are restored', async () => {
  const workspace = path.join(root, 'control-mutation-workspace');
  fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
  const head = path.join(workspace, '.git', 'HEAD');
  fs.writeFileSync(head, 'ref: refs/heads/main\n');
  const original = fs.statSync(head);
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', executionIntent: 'read_only', spawnImpl: fakeChild(({ child, args }) => {
    fs.writeFileSync(head, 'ref: refs/heads/evil\n');
    fs.utimesSync(head, original.atime, original.mtime);
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
    child.stdout.end(jsonlFinal());
    child.stderr.end();
    child.emit('close', 0, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('provider mutation of a separate Git directory is rejected', async () => {
  const workspace = path.join(root, 'separate-control-workspace');
  const gitDirectory = path.join(root, 'separate-control-gitdir');
  fs.mkdirSync(workspace, { recursive: true });
  assert.equal(spawnSync('git', ['init', '--separate-git-dir', gitDirectory, workspace], { encoding: 'utf8' }).status, 0);
  const head = path.join(gitDirectory, 'HEAD');
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', executionIntent: 'read_only', spawnImpl: fakeChild(({ child, args }) => {
    fs.writeFileSync(head, 'ref: refs/heads/evil\n');
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
    child.stdout.end(jsonlFinal());
    child.stderr.end();
    child.emit('close', 0, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('provider mutation of a linked worktree common Git directory is rejected', async () => {
  const primary = path.join(root, 'linked-primary');
  const workspace = path.join(root, 'linked-worktree');
  fs.mkdirSync(primary, { recursive: true });
  assert.equal(spawnSync('git', ['init', primary], { encoding: 'utf8' }).status, 0);
  fs.writeFileSync(path.join(primary, 'tracked.txt'), 'tracked');
  assert.equal(spawnSync('git', ['-C', primary, 'add', 'tracked.txt'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['-C', primary, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['-C', primary, 'worktree', 'add', workspace], { encoding: 'utf8' }).status, 0);
  const commonConfig = path.join(primary, '.git', 'config');
  const packet = path.join(workspace, 'task.json');
  fs.writeFileSync(packet, '{}');
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', executionIntent: 'read_only', spawnImpl: fakeChild(({ child, args }) => {
    fs.appendFileSync(commonConfig, '\n[alias]\nunsafe = status\n');
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ artifacts: [], summary: 'ok' }));
    child.stdout.end(jsonlFinal());
    child.stderr.end();
    child.emit('close', 0, null);
  }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /mutated/);
});

test('Codex child is terminated at the Hermes deadline', async () => {
  const workspace = path.join(root, 'timeout-workspace');
  fs.mkdirSync(path.join(workspace, '.hermes-task-packets'), { recursive: true });
  const packet = path.join(workspace, '.hermes-task-packets', 'task.json');
  fs.writeFileSync(packet, '{}');
  let killed = false;
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', timeoutMs: 5, spawnImpl: () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { killed = true; child.emit('close', null, 'SIGTERM'); };
    return child;
  } });
  assert.equal(killed, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /deadline exceeded|terminal result|no JSONL/);
});

test('termination waits for a TERM-resistant descendant before returning', async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let groupAlive = true;
  let resolved = false;
  const signals = [];
  const completion = runCliChild(() => child, 'codex', [], {
    cwd: root,
    timeoutMs: 1,
    terminationGraceMs: 10,
    containmentPollMs: 1,
    containmentTimeoutMs: 50,
    groupExists: () => groupAlive,
    killGroup: (_pid, signal) => {
      signals.push(signal);
      if (signal === 'SIGTERM') child.emit('close', null, 'SIGTERM');
      if (signal === 'SIGKILL') groupAlive = false;
    },
  }).then((result) => { resolved = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false, 'leader close must not decide isolation while its descendant survives');
  const result = await completion;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(groupAlive, false);
  assert.equal(result.status, 124);
});

test('ordinary leader exit contains a surviving descendant before returning', async () => {
  const child = new EventEmitter();
  child.pid = 4343;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let groupAlive = true;
  let resolved = false;
  const signals = [];
  const completion = runCliChild(() => child, 'codex', [], {
    cwd: root,
    timeoutMs: 5000,
    terminationGraceMs: 10,
    containmentPollMs: 1,
    containmentTimeoutMs: 50,
    groupExists: () => groupAlive,
    killGroup: (_pid, signal) => {
      signals.push(signal);
      if (signal === 'SIGKILL') groupAlive = false;
    },
  }).then((result) => { resolved = true; return result; });
  child.emit('close', 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false, 'ordinary leader close must not return while its descendant survives');
  const result = await completion;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(groupAlive, false);
  assert.equal(result.status, 124);
});

test('ordinary clean exit with no surviving process group returns without kill grace', async () => {
  const child = new EventEmitter();
  child.pid = 4444;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const signals = [];
  const completion = runCliChild(() => child, 'codex', [], {
    cwd: root,
    timeoutMs: 5000,
    groupExists: () => false,
    killGroup: (_pid, signal) => signals.push(signal),
  });
  child.emit('close', 0, null);
  const result = await completion;
  assert.equal(result.status, 0);
  assert.deepEqual(signals, []);
});

test('Codex child is terminated when task controls cancel', async () => {
  const workspace = path.join(root, 'cancel-workspace');
  fs.mkdirSync(path.join(workspace, '.hermes-task-packets'), { recursive: true });
  const packet = path.join(workspace, '.hermes-task-packets', 'task.json');
  fs.writeFileSync(packet, '{}');
  let killed = false;
  let checks = 0;
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', timeoutMs: 5_000, shouldCancel: () => ++checks > 1, spawnImpl: () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { killed = true; child.emit('close', null, 'SIGTERM'); };
    return child;
  } });
  assert.equal(killed, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled|terminal result|no JSONL/);
});

test('Codex stdout and stderr capture is bounded', async () => {
  const workspace = path.join(root, 'verbose-workspace');
  fs.mkdirSync(path.join(workspace, '.hermes-task-packets'), { recursive: true });
  const packet = path.join(workspace, '.hermes-task-packets', 'task.json');
  fs.writeFileSync(packet, '{}');
  let killed = false;
  const result = await runCodexCliPacket(packet, { workspaceRoot: workspace, model: 'MODEL_A', timeoutMs: 5_000, spawnImpl: () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { killed = true; child.emit('close', null, 'SIGTERM'); };
    queueMicrotask(() => child.stdout.write('x'.repeat(1_100_000)));
    return child;
  } });
  assert.equal(killed, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /output exceeded|terminal result|no JSONL/);
});

test('Codex final-output files are size checked before parsing', () => {
  const final = path.join(root, 'oversized-final.json');
  fs.writeFileSync(final, 'x'.repeat(1_100_000));
  const parsed = parseCodexCliResult({ status: 0, stdout: jsonlFinal(), stderr: '' }, final);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /missing or truncated/);
});

test('subscription accounting persists null cost and survives a DB reopen', () => {
  const task = createTask({ workspaceId: 'w', request: 'status', idempotencyKey: 'accounting-1' });
  recordUsage(task.id, { provider: 'codex', mode: 'cli', latencyMs: 1, inputTokens: 1, outputTokens: 1, costCents: null, monetaryCostState: 'subscription_unmetered' });
  assert.equal(monetarySpend(task.id), 0);
  closeDb();
  const row = taskRecords(task.id).usage.at(-1);
  assert.equal(row.cost_cents, null);
  assert.equal(row.monetary_cost_state, 'subscription_unmetered');
});

test('unknown metered cost cannot be interpreted as zero', () => {
  const task = createTask({ workspaceId: 'w', request: 'status', idempotencyKey: 'accounting-2' });
  assert.throws(() => recordUsage(task.id, { provider: 'openai', mode: 'api', latencyMs: 1, costCents: null, monetaryCostState: 'metered' }), /verified cost/);
});

test('Codex dispatch marker is durable, unique, and transitions the same attempt', () => {
  const task = createTask({ workspaceId: 'dispatch-test', request: 'inspect', idempotencyKey: 'dispatch-marker-test' });
  const packet = { taskId: task.id, idempotencyKey: task.idempotency_key };
  const first = prepareCodexDispatch(task.id, { mode: 'cli', model: 'server-model', requestPacket: packet });
  const concurrent = prepareCodexDispatch(task.id, { mode: 'cli', model: 'server-model', requestPacket: packet });
  assert.equal(first.owned, true);
  assert.equal(first.attempt.status, 'dispatching');
  assert.equal(concurrent.owned, false);
  assert.equal(concurrent.attempt.id, first.attempt.id);
  closeDb();
  assert.equal(taskRecords(task.id).providerAttempts[0].status, 'dispatching');
  const terminal = finishCodexDispatch(task.id, 'completed', { attemptId: first.attempt.id, responsePacket: { model: 'server-model' } });
  assert.equal(terminal.id, first.attempt.id);
  assert.equal(terminal.status, 'completed');
  assert.equal(taskRecords(task.id).providerAttempts.length, 1);
});

test('task lease renewal is fenced to the worker and per-claim token that own the claim', () => {
  for (let queued; (queued = claimNext({ workerId: 'lease-test-drain' }));) transition(queued.id, 'cancelled', {}, { workerId: queued.worker_id, claimToken: queued.claim_token });
  const task = createTask({ workspaceId: 'lease-test', request: 'inspect', idempotencyKey: 'lease-owner-test' });
  const claimed = claimNext({ workerId: 'lease-owner' });
  assert.equal(claimed.id, task.id);
  const before = claimed.heartbeat_at;
  assert.equal(heartbeat(task.id, 'execute_provider', { workerId: 'replacement-worker', claimToken: claimed.claim_token }), false);
  assert.equal(getTask(task.id).heartbeat_at, before);
  assert.equal(heartbeat(task.id, 'execute_provider', { workerId: 'lease-owner', claimToken: 'wrong-token' }), false);
  assert.equal(heartbeat(task.id, 'execute_provider', { workerId: 'lease-owner', claimToken: claimed.claim_token }), true);
});

test('stale reclaim rotates claim identity even when WORKER_ID is reused', () => {
  for (let queued; (queued = claimNext({ workerId: 'lease-reclaim-drain' }));) transition(queued.id, 'cancelled', {}, { workerId: queued.worker_id, claimToken: queued.claim_token });
  const task = createTask({ workspaceId: 'lease-reclaim', request: 'inspect', idempotencyKey: 'lease-reclaim-test' });
  const first = claimNext({ workerId: 'stable-worker-id' });
  transition(task.id, 'running', { heartbeat_at: '2000-01-01T00:00:00.000Z' }, { workerId: first.worker_id, claimToken: first.claim_token });
  const second = claimNext({ workerId: 'stable-worker-id', staleAfterSeconds: 1 });
  assert.equal(second.id, task.id);
  assert.notEqual(second.claim_token, first.claim_token);
  assert.equal(heartbeat(task.id, 'old-worker', { workerId: first.worker_id, claimToken: first.claim_token }), false);
  assert.equal(heartbeat(task.id, 'new-worker', { workerId: second.worker_id, claimToken: second.claim_token }), true);
});

test('cancelled absorbs both late provider completion and failure', () => {
  for (const lateStatus of ['completed', 'failed']) {
    const task = createTask({ workspaceId: 'cancel-test', request: 'inspect', idempotencyKey: `cancel-absorbing-${lateStatus}` });
    transition(task.id, 'cancelled', { error: 'operator cancelled' });
    transition(task.id, lateStatus, { error: `late provider ${lateStatus}` });
    transition(task.id, 'queued');
    assert.equal(getTask(task.id).status, 'cancelled', lateStatus);
    assert.equal(getTask(task.id).error, 'operator cancelled', lateStatus);
  }
});

test('Codex terminal attempt and usage accounting commit atomically', () => {
  const task = createTask({ workspaceId: 'atomic-test', request: 'inspect', idempotencyKey: 'atomic-accounting-test' });
  const prepared = prepareCodexDispatch(task.id, { mode: 'cli', model: 'server-model', requestPacket: { taskId: task.id } });
  assert.throws(() => finishCodexDispatchWithUsage(task.id, 'failed', {
    attemptId: prepared.attempt.id,
    responsePacket: { model: 'server-model' },
    error: 'cancelled',
    usage: { provider: 'codex', mode: 'cli', monetaryCostState: 'metered', costCents: null },
  }), /verified cost/);
  assert.equal(taskRecords(task.id).providerAttempts[0].status, 'dispatching', 'failed accounting must roll back terminalization');
  assert.equal(taskRecords(task.id).usage.length, 0);
  finishCodexDispatchWithUsage(task.id, 'failed', {
    attemptId: prepared.attempt.id,
    responsePacket: { model: 'server-model' },
    error: 'cancelled',
    usage: { provider: 'codex', mode: 'cli', monetaryCostState: 'subscription_unmetered', costCents: null },
  });
  assert.equal(taskRecords(task.id).providerAttempts[0].status, 'failed');
  assert.equal(taskRecords(task.id).usage[0].monetary_cost_state, 'subscription_unmetered');
  finishCodexDispatchWithUsage(task.id, 'failed', {
    attemptId: prepared.attempt.id, responsePacket: { model: 'server-model' }, error: 'cancelled',
    usage: { provider: 'codex', mode: 'cli', monetaryCostState: 'subscription_unmetered', costCents: null },
  });
  assert.equal(taskRecords(task.id).usage.length, 1, 'idempotent finalization must not duplicate accounting');
});

test('fault injection rolls back both sides of Codex finalization', () => {
  for (const point of ['after_attempt_update', 'after_usage_insert']) {
    const task = createTask({ workspaceId: 'atomic-fault', request: point, idempotencyKey: `atomic-${point}` });
    const prepared = prepareCodexDispatch(task.id, { mode: 'cli', model: 'server-model', requestPacket: { taskId: task.id } });
    assert.throws(() => finishCodexDispatchWithUsage(task.id, 'completed', {
      attemptId: prepared.attempt.id, responsePacket: { model: 'server-model' }, latencyMs: 5,
      usage: { provider: 'codex', mode: 'cli', monetaryCostState: 'subscription_unmetered', costCents: null },
      faultInjector: (current) => { if (current === point) throw new Error(`injected ${point}`); },
    }), /injected/);
    assert.equal(taskRecords(task.id).providerAttempts[0].status, 'dispatching');
    assert.equal(taskRecords(task.id).usage.length, 0);
  }
});

test('Hermes commits the Codex dispatch marker before the child invocation can begin', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/hermes/hermes.js'), 'utf8');
  const marker = source.indexOf('prepareCodexDispatch(task.id');
  const child = source.indexOf('await executeProviderRequest(', marker);
  assert.ok(marker >= 0 && child > marker, 'durable marker must remain before provider child invocation');
});

test('Hermes preserves containment uncertainty as outcome_unknown', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/hermes/hermes.js'), 'utf8');
  assert.match(source, /result\.outcomeUnknown \? 'outcome_unknown'/);
});

test.after(() => {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
