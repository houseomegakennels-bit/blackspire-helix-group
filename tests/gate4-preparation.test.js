import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// Gate 4 preparation contract.
//
// The script's whole value is that it can be run against a production host without changing it, so
// these tests pin two things above all: it never mutates, and it never reports ready when a
// prerequisite is outstanding. A preparation checker that fails open is worse than none, because it
// would be the evidence an activation is attempted on.

const repo = path.resolve(import.meta.dirname, '..');
const script = path.join(repo, 'scripts', 'gate4-prepare.sh');
const rollbackScript = path.join(repo, 'scripts', 'gate4-rollback-preparation.sh');
const readinessWaiterScript = path.join(repo, 'scripts', 'wait-production-ready.sh');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-gate4-'));

// A host fixture: disposable stand-ins for every path the checker reads, so no case can touch the
// real /etc, /opt, or systemd state.
function makeHost({ envFile = true, workspace = true, releases = ['a'.repeat(40), 'b'.repeat(40)], logrotate = true } = {}) {
  const home = fs.mkdtempSync(path.join(scratch, 'host-'));
  const releaseRoot = path.join(home, 'blackspire-command');
  fs.mkdirSync(path.join(releaseRoot, 'releases'), { recursive: true });
  fs.mkdirSync(path.join(releaseRoot, 'shared', 'backups'), { recursive: true });
  for (const sha of releases) {
    fs.mkdirSync(path.join(releaseRoot, 'releases', sha), { recursive: true });
    fs.writeFileSync(path.join(releaseRoot, 'releases', sha, '.release-complete'), '');
  }
  const workspaceRoot = path.join(releaseRoot, 'shared', 'workspace');
  if (workspace) {
    fs.mkdirSync(path.join(workspaceRoot, '.git'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'apps'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'packages'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"name":"fixture"}\n');
  }
  const envPath = path.join(home, 'command.env');
  if (envFile) {
    fs.writeFileSync(envPath, [
      'NODE_ENV=production', 'BLACKSPIRE_RUNTIME_MODE=production', 'BLACKSPIRE_STATE_OWNER=vps-production',
      'BLACKSPIRE_STARTUP_TIMEOUT_SECONDS=30', 'BLACKSPIRE_HEALTH_TIMEOUT_SECONDS=5',
      'BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT=true',
      'BLACKSPIRE_PROVIDER_MODE=manual', 'BLACKSPIRE_HERMES_MODE=restricted', 'TELEGRAM_MODE=dry-run',
      `BLACKSPIRE_DB_PATH=${releaseRoot}/shared/database/command.sqlite`,
      `BLACKSPIRE_DATA_DIR=${releaseRoot}/shared/database`,
      `BLACKSPIRE_BACKUP_DIR=${releaseRoot}/shared/backups`,
      `BLACKSPIRE_WORKSPACE_ROOT=${workspaceRoot}`,
      'BIND_HOST=127.0.0.1', 'PORT=8789', 'PUBLIC_BASE_URL=https://command.example.invalid',
      'SECURE_COOKIES=true', 'COMMAND_ADMIN_TOKEN=fixture-token-value', 'SESSION_SECRET=fixture-session-value',
    ].join('\n') + '\n');
  }
  const logrotatePath = path.join(home, 'logrotate.conf');
  if (logrotate) fs.copyFileSync('ops/blackspire-command-logrotate.conf', logrotatePath);
  return {
    home, releaseRoot, workspaceRoot, envPath, logrotatePath,
    apiUnitPath: path.join(home, 'blackspire-command.service'),
    workerUnitPath: path.join(home, 'blackspire-command-worker.service'),
    targetPath: path.join(home, 'blackspire-command.target'),
  };
}

function run(host, { args = [], env = {} } = {}) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    cwd: repo,
    env: {
      ...process.env,
      BLACKSPIRE_RELEASE_ROOT: host.releaseRoot,
      BLACKSPIRE_PRODUCTION_ENV_FILE: host.envPath,
      BLACKSPIRE_GATE4_LOGROTATE_FILE: host.logrotatePath,
      // A unit name that cannot exist, so the checker queries systemd about a nonexistent unit
      // rather than the real production one. systemd reports inactive for unknown units.
      BLACKSPIRE_GATE4_UNIT_NAME: 'blackspire-gate4-fixture-nonexistent.service',
      BLACKSPIRE_GATE4_WORKER_UNIT_NAME: 'blackspire-gate4-worker-fixture-nonexistent.service',
      BLACKSPIRE_GATE4_TARGET_NAME: 'blackspire-gate4-fixture-nonexistent.target',
      BLACKSPIRE_GATE4_API_UNIT_FILE: host.apiUnitPath,
      BLACKSPIRE_GATE4_WORKER_UNIT_FILE: host.workerUnitPath,
      BLACKSPIRE_GATE4_TARGET_FILE: host.targetPath,
      ...env,
    },
  });
}

function findings(host, options) {
  const result = run(host, { ...options, args: ['--json', ...(options?.args ?? [])] });
  const report = JSON.parse(result.stdout);
  return { result, report, state: (id) => report.findings.find((f) => f.id === id)?.state };
}

function identityFixture(host, workerGids) {
  const bin = path.join(host.home, `identity-bin-${workerGids.join('-')}`);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'id'), `#!/bin/sh
case "$1:$2" in
  -u:blackspire-api) echo 1201 ;;
  -u:blackspire-worker) echo 1202 ;;
  -Gn:blackspire-api) echo 'blackspire blackspire-api' ;;
  -Gn:blackspire-worker) echo 'blackspire blackspire-worker legacy-name' ;;
  -g:blackspire-worker) echo 1202 ;;
  -G:blackspire-worker) echo '${workerGids.join(' ')}' ;;
  *) exit 1 ;;
esac
`);
  fs.writeFileSync(path.join(bin, 'getent'), `#!/bin/sh
case "$1:$2" in
  group:blackspire-api) echo 'blackspire-api:x:1301:' ;;
  group:blackspire) echo 'blackspire:x:1200:' ;;
  *) exit 2 ;;
esac
`);
  fs.chmodSync(path.join(bin, 'id'), 0o755);
  fs.chmodSync(path.join(bin, 'getent'), 0o755);
  return `${bin}:${process.env.PATH}`;
}

// ---------------------------------------------------------------------------
// Non-mutation: the property that makes this safe to run on a production host
// ---------------------------------------------------------------------------

// A recursive snapshot of everything the checker can see, so an accidental write anywhere in the
// fixture tree is caught rather than only a write to the paths a test thought to check.
function snapshot(dir) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    const stats = fs.lstatSync(full);
    entries.push(`${full}\t${stats.mode}\t${stats.size}\t${stats.mtimeMs}`);
  }
  return entries.sort().join('\n');
}

test('gate4-prepare changes nothing on the host it inspects', () => {
  const host = makeHost();
  const before = snapshot(host.home);
  for (const args of [[], ['--plan'], ['--json']]) {
    run(host, { args, env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
  }
  assert.equal(snapshot(host.home), before, 'the checker must not create, modify, or remove anything');
});

test('gate4-prepare is idempotent: repeated runs produce identical findings', () => {
  const host = makeHost();
  const env = { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) };
  const first = run(host, { args: ['--json'], env });
  const second = run(host, { args: ['--json'], env });
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.status, second.status);
});

test('dry-run and validation-only are explicit read-only mode aliases', () => {
  const body = fs.readFileSync(script, 'utf8');
  assert.match(body, /''\|--check\|--validate-only\) mode=check/);
  assert.match(body, /--plan\|--dry-run\) mode=plan/);
});

test('gate4-prepare contains no activation or mutation command', () => {
  const body = fs.readFileSync(script, 'utf8');
  // Only the plan text may name these, and only inside the heredoc it prints. Nothing outside the
  // plan block may execute them.
  const executable = body.slice(0, body.indexOf('emit_plan() {')) + body.slice(body.indexOf('\nPLAN\n'));
  for (const forbidden of ['systemctl start', 'systemctl enable', 'systemctl restart', 'systemctl reload',
    'daemon-reload', 'release-switch', 'release-rollback', 'ln -s', 'rm -rf', 'chown ', 'chmod ',
    'mkdir ', 'install -', 'git clone', '> "$env_file"', 'tee ']) {
    assert.equal(executable.includes(forbidden), false, `the executable body must never contain ${forbidden}`);
  }
});

test('gate4-prepare never prints secret values from the environment file', () => {
  const host = makeHost();
  for (const args of [[], ['--plan'], ['--json']]) {
    const r = run(host, { args, env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
    assert.doesNotMatch(r.stdout, /fixture-token-value|fixture-session-value/, `${args} must not print secret values`);
    assert.doesNotMatch(r.stderr, /fixture-token-value|fixture-session-value/, `${args} must not print secret values`);
  }
});

// ---------------------------------------------------------------------------
// Fail-closed behaviour
// ---------------------------------------------------------------------------

test('gate4-prepare fails closed when the operator has not named an approved SHA', () => {
  const host = makeHost();
  const { result, state } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: '' } });
  assert.equal(state('approved-sha'), 'PENDING');
  assert.notEqual(result.status, 0, 'a missing operator value must not exit zero');
});

test('gate4-prepare rejects a malformed approved SHA rather than treating it as absent', () => {
  const host = makeHost();
  for (const bad of ['abc', 'A'.repeat(40), `${'a'.repeat(39)}z`, ' '.repeat(40)]) {
    const { state } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: bad } });
    assert.equal(state('approved-sha'), 'FAILED', `${JSON.stringify(bad)} must be refused`);
  }
});

test('gate4-prepare reports an absent environment file as outstanding, never as ready', () => {
  const host = makeHost({ envFile: false });
  const { result, state } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
  assert.equal(state('env-file'), 'PENDING');
  assert.notEqual(result.status, 0);
});

test('gate4-prepare refuses an environment file missing required keys', () => {
  const host = makeHost();
  fs.writeFileSync(host.envPath, 'NODE_ENV=production\n');
  const { state } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
  assert.equal(state('env-file-keys'), 'FAILED');
});

test('gate4-prepare refuses an environment file carrying provider or Telegram credentials', () => {
  const host = makeHost();
  fs.appendFileSync(host.envPath, 'OPENAI_API_KEY=sk-fixture\nTELEGRAM_BOT_TOKEN=fixture\n');
  const { result, state } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
  assert.equal(state('env-file-credential-free'), 'FAILED');
  assert.doesNotMatch(result.stdout, /sk-fixture/, 'the refusal must not echo the credential value');
});

test('gate4-prepare accepts a declared-but-empty forbidden key, which the profile example uses', () => {
  // `OPENAI_API_KEY=` with no value is how the development example documents an unused provider;
  // only a key with an actual value is a violation.
  const host = makeHost();
  fs.appendFileSync(host.envPath, 'OPENAI_API_KEY=\n');
  const { state } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
  assert.equal(state('env-file-credential-free'), 'READY');
});

test('gate4-prepare reports an unseeded workspace as outstanding', () => {
  const host = makeHost({ workspace: false });
  const { result, state } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
  assert.equal(state('workspace-root'), 'PENDING');
  assert.notEqual(result.status, 0);
});

test('gate4-prepare applies the same workspace rules ExecStartPre enforces', () => {
  const sha = 'a'.repeat(40);
  // Not a git checkout.
  const noGit = makeHost();
  fs.rmSync(path.join(noGit.workspaceRoot, '.git'), { recursive: true });
  assert.equal(findings(noGit, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: sha } }).state('workspace-root'), 'FAILED');

  // Missing application files.
  const noApps = makeHost();
  fs.rmSync(path.join(noApps.workspaceRoot, 'apps'), { recursive: true });
  assert.equal(findings(noApps, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: sha } }).state('workspace-root'), 'FAILED');

  // A symlinked root.
  const linked = makeHost({ workspace: false });
  const target = fs.mkdtempSync(path.join(scratch, 'link-target-'));
  fs.symlinkSync(target, linked.workspaceRoot);
  assert.equal(findings(linked, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: sha } }).state('workspace-root'), 'FAILED');
});

test('gate4-prepare refuses a workspace root inside a release', () => {
  const sha = 'a'.repeat(40);
  const host = makeHost();
  const inside = path.join(host.releaseRoot, 'releases', sha, 'workspace');
  fs.mkdirSync(path.join(inside, '.git'), { recursive: true });
  fs.mkdirSync(path.join(inside, 'apps'), { recursive: true });
  fs.mkdirSync(path.join(inside, 'packages'), { recursive: true });
  fs.writeFileSync(path.join(inside, 'package.json'), '{}\n');
  fs.writeFileSync(host.envPath, fs.readFileSync(host.envPath, 'utf8').replace(/^BLACKSPIRE_WORKSPACE_ROOT=.*$/m, `BLACKSPIRE_WORKSPACE_ROOT=${inside}`));
  const { report, state } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: sha } });
  assert.equal(state('workspace-root'), 'FAILED');
  assert.match(report.findings.find((f) => f.id === 'workspace-root').detail, /must not live inside a release/);
});

test('gate4-prepare reports a missing approved release and a present one correctly', () => {
  const host = makeHost({ releases: ['b'.repeat(40)] });
  assert.equal(findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } }).state('approved-release'), 'PENDING');
  assert.equal(findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'b'.repeat(40) } }).state('approved-release'), 'READY');
});

test('gate4-prepare requires a rollback target distinct from the approved release', () => {
  const only = makeHost({ releases: ['a'.repeat(40)] });
  assert.equal(findings(only, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } }).state('rollback-target'), 'PENDING');
  const both = makeHost({ releases: ['a'.repeat(40), 'b'.repeat(40)] });
  assert.equal(findings(both, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } }).state('rollback-target'), 'READY');
});

test('gate4-prepare treats an absent current symlink as preparation, not failure', () => {
  const host = makeHost();
  const { report } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
  const finding = report.findings.find((f) => f.id === 'current-symlink');
  assert.equal(finding.state, 'PENDING');
  assert.match(finding.detail, /activation step, not preparation/);
});

test('gate4-prepare reports missing log rotation as outstanding', () => {
  const host = makeHost({ logrotate: false });
  assert.equal(findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } }).state('log-rotation'), 'PENDING');
});

test('gate4-prepare requires byte-identical API, worker, and target definitions', () => {
  const host = makeHost();
  const approved = { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) };
  assert.equal(findings(host, { env: approved }).state('installed-api-unit'), 'PENDING');
  assert.equal(findings(host, { env: approved }).state('installed-worker-unit'), 'PENDING');
  assert.equal(findings(host, { env: approved }).state('installed-runtime-target'), 'PENDING');

  fs.copyFileSync('ops/runtime-ownership/blackspire-command.service', host.apiUnitPath);
  fs.copyFileSync('ops/runtime-ownership/blackspire-command-worker.service', host.workerUnitPath);
  fs.copyFileSync('ops/runtime-ownership/blackspire-command.target', host.targetPath);
  assert.equal(findings(host, { env: approved }).state('installed-api-unit'), 'READY');
  assert.equal(findings(host, { env: approved }).state('installed-worker-unit'), 'READY');
  assert.equal(findings(host, { env: approved }).state('installed-runtime-target'), 'READY');

  fs.appendFileSync(host.workerUnitPath, '# drift\n');
  assert.equal(findings(host, { env: approved }).state('installed-worker-unit'), 'FAILED');
});

test('gate4-prepare rejects an installed policy that differs from the reviewed rotation policy', () => {
  const host = makeHost();
  fs.writeFileSync(host.logrotatePath, '/var/lib/docker/containers/*/*-json.log { rotate 1 }\n');
  assert.equal(findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } }).state('log-rotation'), 'FAILED');
});

test('gate4-prepare allowlists worker account-derived groups by numeric GID', () => {
  const approved = { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) };
  for (const [label, gids] of [
    ['API credential group', [1301, 1202, 1200]],
    ['API credential supplementary membership', [1202, 1200, 1301]],
    ['equivalent aliased API group membership', [1202, 1200, 1301]],
    ['privileged docker group', [1202, 1200, 999]],
    ['arbitrary unexpected group', [1202, 1200, 1777]],
  ]) {
    const host = makeHost();
    const { report, state } = findings(host, { env: { ...approved, PATH: identityFixture(host, gids) } });
    assert.equal(state('runtime-ownership'), 'FAILED', label);
    assert.match(report.findings.find((entry) => entry.id === 'runtime-ownership').detail, /unexpected GIDs/);
  }
});

test('gate4-prepare preserves worker access to the shared non-secret runtime group', () => {
  const host = makeHost();
  const { state } = findings(host, { env: {
    BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40),
    PATH: identityFixture(host, [1202, 1200]),
  } });
  assert.equal(state('runtime-ownership'), 'READY');
});

// ---------------------------------------------------------------------------
// The authorization boundary
// ---------------------------------------------------------------------------

test('gate4-prepare never reports Gate 4 as authorized, whatever the environment claims', () => {
  const host = makeHost();
  // A fully prepared host still must not cross the boundary, and no variable may forge it.
  const { report, state } = findings(host, {
    env: {
      BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40),
      BLACKSPIRE_GATE4_AUTHORIZATION: 'granted',
      BLACKSPIRE_GATE4_AUTHORIZED: 'true',
      GATE4_APPROVED: 'yes',
    },
  });
  assert.equal(state('gate4-authorization'), 'PENDING');
  assert.equal(report.gate4Authorized, false);
  assert.equal(report.productionActivated, false);
  assert.equal(report.ready, false, 'authorization is terminal: the report can never be fully ready');
});

test('gate4-prepare refuses inactive but enabled legacy units that could boot outside the target', () => {
  const host = makeHost();
  const fakeSystemctl = path.join(host.home, 'systemctl-enabled');
  fs.writeFileSync(fakeSystemctl, '#!/bin/sh\ncase "$*" in *ActiveState*) echo inactive;; *UnitFileState*) echo enabled;; esac\n');
  fs.chmodSync(fakeSystemctl, 0o755);
  const { report } = findings(host, { env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40), BLACKSPIRE_GATE4_SYSTEMCTL: fakeSystemctl } });
  const finding = report.findings.find((entry) => entry.id === 'production-inactive');
  assert.equal(finding.state, 'FAILED');
  assert.match(finding.detail, /must be disabled before preparation/);
});

test('the plan separates preparation from activation and executes nothing', () => {
  const host = makeHost();
  const before = snapshot(host.home);
  const r = run(host, { args: ['--plan'], env: { BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40) } });
  assert.match(r.stdout, /AUTHORIZATION BOUNDARY/);
  const boundary = r.stdout.indexOf('AUTHORIZATION BOUNDARY');
  const preparation = r.stdout.slice(0, boundary);
  const activation = r.stdout.slice(boundary);
  // The activation verbs must appear only after the boundary marker.
  for (const verb of ['systemctl start', 'systemctl enable', 'release-switch.sh']) {
    assert.equal(preparation.includes(verb), false, `${verb} must not appear in the preparation section`);
    assert.ok(activation.includes(verb), `${verb} must appear in the activation section`);
  }
  assert.match(
    preparation,
    /BLACKSPIRE_GATE4_APPROVED_SHA=\$\{BLACKSPIRE_GATE4_APPROVED_SHA\}[\s\\]+bash .*gate4-prepare\.sh --validate-only/,
    'every planned validation must carry the required approved SHA',
  );
  assert.match(preparation, /test ! -e .*command\.env && test ! -L .*command\.env/);
  assert.match(preparation, /PREPARATION[\s\S]*set -euo pipefail[\s\S]*unit snapshot/,
    'snapshot creation must run in a fail-fast preparation shell');
  assert.match(preparation, /test ! -e .*workspace && test ! -L .*workspace/);
  assert.match(preparation, /test ! -e .*logrotate\.conf && test ! -L .*logrotate\.conf/);
  assert.match(preparation, /install -o root -g root -m 0644[\s\\]+.*blackspire-command-logrotate\.conf/);
  assert.match(preparation, /blackspire-command-worker\.service/);
  assert.match(preparation, /blackspire-command\.target/);
  assert.match(preparation, /gate4-[a-f0-9]{40}/, 'the unit backup is bound to the approved SHA');
  assert.match(preparation, /mkdir -m 0700 -- .*gate4-[a-f0-9]{40}/, 'atomic leaf creation makes the first same-SHA snapshot exclusive');
  assert.match(preparation, /\.absent/, 'rollback records definitions proven absent before preparation');
  assert.match(preparation, /\.complete/, 'rollback requires a complete snapshot marker');
  assert.match(preparation, /refusing unsafe installed unit path/, 'symlinked or non-regular installed units fail closed');
  assert.match(preparation, /BLACKSPIRE_GATE4_APPROVED_SHA=\$\{BLACKSPIRE_GATE4_APPROVED_SHA\}[\s\\]+bash .*gate4-rollback-preparation\.sh/,
    'the generated plan must call the canonical tested rollback helper');
  assert.match(preparation, /systemctl daemon-reload/);
  assert.match(preparation, /checkout --detach \$\{BLACKSPIRE_GATE4_APPROVED_SHA\}/);
  assert.match(activation, /systemctl start blackspire-gate4-fixture-nonexistent\.target/);
  assert.doesNotMatch(activation, /systemctl start blackspire-gate4-fixture-nonexistent\.service/);
  assert.ok(activation.indexOf('systemctl start') < activation.indexOf('wait-production-ready.sh'));
  assert.ok(activation.indexOf('wait-production-ready.sh') < activation.indexOf('systemctl enable'));
  assert.match(activation, /wait-production-ready\.sh http:\/\/127\.0\.0\.1:<reviewed-port> .*\.service .*\.service 60 1/);
  assert.match(activation, /activation_failed\(\)[\s\S]*systemctl disable[\s\S]*systemctl stop[\s\S]*stop_rc[\s\S]*if \(\( stop_rc == 0 \)\)[\s\S]*release-rollback\.sh/,
    'release rollback must require successful target shutdown');
  assert.equal(snapshot(host.home), before, 'printing the plan must not change anything');
});

test('the checklist and the script agree on the authorization boundary', () => {
  const checklist = fs.readFileSync(path.join(repo, 'docs', 'GATE4_ACTIVATION_CHECKLIST.md'), 'utf8');
  assert.match(checklist, /Gate 4 is production activation\. \*\*It is not authorized\.\*\*/);
  // Activation commands must be documented only below the boundary heading.
  const boundary = checklist.indexOf('## Authorization boundary');
  assert.ok(boundary > 0, 'the checklist must define the boundary');
  const before = checklist.slice(0, boundary);
  assert.match(before, /BLACKSPIRE_GATE4_APPROVED_SHA=<approved-sha> bash scripts\/gate4-rollback-preparation\.sh/,
    'the checklist must call the same canonical tested rollback helper');
  assert.match(before, /set -euo pipefail[\s\S]*unit_backup_dir=/,
    'the checklist must abort before .complete or topology install when a snapshot write fails');
  const rollbackSource = fs.readFileSync(rollbackScript, 'utf8');
  assert.match(rollbackSource, /missing or ambiguous trusted before-state/);
  assert.match(rollbackSource, /unsafe rollback destination/);
  assert.match(rollbackSource, /trap compensate ERR/);
  for (const verb of ['systemctl start', 'systemctl enable', 'release-switch.sh']) {
    assert.equal(before.includes(verb), false, `${verb} must not be documented as preparation`);
  }
  const activation = checklist.slice(boundary);
  assert.ok(activation.indexOf('systemctl start') < activation.indexOf('wait-production-ready.sh'));
  assert.ok(activation.indexOf('wait-production-ready.sh') < activation.indexOf('systemctl enable'));
  const readinessWaiter = fs.readFileSync(readinessWaiterScript, 'utf8');
  assert.match(readinessWaiter, /ActiveState/);
  assert.match(readinessWaiter, /InvocationID/);
  assert.match(readinessWaiter, /dependencies\?\.worker\?\.generationId/);
  assert.match(readinessWaiter, /final_api_generation.*api_generation/);
  assert.match(readinessWaiter, /deadline_ms/);
  assert.match(activation, /activation_failed\(\)[\s\S]*systemctl disable[\s\S]*systemctl stop[\s\S]*stop_rc[\s\S]*if \(\( stop_rc == 0 \)\)[\s\S]*release-rollback\.sh/,
    'checklist release rollback must require successful target shutdown');
});

test('the reviewed profile example never ships a real secret', () => {
  const profile = fs.readFileSync(path.join(repo, 'scripts', 'production-profile.env.example'), 'utf8');
  for (const key of ['COMMAND_ADMIN_TOKEN', 'SESSION_SECRET']) {
    assert.doesNotMatch(profile, new RegExp(`^${key}=.+$`, 'm'), `${key} must never carry a value in the example`);
  }
  assert.doesNotMatch(profile, /^BLACKSPIRE_RUNTIME_USER=/m, 'shared profile must not select either service identity');
  assert.match(profile, /^BLACKSPIRE_STARTUP_TIMEOUT_SECONDS=30$/m);
  assert.match(profile, /^BLACKSPIRE_HEALTH_TIMEOUT_SECONDS=5$/m);
});

test('gate4-prepare is registered in the trusted test and script inventory surface', () => {
  // The script must be discoverable by the preflight's script sweep rather than living outside it.
  const preflight = fs.readFileSync(path.join(repo, 'scripts', 'production-preflight-check.js'), 'utf8');
  assert.match(preflight, /entry\.isFile\(\) && entry\.name\.endsWith\('\.sh'\)/);
  assert.match(preflight, /collectShellScripts\('scripts'\)/);
  assert.equal(path.extname(script), '.sh');
});

function rollbackFixture({ failUnit = '', failReload = false, absentTarget = false, absentPreparedApi = false, rootPrefix = 'rollback-' } = {}) {
  const root = fs.mkdtempSync(path.join(scratch, rootPrefix));
  const units = ['api.service', 'worker.service', 'command.target'].map((name) => path.join(root, name));
  const backup = path.join(root, 'backup');
  fs.mkdirSync(backup);
  fs.writeFileSync(path.join(backup, '.complete'), '');
  units.forEach((unit, index) => {
    if (!(absentPreparedApi && index === 0)) fs.writeFileSync(unit, `prepared-${index}`);
    const base = path.basename(unit);
    if (absentTarget && index === 2) fs.writeFileSync(path.join(backup, `${base}.absent`), '');
    else fs.writeFileSync(path.join(backup, base), `original-${index}`);
  });
  const envPath = path.join(root, 'command.env');
  const workspaceRoot = path.join(root, 'workspace');
  const logrotatePath = path.join(root, 'logrotate');
  fs.writeFileSync(envPath, `BLACKSPIRE_WORKSPACE_ROOT=${workspaceRoot}\n`); fs.mkdirSync(workspaceRoot); fs.writeFileSync(logrotatePath, 'prepared');
  const systemctl = path.join(root, 'systemctl');
  fs.writeFileSync(systemctl, `#!/bin/sh\n${failReload ? 'exit 71' : 'exit 0'}\n`); fs.chmodSync(systemctl, 0o755);
  const installer = path.join(root, 'install');
  const failureClause = failUnit ? `case \"$arg\" in *${failUnit}) exit 72;; esac\n` : '';
  fs.writeFileSync(installer, `#!/bin/sh\nfor arg do :; done\n${failureClause}exec /usr/bin/install \"$@\"\n`); fs.chmodSync(installer, 0o755);
  const env = { ...process.env, BLACKSPIRE_GATE4_APPROVED_SHA: 'a'.repeat(40), BLACKSPIRE_PRODUCTION_ENV_FILE: envPath,
    BLACKSPIRE_GATE4_LOGROTATE_FILE: logrotatePath,
    BLACKSPIRE_GATE4_API_UNIT_FILE: units[0], BLACKSPIRE_GATE4_WORKER_UNIT_FILE: units[1],
    BLACKSPIRE_GATE4_TARGET_FILE: units[2], BLACKSPIRE_GATE4_UNIT_BACKUP_DIR: backup,
    BLACKSPIRE_GATE4_SYSTEMCTL: systemctl, BLACKSPIRE_GATE4_INSTALL_BIN: installer };
  return { root, units, envPath, workspaceRoot, logrotatePath, env };
}

test('failed second unit restore compensates the first and preserves every non-unit path', () => {
  const fixture = rollbackFixture({ failUnit: 'worker.service' });
  const result = spawnSync('bash', [rollbackScript], { cwd: repo, env: fixture.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  fixture.units.forEach((unit, index) => assert.equal(fs.readFileSync(unit, 'utf8'), `prepared-${index}`));
  for (const item of [fixture.envPath, fixture.workspaceRoot, fixture.logrotatePath]) assert.equal(fs.existsSync(item), true);
});

test('daemon-reload failure compensates all units and preserves non-unit state', () => {
  const fixture = rollbackFixture({ failReload: true });
  const result = spawnSync('bash', [rollbackScript], { cwd: repo, env: fixture.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  fixture.units.forEach((unit, index) => assert.equal(fs.readFileSync(unit, 'utf8'), `prepared-${index}`));
  for (const item of [fixture.envPath, fixture.workspaceRoot, fixture.logrotatePath]) assert.equal(fs.existsSync(item), true);
});

test('an absent prepared unit stays absent when a later restore fails', () => {
  const fixture = rollbackFixture({ absentPreparedApi: true, failUnit: 'worker.service' });
  const result = spawnSync('bash', [rollbackScript], { cwd: repo, env: fixture.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(fixture.units[0]), false, 'compensation must restore prepared absence');
  assert.equal(fs.readFileSync(fixture.units[1], 'utf8'), 'prepared-1');
  assert.equal(fs.readFileSync(fixture.units[2], 'utf8'), 'prepared-2');
  for (const item of [fixture.envPath, fixture.workspaceRoot, fixture.logrotatePath]) assert.equal(fs.existsSync(item), true);
});

test('successful rollback restores present units, removes originally absent units, then deletes prepared state', () => {
  const fixture = rollbackFixture({ absentTarget: true });
  const result = spawnSync('bash', [rollbackScript], { cwd: repo, env: fixture.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(fixture.units[0], 'utf8'), 'original-0');
  assert.equal(fs.readFileSync(fixture.units[1], 'utf8'), 'original-1');
  assert.equal(fs.existsSync(fixture.units[2]), false);
  for (const item of [fixture.envPath, fixture.workspaceRoot, fixture.logrotatePath]) assert.equal(fs.existsSync(item), false);
});

test('rollback derives a non-default workspace from the prepared production profile', () => {
  const fixture = rollbackFixture();
  fixture.env.BLACKSPIRE_WORKSPACE_ROOT = path.join(fixture.root, 'ambient-wrong-workspace');
  const unrelatedDefault = path.join(fixture.root, 'unrelated-default-workspace');
  fs.mkdirSync(unrelatedDefault);
  const result = spawnSync('bash', [rollbackScript], { cwd: repo, env: fixture.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(fixture.workspaceRoot), false, 'the workspace named by the prepared profile is removed');
  assert.equal(fs.existsSync(unrelatedDefault), true, 'an unrelated workspace is never selected by a fallback');
});

test('rollback normalizes a quoted workspace exactly as preparation does', () => {
  const fixture = rollbackFixture();
  fs.writeFileSync(fixture.envPath, `BLACKSPIRE_WORKSPACE_ROOT="${fixture.workspaceRoot}"\n`);
  const result = spawnSync('bash', [rollbackScript], { cwd: repo, env: fixture.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(fixture.workspaceRoot), false);
});

test('rollback keeps workspace and staging paths lossless when they contain a delimiter', () => {
  const fixture = rollbackFixture({ rootPrefix: 'rollback|delimited-' });
  const result = spawnSync('bash', [rollbackScript], { cwd: repo, env: fixture.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(fixture.workspaceRoot), false);
  assert.equal(fs.existsSync(fixture.envPath), false);
  assert.equal(fs.existsSync(fixture.logrotatePath), false);
});
