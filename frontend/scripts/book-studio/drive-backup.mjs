import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { digest } from './pilot-core.mjs';
const check = (ok, message) => { if (!ok) throw new Error(message); };
export function assertPrivateDriveMetadata(meta, folderId) {
  check(meta && meta.id && !meta.trashed && !meta.driveId, 'Drive metadata unavailable or shared-drive permissions unverified.');
  check(meta.shared === false && Array.isArray(meta.permissions) && meta.permissions.length === 1 && meta.permissions[0].type === 'user' && meta.permissions[0].role === 'owner', 'Owner-only Drive permissions required.');
  if (folderId) check(meta.parents?.length === 1 && meta.parents[0] === folderId, 'Drive parent mismatch.');
}
export async function verifyLocalInventory(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  check(manifest.files?.length > 0, 'Missing inventory.');
  const seen = new Set();
  for (const file of manifest.files) {
    check(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file.name) && !seen.has(file.name), 'Invalid inventory name.');
    seen.add(file.name);
    const bytes = await readFile(path.join(root, file.name));
    check(bytes.length > 0 && bytes.length === file.bytes && digest(bytes) === file.sha256 && createHash('md5').update(bytes).digest('hex') === file.md5, 'Local inventory bytes mismatch.');
  }
  return manifest;
}
/** Transport performs API reads/downloads; JSON verified flags are ignored.
 * Single operator only: exact folder/name lookup resumes interrupted uploads.
 * Uncertain upload errors stop; no blind retries or multi-host exclusion claimed.
 */
export async function backupToDrive(root, folderId, drive) {
  const manifest = await verifyLocalInventory(root);
  const folder = await drive.get(folderId);
  assertPrivateDriveMetadata(folder);
  check(folder.mimeType === 'application/vnd.google-apps.folder', 'Drive folder required.');
  const inventoryBytes = await readFile(path.join(root, 'manifest.json'));
  const files = [...manifest.files, { name: 'manifest.json', bytes: inventoryBytes.length, sha256: digest(inventoryBytes), md5: createHash('md5').update(inventoryBytes).digest('hex') }];
  const receipts = [];
  for (const file of files) {
    const existing = await drive.list(folderId, file.name);
    check(existing.length <= 1, 'Ambiguous duplicate Drive uploads require reconciliation.');
    const uploaded = existing[0] || await drive.upload(folderId, file.name, await readFile(path.join(root, file.name)));
    receipts.push(await verifyDriveFile(file, uploaded.id, folderId, drive));
  }
  await verifyLocalInventory(root);
  return { version: 1, bookId: manifest.bookId, chapterId: manifest.chapterId, folderId, files: receipts };
}
export async function verifyDriveFile(file, fileId, folderId, drive) {
  const meta = await drive.get(fileId);
  assertPrivateDriveMetadata(meta, folderId);
  check(meta.name === file.name && Number(meta.size) === file.bytes, 'Drive file name/size mismatch.');
  if (meta.md5Checksum) check(meta.md5Checksum === file.md5, 'Drive checksum mismatch.');
  const bytes = await drive.download(fileId);
  check(Buffer.isBuffer(bytes) && bytes.length === file.bytes && digest(bytes) === file.sha256, 'Drive download hash mismatch.');
  return { ...file, fileId, folderId, private: true, verifiedWithDriveApi: true };
}
