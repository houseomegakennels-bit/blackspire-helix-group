import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expectedTestFiles, verifyTestInventory } from './test-inventory.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = expectedTestFiles();
const manifestPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-test-manifest-')), 'executed.txt');
const environment = { ...process.env, BLACKSPIRE_TEST_MANIFEST_PATH: manifestPath };
delete environment.BLACKSPIRE_RUN_MIGRATIONS;

const result = spawnSync(process.execPath, [
  '--test',
  '--test-concurrency=1',
  '--import', path.join(rootDirectory, 'scripts/test-execution-marker.js'),
  ...expected.map((file) => path.join(rootDirectory, file)),
], {
  cwd: rootDirectory,
  env: environment,
  stdio: 'inherit',
});

const executed = fs.existsSync(manifestPath)
  ? fs.readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    .map((file) => path.relative(rootDirectory, file).split(path.sep).join('/'))
  : [];

try {
  verifyTestInventory(expected, executed);
  console.log(`# BLACKSPIRE_TEST_INVENTORY ${JSON.stringify({ expected, executed })}`);
} catch (error) {
  console.error(`Test inventory verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(path.dirname(manifestPath), { recursive: true, force: true });
}

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
