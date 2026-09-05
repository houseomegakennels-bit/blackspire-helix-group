import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makePrebuiltCreator, artifactDigest, privateCommand } from '../scripts/zola-receiver-prebuilt.mjs';
const MAIN = '53adf74e05c607c0d296923bae05d7ac023ecb57';
const SECRET = 'test-private-token';
async function fixture(t, { drift = false, changed = false, uncertain = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zola-prebuilt-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [], emitted = [];
  let digests = 0;
  const run = async (file, args, options) => {
    calls.push({ file, args, env: options.env });
    assert.ok(!args.some((arg) => arg.includes(SECRET)));
    if (args[0] === '--version') return '59.11.7';
    if (args[0] === 'rev-parse') return drift ? 'b'.repeat(40) : MAIN;
    if (args[0] === 'pull') {
      await fs.writeFile(path.join(options.cwd, '.vercel/project.json'), JSON.stringify({ projectId: 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou', orgId: 'team_CaRyRaulJaFnCLSfTdyRYNIW', settings: { rootDirectory: 'frontend' } }));
    }
    if (args[0] === 'build') {
      const project = JSON.parse(await fs.readFile(path.join(options.cwd, '.vercel/project.json')));
      assert.equal(project.settings.installCommand, '');
    }
    if (args[0] === 'deploy') {
      assert.ok(emitted.some(x => x.status === 'UPLOAD STARTING'));
      if (uncertain) throw new Error(SECRET);
      return 'https://synthetic.vercel.app';
    }
    return '';
  };
  const creator = makePrebuiltCreator({ root, tempRoot: root, cliPath: '/synthetic/vercel', vercelToken: SECRET, run,
    baseEnv: { PATH: '/synthetic', UNRELATED_SECRET: SECRET }, emit: (value) => emitted.push(value),
    digest: async () => (++digests > 1 && changed ? 'b' : 'a').repeat(64) });
  return { calls, emitted, run: () => creator({ sha: MAIN, target: 'production', beforeUpload: async () => calls.push({ file: 'fence' }), lookup: async (host) => ({ id: 'dpl_synthetic', host }) }) };
}
test('prebuilt installs without credentials then builds isolated exact source and fences before upload', async (t) => {
  const h = await fixture(t); const result = await h.run();
  const deps = h.calls.find((x) => x.file === 'npm');
  assert.equal(deps.env.VERCEL_TOKEN, undefined);
  assert.equal(deps.env.UNRELATED_SECRET, undefined);
  assert.ok(h.calls.some((x) => x.args?.slice(0, 3).join(' ') === 'worktree add --detach'));
  assert.ok(h.calls.findIndex((x) => x.file === 'fence') < h.calls.findIndex((x) => x.args?.[0] === 'deploy'));
  assert.equal(result.proof.sourceSha, MAIN);
  assert.equal(JSON.stringify(h.emitted).includes(SECRET), false);
});
test('source drift and artifact drift prevent upload', async (t) => {
  for (const options of [{ drift: true }, { changed: true }]) {
    const h = await fixture(t, options); await assert.rejects(h.run());
    assert.equal(h.calls.some((x) => x.args?.[0] === 'deploy'), false);
  }
});
test('uncertain upload is attempted once and retains nonsecret lookup metadata', async (t) => {
  const h = await fixture(t, { uncertain: true });
  await assert.rejects(h.run(), /PREBUILT UPLOAD FAILED/);
  assert.equal(h.calls.filter((x) => x.args?.[0] === 'deploy').length, 1);
  assert.equal(h.emitted.find(x => x.status === 'UPLOAD STARTING').sha, MAIN);
  assert.match(h.emitted.find(x => x.status === 'UPLOAD STARTING').artifactSha256, /^[a-f0-9]{64}$/);
});
test('artifact digest changes for content and rejects external symlinks', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zola-digest-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'index'), 'first'); const first = await artifactDigest(root);
  await fs.writeFile(path.join(root, 'index'), 'second'); assert.notEqual(await artifactDigest(root), first);
  await fs.symlink('index', path.join(root, 'internal'));
  const withLink = await artifactDigest(root);
  await fs.writeFile(path.join(root, 'index'), 'third');
  assert.notEqual(await artifactDigest(root), withLink);
  await fs.symlink('/etc/passwd', path.join(root, 'external'));
  await assert.rejects(artifactDigest(root), /SELF CONTAINED/);
});
test('private command drains both streams into a private file and sanitizes failure', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zola-private-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, 'output');
  const result = await privateCommand(process.execPath, ['-e', 'process.stdout.write("ok"); process.stderr.write("private");'], { cwd: root, env: {}, log });
  assert.equal(result, 'ok'); assert.equal((await fs.stat(log)).mode & 0o777, 0o600);
  const content = await fs.readFile(log, 'utf8'); assert.ok(content.includes('ok') && content.includes('private'));
  await assert.rejects(privateCommand(process.execPath, ['-e', 'process.stderr.write("private"); process.exitCode=1'], { cwd: root, env: {}, log: path.join(root, 'failure') }), /PRIVATE COMMAND FAILED/);
});
