import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

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

  assert.equal(Object.hasOwn(config, 'ignoreCommand'), false);
  assert.ok(Array.isArray(config.crons));
  assert.ok(config.crons.length > 0);
});
