import fs from 'node:fs';
import path from 'node:path';

// Resolve a path to its canonical real location, resolving symlinks on every existing ancestor. For a target
// that does not exist yet, the deepest existing ancestor is realpath-resolved and the remaining segments are
// appended, so a symlinked parent cannot be used to escape an approved root while a not-yet-created leaf is
// still allowed. Validation of existing ancestors is therefore never weakened by a missing leaf.
export function realResolve(target) {
  let current = path.resolve(target);
  const tail = [];
  while (!fs.existsSync(current)) {
    tail.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const realBase = fs.realpathSync(current);
  return tail.length ? path.join(realBase, ...tail) : realBase;
}

// True when `child` is `root` itself or lives beneath it, comparing canonical (symlink-resolved) paths.
export function within(child, root) {
  const c = realResolve(child);
  const r = realResolve(root);
  return c === r || c.startsWith(r + path.sep);
}

// Refuse to write through an existing symlink at `target` (removing/overwriting it could follow the link).
export function assertNotSymlink(target, fail) {
  try {
    if (fs.lstatSync(target).isSymbolicLink()) fail('path resolves through a symlink');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

// Remove an artifact without following a symlink: unlink removes the link itself, never its target.
export function safeUnlink(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fs.unlinkSync(target);
    else fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
