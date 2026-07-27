import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../shared/config.js';
import { findMissingSchemaObjects } from '../shared/schema-validation.js';

export function esc(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

let connection = null;
let connectionPath = null;

function assertDatabaseFile({ allowCreate = false } = {}) {
  const dbPath = path.resolve(DB_PATH);
  if (allowCreate) fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(dbPath)) {
    if (allowCreate) return dbPath;
    throw new Error(`database schema migration required: ${dbPath} does not exist; run BLACKSPIRE_RUN_MIGRATIONS=true node scripts/migrate.js`);
  }
  const stat = fs.lstatSync(dbPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('database path must be an existing regular file');
  return dbPath;
}

export function assertSchemaCompatible() {
  const db = new DatabaseSync(assertDatabaseFile(), { readOnly: true });
  try {
    const missing = findMissingSchemaObjects(db);
    if (missing.length) throw new Error(`database schema migration required: ${missing.join('; ')}; run BLACKSPIRE_RUN_MIGRATIONS=true node scripts/migrate.js`);
  } finally { db.close(); }
}

export function getDb({ allowCreate = false } = {}) {
  if (connection && connectionPath === DB_PATH) return connection;
  if (connection) connection.close();
  connection = new DatabaseSync(assertDatabaseFile({ allowCreate }));
  connectionPath = DB_PATH;
  connection.exec('PRAGMA busy_timeout=5000;');
  connection.exec('PRAGMA foreign_keys=ON;');
  return connection;
}

export function closeDb() {
  if (connection) connection.close();
  connection = null;
  connectionPath = null;
}

// execSql/query remain string-based for backward compatibility with existing
// callers that build literal SQL via esc(). New code should prefer run/all/get
// below, which use real bound parameters.
export function execSql(sql) {
  getDb().exec(sql);
  return '';
}

export function query(sql) {
  const trimmed = sql.trim();
  if (!trimmed) return [];
  return getDb().prepare(trimmed).all().map(plain);
}

function bindArgs(params) {
  return Array.isArray(params) ? params : [params];
}

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...bindArgs(params));
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...bindArgs(params)).map(plain);
}

export function get(sql, params = []) {
  const row = getDb().prepare(sql).get(...bindArgs(params));
  return row ? plain(row) : null;
}

export function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function plain(row) {
  return { ...row };
}
