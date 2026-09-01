import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const API_UNIT = 'ops/runtime-ownership/blackspire-command.service';
const WORKER_UNIT = 'ops/runtime-ownership/blackspire-command-worker.service';
const API_SECRET_FILE = '/etc/blackspire/command-api.env';
const SHARED_FILE = '/etc/blackspire/command.env';
const API_AUTH_KEYS = ['COMMAND_ADMIN_PASSWORD_HASH', 'COMMAND_ADMIN_TOKEN', 'SESSION_SECRET'];

function unit(path) {
  return fs.readFileSync(path, 'utf8');
}

function environmentFiles(source) {
  return [...source.matchAll(/^EnvironmentFile=(.+)$/gm)].map((match) => match[1]);
}

test('systemd gives API and worker distinct Unix identities and only API loads the authentication secret file', () => {
  const api = unit(API_UNIT);
  const worker = unit(WORKER_UNIT);

  assert.match(api, /^User=blackspire-api$/m);
  assert.match(worker, /^User=blackspire-worker$/m);
  assert.match(api, /^Group=blackspire$/m, 'the API may retain the shared state group');
  assert.match(worker, /^Group=blackspire$/m, 'the worker may retain the shared state group');
  assert.notEqual(api.match(/^User=(.+)$/m)?.[1], worker.match(/^User=(.+)$/m)?.[1],
    'same-UID services do not isolate /proc or API credential-file access');

  assert.deepEqual(environmentFiles(api), [SHARED_FILE, API_SECRET_FILE]);
  assert.deepEqual(environmentFiles(worker), [SHARED_FILE]);
  assert.doesNotMatch(worker, /command-api\.env/, 'worker unit must never name the API credential source');
});

test('worker service configuration cannot inject or reconstruct API authentication secrets', () => {
  const worker = unit(WORKER_UNIT);
  for (const key of API_AUTH_KEYS) {
    assert.doesNotMatch(worker, new RegExp(`(?:^|[^A-Z0-9_])${key}(?:=|\\b)`, 'm'),
      `worker service must not mention ${key}`);
  }
  assert.match(worker, /verify-environment\.sh vps-production worker/,
    'worker must enter the role-sensitive fail-closed validator');
});

test('the reviewed shared production profile contains no API authentication secret assignments', () => {
  const profile = fs.readFileSync('scripts/production-profile.env.example', 'utf8');
  for (const key of API_AUTH_KEYS) {
    assert.doesNotMatch(profile, new RegExp(`^${key}=`, 'm'),
      `${key} belongs only in the separately provisioned API credential file`);
  }
});

test('Gate 4 contracts preserve the API-only credential source and never give it to the worker', () => {
  const gate = fs.readFileSync('scripts/gate4-prepare.sh', 'utf8');
  const rollback = fs.readFileSync('scripts/gate4-rollback-preparation.sh', 'utf8');
  const combined = `${gate}\n${rollback}`;

  assert.match(combined, /command-api\.env/,
    'preparation/rollback must account for the separately provisioned API credential source');
  assert.match(gate, /blackspire-command-worker\.service/,
    'Gate 4 must continue validating the worker service template');

  const worker = unit(WORKER_UNIT);
  assert.deepEqual(environmentFiles(worker), [SHARED_FILE],
    'rollback-compatible reviewed worker configuration must remain credential-free');
});

test('Codex regressions cover the password verifier as well as token and session secrets', () => {
  for (const path of ['tests/production-codex-contract.test.js', 'tests/production-execution-profile.test.js']) {
    const source = fs.readFileSync(path, 'utf8');
    for (const key of API_AUTH_KEYS) assert.match(source, new RegExp(key), `${path} must probe ${key} containment`);
  }
});
