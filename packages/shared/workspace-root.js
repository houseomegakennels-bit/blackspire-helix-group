import fs from 'node:fs';
import path from 'node:path';

// The server-side workspace root: the directory Hermes uses as the cwd for git and build
// operations (`workspace.root_path`, consumed by packages/hermes/hermes.js and
// packages/execution/runner.js).
//
// This exists because of the immutable-release architecture. The reviewed systemd unit sets
// `WorkingDirectory=/opt/blackspire-command/current` with `ProtectSystem=strict` and only
// `/opt/blackspire-command/shared` in `ReadWritePaths`, so the process cwd is a release tree that
// is deliberately read-only to the `blackspire` account. A workspace root of `.` therefore points
// every Hermes git/build operation at exactly the tree that must never be mutated. An operator can
// instead name a real, writable checkout through BLACKSPIRE_WORKSPACE_ROOT.
//
// The value is read only from the server's own environment. It is never derived from a request, a
// frontend value, a database row, or a task payload, and there is no route that can set it.
//
// Absent variable => the historical `.` default, unchanged, so development and every existing test
// behave exactly as before. Present variable => strictly validated and failing closed. A supplied
// value that cannot be used is always an error; it never silently degrades back to `.`, because
// that would quietly reintroduce the read-only-release cwd this contract exists to avoid.
export function resolveWorkspaceRoot(env = process.env) {
  const raw = env.BLACKSPIRE_WORKSPACE_ROOT;
  if (raw === undefined || raw === null) return '.';

  const value = String(raw).trim();
  if (!value) fail('workspace root is set but empty; unset BLACKSPIRE_WORKSPACE_ROOT to use the default "."');
  if (value.includes('\0')) fail('workspace root contains a NUL byte');

  // Required absolute: under systemd the cwd is the immutable release, so a relative value would
  // resolve against precisely the read-only tree the caller is trying to move away from.
  if (!path.isAbsolute(value)) fail(`workspace root must be an absolute path: ${value}`);
  const resolved = path.resolve(value);

  // lstat, never stat: a symlinked root must be rejected rather than followed, so the effective
  // working directory cannot be repointed by swapping a link outside the reviewed configuration.
  let stats;
  try {
    stats = fs.lstatSync(resolved);
  } catch (error) {
    if (error.code === 'ENOENT') fail(`workspace root does not exist: ${resolved}`);
    fail(`workspace root could not be inspected: ${error.message}`);
  }
  if (stats.isSymbolicLink()) fail(`workspace root must not be a symlink: ${resolved}`);
  if (!stats.isDirectory()) fail(`workspace root is not a directory: ${resolved}`);

  // Hermes performs git operations here (branch, apply, inspect, commit). A directory that is not
  // a checkout would fail later, mid-task, after state had already been recorded; refuse up front.
  // `.git` is a directory in an ordinary clone and a pointer file in a linked worktree - both are
  // legitimate - but a symlinked `.git` is refused for the same reason as a symlinked root.
  let gitStats;
  try {
    gitStats = fs.lstatSync(path.join(resolved, '.git'));
  } catch (error) {
    if (error.code === 'ENOENT') fail(`workspace root is not a git checkout (no .git entry): ${resolved}`);
    fail(`workspace root .git entry could not be inspected: ${error.message}`);
  }
  if (gitStats.isSymbolicLink()) fail(`workspace root .git entry must not be a symlink: ${resolved}`);
  if (!gitStats.isDirectory() && !gitStats.isFile()) fail(`workspace root has an unusable .git entry: ${resolved}`);

  return resolved;
}

function fail(message) {
  throw new Error(`refusing to start: ${message}`);
}
