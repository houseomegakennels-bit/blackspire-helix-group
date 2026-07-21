#!/usr/bin/env bash
# Credential-free verification of the least-privileged ownership map against the runtime gate.
#
# It does NOT create users/groups, chown/chmod live paths, bind ports, or touch production.
# It builds a throwaway temp tree mirroring OWNERSHIP_MAP.md and drives verifyVpsRuntime with
# INJECTED fixtures (intended uid, ownership, writability), then asserts the planned map both
# passes when correct and fails closed on the documented violations. Requires Node >= 22.5.
set -euo pipefail
cd "$(dirname "$0")/../.."

node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyVpsRuntime } from './packages/shared/security.js';

// Disposable fixture tree mirroring the planned /opt/blackspire-command layout.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-ownership-fixture-'));
const releaseRoot = path.join(root, 'opt', 'blackspire-command');
const shared = path.join(releaseRoot, 'shared');
const dbDir = path.join(shared, 'database');
for (const d of [path.join(releaseRoot, 'releases', 'a'.repeat(40)), dbDir,
                 path.join(shared, 'evidence'), path.join(shared, 'backups')]) {
  fs.mkdirSync(d, { recursive: true });
}

const RUNTIME_UID = 1001;                 // intended non-root blackspire uid (fixture value)
const dbPath = path.join(dbDir, 'command.sqlite');

// The planned profile the durable systemd service would run with.
const env = {
  NODE_ENV: 'production', BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_PROVIDER_MODE: 'manual',
  BLACKSPIRE_HERMES_MODE: 'restricted', TELEGRAM_MODE: 'dry-run', UNIFIED_IPHONE_TEST_MODE: 'false',
  PORT: '8787', BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '30', BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '5',
  BLACKSPIRE_RUNTIME_USER: 'blackspire', BLACKSPIRE_DB_PATH: dbPath,
  BLACKSPIRE_RELEASE_ROOT: releaseRoot,
};

// Injected fixtures encode the ownership map: the four persistent dirs are owned by and
// writable to the runtime uid; the runtime is the non-root blackspire user.
const okOpts = {
  uid: RUNTIME_UID, username: 'blackspire', nodeVersion: '22.23.1',
  isWritable: () => true, dirOwnerUid: () => RUNTIME_UID,
  dirExists: (d) => fs.existsSync(d),
};

// 1) The planned map passes.
let r = verifyVpsRuntime(env, okOpts);
assert.equal(r.ok, true, 'planned ownership map must pass verifyVpsRuntime: ' + r.errors.join('; '));
console.log('PASS  planned map accepted (non-root, uid-owned shared/{database,evidence,backups})');

// 2) Root runtime is rejected.
r = verifyVpsRuntime(env, { ...okOpts, uid: 0 });
assert.equal(r.ok, false); assert.match(r.errors.join(), /must not run as root/);
console.log('PASS  root runtime rejected');

// 3) A persistent dir owned by another user (e.g. root) is rejected.
r = verifyVpsRuntime(env, { ...okOpts, dirOwnerUid: () => 0 });
assert.equal(r.ok, false); assert.match(r.errors.join(), /not owned/);
console.log('PASS  wrong-owner persistent directory rejected');

// 4) An unwritable persistent dir is rejected.
r = verifyVpsRuntime(env, { ...okOpts, isWritable: () => false });
assert.equal(r.ok, false); assert.match(r.errors.join(), /not writable/);
console.log('PASS  unwritable persistent directory rejected');

// 5) A runtime-user mismatch is rejected.
r = verifyVpsRuntime(env, { ...okOpts, username: 'root' });
assert.equal(r.ok, false); assert.match(r.errors.join(), /RUNTIME_USER/);
console.log('PASS  runtime-user mismatch rejected');

// 6) No secret value is ever emitted, even when one is (mis)present in the env.
const leaked = JSON.stringify(verifyVpsRuntime({ ...env, COMMAND_ADMIN_TOKEN: 'super-secret' }, okOpts));
assert.doesNotMatch(leaked, /super-secret/);
console.log('PASS  no secret value leaked in verifier output');

fs.rmSync(root, { recursive: true, force: true });
console.log('\nOWNERSHIP MAP VERIFICATION: all checks passed (credential-free, disposable fixture).');
NODE
