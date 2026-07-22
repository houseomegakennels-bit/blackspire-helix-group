import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

export function prepareDisposableDatabase(dbPath) {
  const env = { ...process.env, BLACKSPIRE_DB_PATH: dbPath };
  delete env.BLACKSPIRE_RUN_MIGRATIONS;
  env.BLACKSPIRE_RUN_MIGRATIONS = 'true';
  const result = spawnSync(process.execPath, ['scripts/migrate.js'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { db.close(); }
}
