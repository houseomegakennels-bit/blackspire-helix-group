import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Reject every symlink in the existing path, not merely a leaf that resolves outside the root.
// Missing trailing components are allowed for initial directory creation.
export function assertNoSymlinkTraversal(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`path contains a symlink: ${current}`);
  }
}

export function snapshotRegularFile(target) {
  assertNoSymlinkTraversal(path.dirname(target));
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('lock path is not a regular non-symlink file');
  return { raw: fs.readFileSync(target, 'utf8'), dev: stat.dev, ino: stat.ino };
}

// Rename first, then verify the object moved was the exact object previously authorized. This
// avoids unlinking a path that was substituted between authorization and mutation. A substituted
// object is restored when possible and is never deleted by this function.
export function removeIdenticalFile(target, expected, { beforeRename } = {}) {
  assertNoSymlinkTraversal(path.dirname(target));
  const immediate = snapshotRegularFile(target);
  if (immediate.dev !== expected.dev || immediate.ino !== expected.ino || immediate.raw !== expected.raw) throw new Error('lock changed after authorization');
  beforeRename?.();
  const quarantine = `${target}.remove-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  fs.renameSync(target, quarantine);
  try {
    const moved = snapshotRegularFile(quarantine);
    if (moved.dev !== expected.dev || moved.ino !== expected.ino || moved.raw !== expected.raw) {
      if (!fs.existsSync(target)) fs.renameSync(quarantine, target);
      throw new Error('lock was substituted before removal');
    }
    fs.unlinkSync(quarantine);
  } catch (error) {
    // Preserve the quarantined object for inspection if safe restoration was not possible.
    throw error;
  }
}
