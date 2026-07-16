import { spawnSync } from 'node:child_process';
import { redact } from '../shared/util.js';

export function getRepositoryMetadata({ cwd = '.' } = {}) {
  return {
    root: git(['rev-parse', '--show-toplevel'], cwd).stdout.trim(),
    branch: git(['branch', '--show-current'], cwd).stdout.trim(),
    remote: git(['remote', 'get-url', 'origin'], cwd).stdout.trim(),
  };
}

export function createTaskBranch(branch, { cwd = '.' } = {}) {
  const result = git(['switch', '-c', branch], cwd);
  return { ok: result.code === 0, branch, ...result };
}

export function commitAll(message, { cwd = '.' } = {}) {
  git(['add', '.'], cwd);
  const result = git(['commit', '-m', message], cwd);
  return { ok: result.code === 0, ...result };
}

export function compareChanges({ cwd = '.', base = 'HEAD~1' } = {}) {
  return git(['diff', '--stat', base], cwd);
}

export function createPullRequest({ title, body, cwd = '.', draft = true } = {}) {
  const gh = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  if (gh.status !== 0 || !process.env.GITHUB_TOKEN) {
    return { ok: false, mode: 'task-packet', title, body, draft, error: 'GitHub CLI/GITHUB_TOKEN unavailable; created PR packet only' };
  }
  const args = ['pr', 'create', '--title', title, '--body', body];
  if (draft) args.push('--draft');
  const result = spawnSync('gh', args, { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, mode: 'gh-cli', url: result.stdout.trim(), stderr: redact(result.stderr), code: result.status };
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: result.status, stdout: redact(result.stdout), stderr: redact(result.stderr) };
}
