import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {shouldIgnoreFrontendBuild} from '../frontend/scripts/vercel-ignore-build.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'));
}

test('the VPS-owned root project is always ignored by Vercel', async () => {
  const config = await readJson('vercel.json');

  assert.deepEqual(Object.keys(config).sort(), ['$schema', 'ignoreCommand']);
  assert.equal(config.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.equal(config.ignoreCommand, 'exit 0');
});

test('the public frontend keeps its independent deploy configuration', async () => {
  const config = await readJson('frontend/vercel.json');

  assert.equal(config.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.equal(config.ignoreCommand, 'node scripts/vercel-ignore-build.mjs');
  assert.ok(Array.isArray(config.crons));
  assert.ok(config.crons.length > 0);
});

test('the frontend ignored-build decision skips only frontend-identical descendants', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'blackspire-vercel-ignore-'));
  t.after(() => rm(temporaryRoot, {recursive: true, force: true}));

  const frontendRoot = path.join(temporaryRoot, 'frontend');
  await mkdir(frontendRoot);
  execFileSync('git', ['init', '--quiet'], {cwd: temporaryRoot});
  execFileSync('git', ['config', 'user.name', 'Blackspire Test'], {cwd: temporaryRoot});
  execFileSync('git', ['config', 'user.email', 'blackspire-test@example.invalid'], {cwd: temporaryRoot});
  await writeFile(path.join(frontendRoot, 'app.js'), 'export const version = 1;\n');
  await writeFile(path.join(temporaryRoot, 'backend.js'), 'export const version = 1;\n');
  execFileSync('git', ['add', '.'], {cwd: temporaryRoot});
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], {cwd: temporaryRoot});
  const base = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: temporaryRoot, encoding: 'utf8'}).trim();

  await writeFile(path.join(temporaryRoot, 'backend.js'), 'export const version = 2;\n');
  execFileSync('git', ['add', '.'], {cwd: temporaryRoot});
  execFileSync('git', ['commit', '--quiet', '-m', 'backend only'], {cwd: temporaryRoot});
  assert.equal(shouldIgnoreFrontendBuild({cwd: frontendRoot, previousSha: base}), true);

  await writeFile(path.join(frontendRoot, 'app.js'), 'export const version = 2;\n');
  execFileSync('git', ['add', '.'], {cwd: temporaryRoot});
  execFileSync('git', ['commit', '--quiet', '-m', 'frontend change'], {cwd: temporaryRoot});
  assert.equal(shouldIgnoreFrontendBuild({cwd: frontendRoot, previousSha: base}), false);
});

test('the frontend build runs when prior deployment evidence is unavailable or untrusted', () => {
  assert.equal(shouldIgnoreFrontendBuild({previousSha: undefined}), false);
  assert.equal(shouldIgnoreFrontendBuild({previousSha: 'not-a-commit'}), false);
  assert.equal(shouldIgnoreFrontendBuild({previousSha: '0'.repeat(40)}), false);
});
