import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-monitor-'));
const state = path.join(root, 'state');
const database = path.join(root, 'database', 'command.sqlite');
const bin = path.join(root, 'bin');
fs.mkdirSync(state);
fs.mkdirSync(path.dirname(database));
fs.mkdirSync(bin);
fs.writeFileSync(database, 'fixture');
function setDiskUsed(percent) {
  fs.writeFileSync(path.join(bin, 'df'), `#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 100 ${percent} ${100 - percent} ${percent}%% /fixture\\n"\n`);
}
function fakeCommand(name, body) {
  const command = path.join(bin, name);
  fs.writeFileSync(command, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(command, 0o755);
  return command;
}
setDiskUsed(10);
fs.chmodSync(path.join(bin, 'df'), 0o755);

function run(port) {
  return spawnSync('bash', ['ops/blackspire-command-monitor.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      BLACKSPIRE_MONITOR_STATE_DIR: state,
      BLACKSPIRE_DB_PATH: database,
      BIND_HOST: '127.0.0.1',
      PORT: String(port),
      BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '1',
      BLACKSPIRE_NODE_BIN: process.execPath,
    },
  });
}

test('monitor alerts only on the third consecutive failed health check and persists the count', () => {
  for (const expected of [1, 2, 3]) {
    const result = run(65534);
    const report = JSON.parse(result.stdout);
    assert.equal(report.consecutiveHealthFailures, expected);
    assert.equal(result.status, expected < 3 ? 0 : 1);
  }
  assert.equal(fs.readFileSync(path.join(state, 'consecutive-health-failures'), 'utf8'), '3\n');
});

test('monitor templates pin the minute schedule, durable state, hardening, and provider-neutral alert hook', () => {
  const service = fs.readFileSync('ops/blackspire-command-monitor.service', 'utf8');
  const timer = fs.readFileSync('ops/blackspire-command-monitor.timer', 'utf8');
  const alert = fs.readFileSync('ops/blackspire-command-monitor-alert@.service', 'utf8');
  assert.match(service, /^OnFailure=blackspire-command-monitor-alert@%n\.service$/m);
  assert.match(service, /^StateDirectory=blackspire-command-monitor$/m);
  assert.match(service, /^User=blackspire$/m);
  assert.match(service, /^TimeoutStartSec=20s$/m);
  assert.match(service, /^NoNewPrivileges=yes$/m);
  assert.match(service, /^Environment=PATH=\/opt\/nodejs\/node-v22\.23\.1-linux-x64\/bin:/m);
  assert.ok(service.indexOf('Environment=PATH=') > service.indexOf('EnvironmentFile='));
  assert.match(service, /^RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);
  assert.match(timer, /^OnUnitActiveSec=1min$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(alert, /^ExecStart=\/usr\/bin\/logger --priority daemon\.alert /m);
  assert.doesNotMatch(alert, /https?:|token|secret|webhook/i);
});

test('a successful health check resets the durable consecutive-failure counter', () => {
  const curl = path.join(bin, 'curl');
  fs.writeFileSync(curl, '#!/bin/sh\nprintf \'%s\\n\' \'{"ok":true,"service":"blackspire-command-api","telegramMode":"dry-run"}\'\n');
  fs.chmodSync(curl, 0o755);
  const result = run(65534);
  fs.rmSync(curl);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).consecutiveHealthFailures, 0);
  assert.equal(fs.readFileSync(path.join(state, 'consecutive-health-failures'), 'utf8'), '0\n');
});

test('database filesystem below twenty percent free alerts immediately', () => {
  setDiskUsed(81);
  const result = run(65534);
  setDiskUsed(10);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, 'database_disk_below_20_percent');
});

test('monitor refuses corrupt counter state rather than clearing the failure history', () => {
  fs.writeFileSync(path.join(state, 'consecutive-health-failures'), 'not-a-counter\n');
  const result = run(65534);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).error, 'state_counter_invalid');
  assert.equal(fs.readFileSync(path.join(state, 'consecutive-health-failures'), 'utf8'), 'not-a-counter\n');
});

test('native utility and redirection failures never disclose private paths', () => {
  fs.rmSync(path.join(state, 'consecutive-health-failures'), { force: true });
  const privateMarker = `${root}/private-monitor-path`;
  const cases = [
    ['df', `printf '%s\\n' '${privateMarker}' >&2; exit 1`, 'disk_metric_unavailable'],
    ['mktemp', `printf '%s\\n' '${privateMarker}' >&2; exit 1`, 'state_write_failed'],
    ['chmod', `printf '%s\\n' '${privateMarker}' >&2; exit 1`, 'state_write_failed'],
    ['mv', `printf '%s\\n' '${privateMarker}' >&2; exit 1`, 'state_write_failed'],
    ['mktemp', `printf '%s\\n' '${privateMarker}/missing/counter'; exit 0`, 'state_write_failed'],
  ];
  for (const [name, body, expected] of cases) {
    const command = fakeCommand(name, body);
    const result = run(65534);
    fs.rmSync(command);
    assert.equal(result.status, 2, `${name}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stderr).error, expected);
    assert.equal(result.stderr.includes(privateMarker), false, name);
  }
  setDiskUsed(10);
});

test('a hung disk probe is killed within the oneshot budget and a later run can recur', () => {
  const command = fakeCommand('df', 'sleep 30');
  const started = Date.now();
  const hung = run(65534);
  const elapsed = Date.now() - started;
  fs.rmSync(command);
  setDiskUsed(10);
  assert.equal(hung.status, 2);
  assert.equal(JSON.parse(hung.stderr).error, 'disk_metric_unavailable');
  assert.ok(elapsed >= 4_000 && elapsed < 10_000, `bounded df elapsed ${elapsed}ms`);
  const recurring = run(65534);
  assert.notEqual(recurring.status, 2, recurring.stderr);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
