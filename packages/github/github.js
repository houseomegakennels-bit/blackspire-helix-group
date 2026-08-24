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
  const result = git(['-c', 'core.hooksPath=/dev/null', 'commit', '--no-verify', '-m', message], cwd);
  return { ok: result.code === 0, ...result };
}

export function commitArtifacts(message, edits, { cwd = '.', allowedPaths = ['.'], protectedBranches = ['main', 'master', 'work'] } = {}) {
  const branch = git(['branch', '--show-current'], cwd).stdout.trim();
  if (isProtectedBranch(branch, protectedBranches)) return { ok: false, code: null, stdout: '', stderr: `Refusing to commit directly on protected branch ${branch}` };
  const parent = git(['rev-parse', 'HEAD'], cwd);
  if (parent.code !== 0 || !/^[a-f0-9]{40,64}$/.test(parent.stdout.trim())) return { ok: false, ...parent };
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
  const writtenTree = git(['write-tree'], cwd);
  const tree = writtenTree.stdout.trim();
  if (writtenTree.code !== 0 || !/^[a-f0-9]{40,64}$/.test(tree)) return { ok: false, ...writtenTree };
  const treeDiff = spawnSync('git', ['diff-tree', '-r', '--no-commit-id', '--name-only', '-z', parent.stdout.trim(), tree], { cwd, encoding: 'utf8' });
  const treePaths = String(treeDiff.stdout || '').split('\0').filter(Boolean);
  if (treeDiff.status !== 0 || treePaths.length !== targets.size || treePaths.some((file) => !targets.has(file))) {
    throw new Error('Immutable commit tree does not match the approved artifacts');
  }
  for (const [relative, expected] of targets) {
    const blob = spawnSync('git', ['show', `${tree}:${relative}`], { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (blob.status !== 0 || blob.stdout !== expected) throw new Error(`Immutable commit tree has unexpected artifact content: ${relative}`);
    const expectedMode = treeEntryMode(parent.stdout.trim(), relative, cwd) || '100644';
    if (treeEntryMode(tree, relative, cwd) !== expectedMode) throw new Error(`Immutable commit tree has unexpected artifact mode: ${relative}`);
  }
  const commit = git(['commit-tree', tree, '-p', parent.stdout.trim(), '-m', message], cwd);
  const commitId = commit.stdout.trim();
  if (commit.code !== 0 || !/^[a-f0-9]{40,64}$/.test(commitId)) return { ok: false, ...commit };
  const updated = git(['update-ref', '-m', `Hermes artifact commit: ${message}`, `refs/heads/${branch}`, commitId, parent.stdout.trim()], cwd);
  if (updated.code !== 0) return { ok: false, ...updated };
  return { ok: true, code: 0, stdout: `${commitId}\n`, stderr: '' };
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
  if (normalized.split('/').includes('.git')) return false;
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
  const physicalRelative = path.relative(realRoot, target);
  if (physicalRelative.split(path.sep).includes('.git')) throw new Error(`Artifact path targets nested Git control data: ${filePath}`);
  const gitDirectoryResult = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8' });
  if (gitDirectoryResult.status !== 0) throw new Error('Workspace Git directory unavailable');
  const gitDirectory = fs.realpathSync(gitDirectoryResult.stdout.trim());
  if (isInside(gitDirectory, target)) throw new Error(`Artifact path targets Git control data: ${filePath}`);
  assertCanonicalRepositoryTarget(target, realRoot, gitDirectory, filePath);
  const allowedRoots = allowedPaths.includes('.')
    ? [realRoot]
    : allowedPaths.map((allowed) => resolvePhysicalTarget(assertInsideWorkspace(allowed, cwd), allowed));
  if (!allowedRoots.some((allowedRoot) => isInside(allowedRoot, target))) throw new Error(`Edit path not allowed after symlink resolution: ${filePath}`);
  return target;
}

function assertCanonicalRepositoryTarget(target, realRoot, gitDirectory, displayPath) {
  let probe = target;
  while (!pathEntryExists(probe) || !fs.statSync(probe).isDirectory()) {
    const parent = path.dirname(probe);
    if (parent === probe) throw new Error(`Artifact repository boundary unavailable: ${displayPath}`);
    probe = parent;
  }
  const insideGitDirectory = spawnSync('git', ['rev-parse', '--is-inside-git-dir'], { cwd: probe, encoding: 'utf8' });
  if (insideGitDirectory.status !== 0) throw new Error(`Artifact repository boundary unavailable: ${displayPath}`);
  if (insideGitDirectory.stdout.trim() === 'true') throw new Error(`Artifact path targets Git control data: ${displayPath}`);
  const topLevel = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: probe, encoding: 'utf8' });
  const targetGitDirectory = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: probe, encoding: 'utf8' });
  if (topLevel.status !== 0 || targetGitDirectory.status !== 0) throw new Error(`Artifact repository boundary unavailable: ${displayPath}`);
  if (fs.realpathSync(topLevel.stdout.trim()) !== realRoot || fs.realpathSync(targetGitDirectory.stdout.trim()) !== gitDirectory) {
    throw new Error(`Artifact path crosses a repository boundary: ${displayPath}`);
  }
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

function treeEntryMode(treeish, relative, cwd) {
  const result = spawnSync('git', ['ls-tree', '-z', treeish, '--', relative], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Unable to inspect immutable tree entry: ${relative}`);
  const match = String(result.stdout || '').match(/^([0-7]{6})\s/);
  return match?.[1] || null;
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: result.status, stdout: redact(result.stdout), stderr: redact(result.stderr) };
}
