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
    const target = canonicalArtifactTarget(relative, cwd, allowedPaths);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(edit.content ?? ''), 'utf8');
    changed.push({ path: path.relative(fs.realpathSync(cwd), target).replaceAll(path.sep, '/'), status: 'modified' });
  }
  return changed;
}

export function artifactsWouldChangeWorkspace(edits, { cwd = '.', allowedPaths = ['.'] } = {}) {
  const seen = new Set();
  for (const edit of edits || []) {
    if (!isPathAllowed(edit.path, allowedPaths)) throw new Error(`Edit path not allowed: ${edit.path}`);
    const target = canonicalArtifactTarget(edit.path, cwd, allowedPaths);
    if (seen.has(target)) throw new Error(`Duplicate edit path: ${edit.path}`);
    seen.add(target);
  }
  return (edits || []).some((edit) => {
    if (!isPathAllowed(edit.path, allowedPaths)) throw new Error(`Edit path not allowed: ${edit.path}`);
    const target = canonicalArtifactTarget(edit.path, cwd, allowedPaths);
    try { return fs.readFileSync(target, 'utf8') !== String(edit.content ?? ''); } catch (error) {
      if (error?.code === 'ENOENT') return true;
      throw error;
    }
  });
}

export function inspectChangedFiles({ cwd = '.' } = {}) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '-uall'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Unable to inspect workspace changes');
  const output = String(result.stdout || '');
  if (!output) return [];
  const fields = output.split('\0');
  const changed = [];
  for (let index = 0; index < fields.length && fields[index]; index += 1) {
    const field = fields[index];
    const status = field.slice(0, 2).trim() || 'modified';
    changed.push({ status, path: field.slice(3) });
    if (status.startsWith('R') || status.startsWith('C')) index += 1;
  }
  return changed;
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

export function commitArtifacts(message, edits, { cwd = '.', allowedPaths = ['.'], protectedBranches = ['main', 'master', 'work'] } = {}) {
  const branch = git(['branch', '--show-current'], cwd).stdout.trim();
  if (isProtectedBranch(branch, protectedBranches)) return { ok: false, code: null, stdout: '', stderr: `Refusing to commit directly on protected branch ${branch}` };
  const targets = new Map();
  const realRoot = fs.realpathSync(cwd);
  for (const edit of edits || []) {
    if (!isPathAllowed(edit.path, allowedPaths)) throw new Error(`Edit path not allowed: ${edit.path}`);
    const target = canonicalArtifactTarget(edit.path, cwd, allowedPaths);
    const relative = path.relative(realRoot, target).replaceAll(path.sep, '/');
    if (targets.has(relative)) throw new Error(`Duplicate edit path: ${edit.path}`);
    if (fs.readFileSync(target, 'utf8') !== String(edit.content ?? '')) throw new Error(`Artifact changed after validation: ${relative}`);
    targets.set(relative, String(edit.content ?? ''));
  }
  const changed = inspectChangedFiles({ cwd }).map((file) => file.path);
  if (changed.length !== targets.size || changed.some((file) => !targets.has(file))) {
    throw new Error('Workspace contains changes outside the approved artifacts');
  }
  ensureGitIdentity({ cwd });
  const add = git(['add', '--', ...targets.keys()], cwd);
  if (add.code !== 0) return { ok: false, ...add };
  const staged = spawnSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd, encoding: 'utf8' });
  const stagedPaths = String(staged.stdout || '').split('\0').filter(Boolean);
  if (staged.status !== 0 || stagedPaths.length !== targets.size || stagedPaths.some((file) => !targets.has(file))) {
    throw new Error('Staged changes do not match the approved artifacts');
  }
  for (const [relative, expected] of targets) {
    const indexed = spawnSync('git', ['show', `:${relative}`], { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (indexed.status !== 0 || indexed.stdout !== expected) throw new Error(`Staged artifact does not match approved content: ${relative}`);
  }
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
  const input = String(filePath || '').replaceAll('\\', '/');
  if (input.startsWith('/')) return false;
  const normalized = path.posix.normalize(input);
  if (normalized === '..' || normalized.startsWith('../')) return false;
  if (allowedPaths.includes('.')) return true;
  return allowedPaths.some((entry) => {
    const allowed = String(entry).replace(/^\.\/?/, '').replace(/\/$/, '');
    return normalized === allowed || normalized.startsWith(`${allowed}/`);
  });
}

function canonicalArtifactTarget(filePath, cwd, allowedPaths) {
  const lexicalTarget = assertInsideWorkspace(filePath, cwd);
  const realRoot = fs.realpathSync(cwd);
  const target = resolvePhysicalTarget(lexicalTarget, filePath);
  if (!isInside(realRoot, target)) throw new Error(`Artifact path escapes workspace: ${filePath}`);
  const allowedRoots = allowedPaths.includes('.')
    ? [realRoot]
    : allowedPaths.map((allowed) => resolvePhysicalTarget(assertInsideWorkspace(allowed, cwd), allowed));
  if (!allowedRoots.some((allowedRoot) => isInside(allowedRoot, target))) throw new Error(`Edit path not allowed after symlink resolution: ${filePath}`);
  return target;
}

function resolvePhysicalTarget(lexicalTarget, displayPath) {
  let existing = lexicalTarget;
  const suffix = [];
  while (!pathEntryExists(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`Artifact parent unavailable: ${displayPath}`);
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...suffix);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function pathEntryExists(target) {
  try { fs.lstatSync(target); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: result.status, stdout: redact(result.stdout), stderr: redact(result.stderr) };
}
