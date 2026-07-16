import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../shared/util.js';
import { assertInsideWorkspace } from '../execution/runner.js';

export function getRepositoryMetadata({ cwd = '.' } = {}) {
  return {
    root: git(['rev-parse', '--show-toplevel'], cwd).stdout.trim(),
    branch: git(['branch', '--show-current'], cwd).stdout.trim(),
    remote: git(['remote', 'get-url', 'origin'], cwd).stdout.trim(),
  };
}

export function ensureGitIdentity({ cwd = '.' } = {}) {
  if (!git(['config', 'user.email'], cwd).stdout.trim()) git(['config', 'user.email', 'hermes@blackspire.local'], cwd);
  if (!git(['config', 'user.name'], cwd).stdout.trim()) git(['config', 'user.name', 'Hermes Orchestrator'], cwd);
}

export function createTaskBranch(branch, { cwd = '.' } = {}) {
  const exists = git(['rev-parse', '--verify', branch], cwd).code === 0;
  const result = exists ? git(['switch', branch], cwd) : git(['switch', '-c', branch], cwd);
  return { ok: result.code === 0, branch, ...result };
}

export function applyEdits(edits, { cwd = '.', allowedPaths = ['.'] } = {}) {
  const changed = [];
  for (const edit of edits || []) {
    const relative = edit.path;
    if (!isPathAllowed(relative, allowedPaths)) throw new Error(`Edit path not allowed: ${relative}`);
    const target = assertInsideWorkspace(relative, cwd);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(edit.content ?? ''), 'utf8');
    changed.push({ path: relative, status: 'modified' });
  }
  return changed;
}

export function inspectChangedFiles({ cwd = '.' } = {}) {
  const output = git(['status', '--porcelain', '-uall'], cwd).stdout.trim();
  if (!output) return [];
  return output.split('\n').map((line) => ({ status: line.slice(0, 2).trim() || 'modified', path: line.slice(3).trim() }));
}

export function isProtectedBranch(branch, protectedBranches = ['main', 'master', 'work']) {
  return protectedBranches.includes(branch);
}

export function commitAll(message, { cwd = '.', protectedBranches = ['main', 'master', 'work'] } = {}) {
  const branch = git(['branch', '--show-current'], cwd).stdout.trim();
  if (isProtectedBranch(branch, protectedBranches)) return { ok: false, code: null, stdout: '', stderr: `Refusing to commit directly on protected branch ${branch}` };
  ensureGitIdentity({ cwd });
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

function isPathAllowed(filePath, allowedPaths) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (normalized.includes('..') || normalized.startsWith('/')) return false;
  if (allowedPaths.includes('.')) return true;
  return allowedPaths.some((entry) => normalized.startsWith(String(entry).replace(/^\.\/?/, '')));
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: result.status, stdout: redact(result.stdout), stderr: redact(result.stderr) };
}
