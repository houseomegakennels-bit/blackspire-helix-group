// The operator gate for real provider execution.
//
// The approved VPS profile is deliberately a no-external-provider profile: it
// pins manual provider mode and refuses to start if any provider credential is
// present. That is correct as a default, but it also means there was no
// documented, validated way for an operator to authorize real execution — the
// production Hermes path could never be reached on the VPS.
//
// These tests pin an explicit opt-in: BLACKSPIRE_PRODUCTION_EXECUTION=enabled.
// Absent or set to anything else, every existing no-provider rule is unchanged.
// Enabled, the preflight requires a coherent, fail-closed execution configuration
// and a credential for every allowlisted provider, so a half-configured opt-in is
// refused before systemd starts the supervisor rather than failing per task.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashAdminPassword } from '../packages/shared/password-auth.js';
import { spawnSync } from 'node:child_process';

// verify-environment.sh rejects a /tmp database as non-persistent, so the
// disposable fixture has to live outside /tmp while staying entirely throwaway.
const disposableBase = ['/var/tmp', process.env.RUNNER_TEMP, os.tmpdir()]
  .filter((base) => typeof base === 'string' && base.length > 0)
  .find((base) => {
    try {
      fs.accessSync(base, fs.constants.W_OK);
      return !`${path.resolve(base)}${path.sep}`.startsWith(`${path.sep}tmp${path.sep}`);
    } catch { return false; }
  });
assert.ok(disposableBase, 'no writable disposable base directory outside /tmp is available');

const root = fs.mkdtempSync(path.join(disposableBase, 'blackspire-production-execution-'));
const dbDir = path.join(root, 'database');
const workspaceRoot = path.join(root, 'workspace');
const codexHome = path.join(root, 'codex-home');
const binDir = path.join(root, 'bin');
fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(codexHome, { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, 'apps'), { recursive: true });
fs.mkdirSync(path.join(workspaceRoot, 'packages'), { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'w', type: 'module' }));
fs.writeFileSync(path.join(binDir, 'codex'), `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${COMMAND_ADMIN_TOKEN:-}" || -n "\${SESSION_SECRET:-}" || -n "\${GITHUB_TOKEN:-}" || -n "\${OPENAI_API_KEY:-}" || -n "\${ANTHROPIC_API_KEY:-}" || -n "\${CODEX_API_KEY:-}" ]]; then
  exit 66
fi
case "\${1:-}" in
  --version) printf 'codex-cli 999.0.0-test\\n' ;;
  doctor)
    [[ "\${2:-}" == "--json" ]] || exit 64
    printf '{"schemaVersion":1,"checks":{"auth.credentials":{"status":"%s"},"network.provider_reachability":{"status":"ok"},"network.websocket_reachability":{"status":"ok"},"installation":{"status":"fail"},"updates.status":{"status":"fail"}}}\\n' "\${TEST_CODEX_AUTH_STATUS:-ok}"
    if [[ "\${TEST_CODEX_DOCTOR_HANG_AFTER_OUTPUT:-false}" == "true" ]]; then
      while :; do sleep 1; done
    fi
    exit "\${TEST_CODEX_DOCTOR_EXIT:-0}"
    ;;
  *) exit 64 ;;
esac
`);
fs.chmodSync(path.join(binDir, 'codex'), 0o755);
assert.equal(spawnSync('git', ['init', '-b', 'main'], { cwd: workspaceRoot, encoding: 'utf8' }).status, 0);

// The production preflight refuses to run as root, so a root test process runs the
// preflight under an unprivileged identity and hands it a tree that identity owns.
const UNPRIVILEGED_UID = 65534;
const runningAsRoot = process.getuid() === 0;
const childUid = runningAsRoot ? UNPRIVILEGED_UID : process.getuid();
const childUsername = runningAsRoot
  ? spawnSync('id', ['-nu', String(UNPRIVILEGED_UID)], { encoding: 'utf8' }).stdout.trim()
  : os.userInfo().username;
const spawnOptions = runningAsRoot ? { uid: UNPRIVILEGED_UID, gid: UNPRIVILEGED_UID } : {};
if (runningAsRoot) {
  for (const dir of [root, dbDir, workspaceRoot, codexHome, binDir]) {
    spawnSync('chown', ['-R', `${UNPRIVILEGED_UID}:${UNPRIVILEGED_UID}`, dir]);
    fs.chmodSync(dir, 0o755);
  }
}

function baseEnv(overrides = {}) {
  const env = {
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME,
    NODE_ENV: 'production',
    BLACKSPIRE_RUNTIME_MODE: 'production',
    BLACKSPIRE_STATE_OWNER: 'vps-production',
    BLACKSPIRE_RUNTIME_USER: childUsername,
    BLACKSPIRE_PROVIDER_MODE: 'manual',
    BLACKSPIRE_HERMES_MODE: 'restricted-test',
    TELEGRAM_MODE: 'dry-run',
    UNIFIED_IPHONE_TEST_MODE: 'false',
    BIND_HOST: '127.0.0.1',
    PORT: '8799',
    BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '30',
    BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '5',
    BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT: 'true',
    BLACKSPIRE_DB_PATH: path.join(dbDir, 'command.sqlite'),
    BLACKSPIRE_WORKSPACE_ROOT: workspaceRoot,
    CODEX_HOME: codexHome,
    COMMAND_ADMIN_TOKEN: 'x'.repeat(32),
    COMMAND_ADMIN_PASSWORD_HASH: hashAdminPassword('production-pass'),
    SESSION_SECRET: 'y'.repeat(40),
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return env;
}

// The coherent opt-in: execution enabled, Codex CLI provider mode, production Hermes,
// and a mock-free allowlist. The CLI authenticates itself; no provider credential is injected.
function executionEnv(overrides = {}) {
  return baseEnv({
    BLACKSPIRE_PRODUCTION_EXECUTION: 'enabled',
    BLACKSPIRE_PROVIDER_MODE: 'codex',
    BLACKSPIRE_HERMES_MODE: 'production',
    BLACKSPIRE_PRODUCTION_PROVIDERS: 'codex',
    BLACKSPIRE_PRODUCTION_MODEL: 'operator-selected-model',
    ...overrides,
  });
}

function verify(env) {
  return spawnSync('bash', ['scripts/verify-environment.sh', 'vps-production'], { cwd: process.cwd(), encoding: 'utf8', env, ...spawnOptions });
}

test('the default no-provider profile is unchanged and still refuses credentials', () => {
  assert.equal(verify(baseEnv()).status, 0, 'the approved no-provider profile still passes');
  const withKey = verify(baseEnv({ OPENAI_API_KEY: 'operator-supplied-credential-0123456789' }));
  assert.notEqual(withKey.status, 0);
  assert.match(withKey.stderr, /production profile forbids OPENAI_API_KEY/);
  const nonManual = verify(baseEnv({ BLACKSPIRE_PROVIDER_MODE: 'openai' }));
  assert.notEqual(nonManual.status, 0);
  assert.match(nonManual.stderr, /manual provider mode/);
});

test('an unrecognized value for the execution opt-in fails closed', () => {
  for (const value of ['true', 'yes', '1', 'Enabled', 'on', '']) {
    const result = verify(executionEnv({ BLACKSPIRE_PRODUCTION_EXECUTION: value }));
    assert.notEqual(result.status, 0, `${JSON.stringify(value)} must not authorize production execution`);
  }
});

test('a coherent explicit opt-in authorizes real provider execution', () => {
  const result = verify(executionEnv());
  assert.equal(result.status, 0, `the coherent opt-in must pass: ${result.stderr}`);
});

test('Codex readiness accepts healthy auth and transport despite unrelated doctor failures', () => {
  const result = verify(executionEnv({ TEST_CODEX_DOCTOR_EXIT: '17' }));
  assert.equal(result.status, 0, `installation/update diagnostics must not override healthy provider readiness: ${result.stderr}`);
});

test('Codex readiness fails closed when doctor authentication is unhealthy', () => {
  const result = verify(executionEnv({ TEST_CODEX_AUTH_STATUS: 'fail' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authenticated Codex CLI and reachable provider transport/);
});

test('Codex readiness rejects a healthy report from a probe that never completes', () => {
  const started = Date.now();
  const result = verify(executionEnv({ TEST_CODEX_DOCTOR_HANG_AFTER_OUTPUT: 'true' }));
  assert.notEqual(result.status, 0);
  assert.ok(Date.now() - started < 5_000, 'print-then-hang doctor probe must remain bounded');
  assert.match(result.stderr, /authenticated Codex CLI and reachable provider transport/);
});

test('the opt-in refuses a Hermes mode that cannot reach a provider', () => {
  for (const mode of ['mock', 'restricted-test', 'restricted', '']) {
    const result = verify(executionEnv({ BLACKSPIRE_HERMES_MODE: mode }));
    assert.notEqual(result.status, 0, `Hermes mode ${JSON.stringify(mode)} cannot execute in production`);
  }
});

test('the opt-in refuses a manual or mock provider mode that contradicts it', () => {
  for (const mode of ['manual', 'mock']) {
    const result = verify(executionEnv({ BLACKSPIRE_PROVIDER_MODE: mode }));
    assert.notEqual(result.status, 0, `provider mode ${mode} contradicts production execution`);
    assert.match(result.stderr, /provider mode/);
  }
});

test('the opt-in requires a mock-free, non-empty server allowlist', () => {
  for (const allowlist of [undefined, '', '  ', 'mock', 'openai,mock']) {
    const result = verify(executionEnv({ BLACKSPIRE_PRODUCTION_PROVIDERS: allowlist }));
    assert.notEqual(result.status, 0, `allowlist ${JSON.stringify(allowlist)} must be refused`);
  }
});

test('the opt-in refuses an unknown provider in the allowlist', () => {
  const result = verify(executionEnv({ BLACKSPIRE_PRODUCTION_PROVIDERS: 'openai,totally-unknown' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /allowlist/);
});

test('the opt-in refuses metered API providers until cost accounting can enforce the ceiling', () => {
  for (const provider of ['openai', 'anthropic']) {
    const result = verify(executionEnv({ BLACKSPIRE_PROVIDER_MODE: provider, BLACKSPIRE_PRODUCTION_PROVIDERS: provider }));
    assert.notEqual(result.status, 0, `${provider} must not be preflight-authorized without cost accounting`);
    assert.match(result.stderr, /cost accounting/);
  }
});

test('the opt-in refuses Claude Code until production accounting is reviewed', () => {
  const result = verify(executionEnv({ BLACKSPIRE_PROVIDER_MODE: 'claudeCode', BLACKSPIRE_PRODUCTION_PROVIDERS: 'claudeCode' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /claudeCode is disabled/);
});

test('the opt-in refuses Codex direct-api credentials because only CLI execution is implemented', () => {
  const result = verify(executionEnv({ CODEX_API_KEY: 'operator-supplied-credential-0123456789', CODEX_API_ENDPOINT: 'https://codex.example.invalid' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /direct-api is not implemented/);
});

test('the opt-in refuses unavailable Codex CLI', () => {
  const result = verify(executionEnv({ PATH: process.env.PATH }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Codex CLI/);
});

test('production preflight bounds a hanging Codex process tree', () => {
  const hangingBin = path.join(root, 'hanging-bin');
  const descendantPid = path.join(root, 'probe-descendant.pid');
  fs.mkdirSync(hangingBin, { recursive: true });
  fs.writeFileSync(descendantPid, '');
  fs.chmodSync(descendantPid, 0o666);
  fs.writeFileSync(path.join(hangingBin, 'codex'), `#!/usr/bin/env bash
(trap '' TERM; while :; do sleep 1; done) &
printf '%s' "$!" > ${JSON.stringify(descendantPid)}
trap 'exit 0' TERM
while :; do sleep 1; done
`);
  fs.chmodSync(path.join(hangingBin, 'codex'), 0o755);
  const started = Date.now();
  const result = verify(executionEnv({ PATH: `${hangingBin}${path.delimiter}${process.env.PATH}` }));
  assert.notEqual(result.status, 0);
  assert.ok(Date.now() - started < 5_000, 'hung preflight probe must be TERM/KILL bounded');
  assert.match(result.stderr, /Codex CLI/);
  const pid = Number(fs.readFileSync(descendantPid, 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 0, 'fixture must start a descendant');
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'preflight must kill a TERM-ignoring descendant after its leader exits');
});

test('the opt-in requires Codex home outside protected home', () => {
  for (const value of [undefined, '', '/root/.codex', '/home/blackspire/.codex']) {
    const result = verify(executionEnv({ CODEX_HOME: value }));
    assert.notEqual(result.status, 0, `CODEX_HOME ${JSON.stringify(value)} must be refused`);
    assert.match(result.stderr, /CODEX_HOME/);
  }
});

test('the opt-in still refuses a credential that is not for an allowlisted provider', () => {
  const result = verify(executionEnv({ OPENAI_API_KEY: 'operator-supplied-credential-0123456789' }));
  assert.notEqual(result.status, 0, 'an unallowlisted credential must not be loaded into production');
  assert.match(result.stderr, /OPENAI_API_KEY/);
});

test('the opt-in does not relax the unrelated production boundaries', () => {
  for (const [override, pattern] of [
    [{ TELEGRAM_BOT_TOKEN: 'operator-supplied-credential-0123456789' }, /TELEGRAM_BOT_TOKEN/],
    [{ TELEGRAM_MODE: 'mock' }, /test mode or mock Telegram/],
    [{ UNIFIED_IPHONE_TEST_MODE: 'true' }, /test mode/],
    [{ BIND_HOST: '0.0.0.0' }, /BIND_HOST/],
    [{ BLACKSPIRE_STATE_OWNER: 'vps-prod' }, /state owner/],
    [{ BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT: 'false' }, /requires BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT=true/],
  ]) {
    const result = verify(executionEnv(override));
    assert.notEqual(result.status, 0, `${JSON.stringify(override)} must still be refused`);
    assert.match(result.stderr, pattern);
  }
});

test('the documented production profile carries the opt-in, disabled, with its required keys', () => {
  const profile = fs.readFileSync('scripts/production-profile.env.example', 'utf8');
  assert.match(profile, /^BLACKSPIRE_PRODUCTION_EXECUTION=disabled$/m, 'the profile ships the opt-in explicitly disabled');
  assert.match(profile, /^BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT=true$/m, 'production readiness must require the worker');
  for (const key of ['BLACKSPIRE_PRODUCTION_PROVIDERS', 'BLACKSPIRE_PRODUCTION_MODEL', 'CODEX_HOME']) {
    assert.ok(profile.includes(key), `the profile documents ${key}`);
  }
  assert.ok(!/^OPENAI_API_KEY=\S/m.test(profile), 'the profile never commits a provider credential');
});

test.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
