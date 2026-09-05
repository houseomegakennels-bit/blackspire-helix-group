import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { rebuildReceivers } from './zola-receiver-rebuild.mjs';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const MAIN = '53adf74e05c607c0d296923bae05d7ac023ecb57';
const BRANCH = 'release/zola-production-live';
const VERSION = '59.11.7';
export class PrebuiltError extends Error {}

// Child output can contain secrets. Keep it exclusively in private runner files.
export async function privateCommand(file, args, { cwd, env, log, timeout = 600000 }) {
  const output = await fs.open(log, 'wx', 0o600);
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0, stdout = '', failed = false, writes = Promise.resolve();
    const stop = () => { failed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(stop, timeout);
    const capture = (chunk, isStdout) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { stop(); return; }
      writes = writes.then(() => output.write(chunk)).catch(stop);
      if (isStdout) stdout += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk) => capture(chunk, true));
    child.stderr.on('data', (chunk) => capture(chunk, false));
    child.on('error', () => { failed = true; });
    child.on('close', async (code) => {
      clearTimeout(timer); await writes; await output.close();
      if (failed || code !== 0) reject(new PrebuiltError('PRIVATE COMMAND FAILED'));
      else resolve(stdout.trim());
    });
  });
}

// --standalone ensures uploaded content is self-contained. Refuse external links.
export async function artifactDigest(root) {
  const hash = createHash('sha256');
  let count = 0;
  async function walk(relative) {
    for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
      if (++count > 100000) throw new PrebuiltError('ARTIFACT LIMIT EXCEEDED');
      const item = path.join(relative, name), full = path.join(root, item);
      const info = await fs.lstat(full);
      hash.update(`${item}\0${info.mode}\0`);
      if (info.isDirectory()) await walk(item);
      else if (info.isFile()) {
        hash.update(String(info.size)); hash.update('\0');
        const file = await fs.open(full, 'r');
        try { for await (const chunk of file.createReadStream()) hash.update(chunk); } finally { await file.close(); }
      } else throw new PrebuiltError('ARTIFACT MUST BE SELF CONTAINED');
    }
  }
  await walk(''); return hash.digest('hex');
}

export function makePrebuiltCreator({ root, tempRoot, cliPath, vercelToken, run = privateCommand,
  digest = artifactDigest, baseEnv = process.env, emit = () => {} }) {
  let serial = 0;
  const cleanEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter((key) => baseEnv[key]).map((key) => [key, baseEnv[key]]));
  cleanEnv.CI = '1';
  return async ({ sha, target, beforeUpload, lookup }) => {
    if (!path.isAbsolute(cliPath ?? '') || !/^[a-f0-9]{40}$/.test(sha) ||
        !['preview', 'production'].includes(target) || (target === 'production' && sha !== MAIN)) throw new PrebuiltError('INVALID PREBUILT TARGET');
    const privateDir = await fs.mkdtemp(path.join(tempRoot, 'zola-prebuilt-'));
    await fs.chmod(privateDir, 0o700);
    const command = async (file, args, cwd, env = cleanEnv, label = 'command') => {
      const log = path.join(privateDir, `${++serial}-${label}.log`);
      emit({ status: 'PREBUILT STEP', target, step: label });
      try { return await run(file, args, { cwd, env, log }); }
      catch {
        const output = await fs.readFile(log, 'utf8').catch(() => '');
        const signatures = ['ENOENT', 'EACCES', 'ERR_MODULE_NOT_FOUND', 'Cannot find module',
          'Failed to compile', 'No Next.js version detected', 'Invalid token', 'npm error',
          'Unable to download', 'not found', 'Root Directory', 'Environment Variables'];
        emit({ status: 'PREBUILT STEP FAILED', target, step: label,
          signatures: signatures.filter((value) => output.includes(value)) });
        throw new PrebuiltError(`PREBUILT ${label.toUpperCase()} FAILED`);
      }
    };
    const version = await command(cliPath, ['--version'], root, cleanEnv, 'version');
    if (!version.includes(VERSION)) throw new PrebuiltError('CLI VERSION MISMATCH');
    const cwd = path.join(privateDir, 'source');
    await command('git', ['worktree', 'add', '--detach', cwd, sha], root, cleanEnv, 'checkout');
    const verifySource = async () => {
      if (await command('git', ['rev-parse', 'HEAD'], cwd, cleanEnv, 'source') !== sha) throw new PrebuiltError('SOURCE SHA MISMATCH');
      await command('git', ['diff', '--exit-code', 'HEAD', '--'], cwd, cleanEnv, 'source-clean');
    };
    await verifySource();
    // Package lifecycle scripts run before any production environment is pulled.
    await command('npm', ['ci', '--prefix', 'frontend', '--no-audit', '--no-fund'], cwd, cleanEnv, 'dependencies');
    await fs.mkdir(path.join(cwd, '.vercel'), { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(cwd, '.vercel/project.json'), JSON.stringify({ projectId: PROJECT, orgId: TEAM }), { mode: 0o600 });
    const env = { ...cleanEnv, VERCEL_TOKEN: vercelToken, VERCEL_ORG_ID: TEAM, VERCEL_PROJECT_ID: PROJECT };
    const pull = ['pull', '--yes', `--environment=${target}`];
    if (target === 'preview') pull.push(`--git-branch=${BRANCH}`);
    await command(cliPath, pull, cwd, env, 'pull');
    const project = JSON.parse(await fs.readFile(path.join(cwd, '.vercel/project.json'), 'utf8'));
    if (project.projectId !== PROJECT || project.orgId !== TEAM || project.settings?.rootDirectory !== 'frontend') throw new PrebuiltError('PROJECT BINDING MISMATCH');
    // Ephemeral local build setting only: dependencies were installed without secrets.
    project.settings.installCommand = '';
    await fs.writeFile(path.join(cwd, '.vercel/project.json'), JSON.stringify(project), { mode: 0o600 });
    await command(cliPath, ['build', '--standalone', ...(target === 'production' ? ['--prod'] : [])], cwd, env, 'build');
    await verifySource();
    const output = path.join(cwd, '.vercel/output');
    const artifactSha256 = await digest(output);
    await beforeUpload();
    await verifySource();
    if (await digest(output) !== artifactSha256) throw new PrebuiltError('ARTIFACT CHANGED');
    // Persist a nonsecret lookup key before upload; never retry an uncertain create.
    emit({ status: 'UPLOAD STARTING', sha, target, artifactSha256 });
    const args = ['deploy', '--prebuilt', '--yes', ...(target === 'production' ? ['--prod'] : []),
      '--meta', `githubCommitSha=${sha}`, '--meta', `githubCommitRef=${target === 'production' ? 'main' : BRANCH}`,
      '--meta', `zolaSourceSha=${sha}`, '--meta', `zolaArtifactSha256=${artifactSha256}`];
    const result = await command(cliPath, args, cwd, env, 'upload');
    if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(result)) throw new PrebuiltError('INVALID DEPLOYMENT URL');
    const deployment = await lookup(new URL(result).hostname);
    return { deployment, proof: { sourceSha: sha, artifactSha256 } };
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const build = makePrebuiltCreator({ root: process.cwd(), tempRoot: process.env.RUNNER_TEMP ?? '/tmp',
    cliPath: process.env.ZOLA_VERCEL_BIN, vercelToken: process.env.VERCEL_TOKEN, emit });
  const creator = async (options) => {
    try { return await build(options); }
    catch (error) {
      emit({ status: error instanceof PrebuiltError ? error.message : 'PREBUILT PREPARATION FAILED',
        ...(error?.code === 'ENOENT' ? { code: 'ENOENT' } : {}) });
      throw error;
    }
  };
  const report = await rebuildReceivers({ vercelToken: process.env.VERCEL_TOKEN, capabilityToken: process.env.ZOLA_CAPABILITY_TOKEN,
    githubToken: process.env.GITHUB_TOKEN, previewSha: process.env.GITHUB_SHA, creator, emit });
  emit(report); if (report.status !== 'READY') process.exitCode = 1;
}
