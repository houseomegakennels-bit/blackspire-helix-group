import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../scripts/zola-six-read-collect.js', import.meta.url));
const child = fileURLToPath(new URL('../scripts/zola-six-read-candidate-child.js', import.meta.url));

test('actual candidate CLI uses disposable network and API, durable receipts and authenticated denial; strips ambient secrets', { skip: process.getuid() !== 0 }, () => {
  const before = fs.readdirSync('/root').filter(name => name.startsWith('zola-six-read-'));
  const marker = 'candidate-ambient-secret-must-not-enter-child-98430';
  const result = spawnSync(process.execPath, [cli, '--candidate'], { cwd: '/tmp', env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: marker, NEXUS_API_KEY: marker }, encoding: 'utf8', timeout: 35000, maxBuffer: 128 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(`${result.stdout}${result.stderr}`.includes(marker), false);
  const report = JSON.parse(result.stdout);
  assert.equal(report.candidatePass, true); assert.equal(report.livePass, false);
  assert.equal(report.results.length, 6); assert.equal(new Set(report.results.map(row => row.capability)).size, 6);
  assert.equal(report.results.every(row => row.crossOwnerDenial.startsWith('PASS: distinct authenticated')), true);
  assert.equal(report.results.every(row => row.boundedResultCount === 1 && row.observedForbiddenAttempts === 0), true);
  assert.equal(report.exactRerunNewTasks, 0); assert.equal(report.exactRerunNewDispatches, 0);
  assert.equal(report.paidProviderCalls, 0); assert.equal(report.anonymousWrongTokenAdmissions, 0);
  assert.equal(report.remainingGates.length, 3);
  assert.deepEqual(fs.readdirSync('/root').filter(name => name.startsWith('zola-six-read-')), before);
});
test('candidate child refuses ordinary host execution and candidate CLI refuses configuration paths', () => {
  const direct = spawnSync(process.execPath, [child], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(direct.status, 1); assert.equal(direct.stdout, '');
  const wrong = spawnSync(process.execPath, [cli, '--candidate', '/production/credential.json'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(wrong.status, 1); assert.equal(JSON.parse(wrong.stdout).livePass, false);
});
