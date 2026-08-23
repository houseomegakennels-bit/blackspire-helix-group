import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-codex-contract-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'test.sqlite');

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { activeModes, parseCodexCliResult, runCodexCliPacket } = await import('../packages/providers/providers.js');
const { createTask, recordUsage, taskRecords, monetarySpend } = await import('../packages/task-engine/tasks.js');
const { closeDb } = await import('../packages/task-engine/db.js');

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
  doctor) printf '{"checks":{"auth.credentials":{"status":"ok","summary":"auth is configured"}}}\\n' ;;
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

test('Codex availability probes use the sanitized child environment', () => {
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
    assert.equal(activeModes().codex, 'cli');
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
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

test.after(() => {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
