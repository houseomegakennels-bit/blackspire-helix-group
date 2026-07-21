import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../shared/config.js';

export function esc(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

let connection = null;
let connectionPath = null;

const REQUIRED_SCHEMA = {
  workspaces: ['id', 'name', 'description', 'github_repository', 'default_branch', 'allowed_paths', 'build_commands', 'provider_policy', 'risk_level', 'budget_cents', 'secret_references', 'enabled_tools', 'last_health_status', 'root_path', 'created_at'],
  tasks: ['id', 'workspace_id', 'request', 'status', 'idempotency_key', 'provider', 'plan', 'summary', 'error', 'budget_cents', 'retry_count', 'created_at', 'updated_at', 'worker_id', 'claimed_at', 'heartbeat_at', 'current_stage', 'evidence', 'conversation_id', 'input_id', 'source_channel', 'actor_id', 'action_class', 'authority_class', 'policy_decision'],
  audit_events: ['id', 'task_id', 'actor', 'action', 'details', 'created_at'], approvals: ['id', 'task_id', 'action', 'status', 'reason', 'created_at', 'decided_at', 'risk_level', 'requested_by', 'decided_by', 'decision_note', 'expires_at'],
  provider_usage: ['id', 'task_id', 'provider', 'mode', 'latency_ms', 'input_tokens', 'output_tokens', 'cost_cents', 'created_at'], provider_attempts: ['id', 'task_id', 'provider', 'mode', 'status', 'request_packet', 'response_packet', 'error', 'latency_ms', 'created_at'],
  subtasks: ['id', 'task_id', 'title', 'status', 'stage', 'details', 'created_at', 'updated_at'], changed_files: ['id', 'task_id', 'path', 'status', 'additions', 'deletions', 'created_at'], command_results: ['id', 'task_id', 'command', 'cwd', 'ok', 'code', 'stdout', 'stderr', 'duration_ms', 'created_at'], task_evidence: ['id', 'task_id', 'kind', 'details', 'created_at'], system_flags: ['key', 'value', 'updated_at'],
  sessions: ['id', 'csrf_token', 'created_at', 'expires_at', 'rotated_at', 'user_agent', 'ip', 'revoked_at'], rate_limits: ['bucket_key', 'count', 'window_started_at', 'reset_at', 'window_ms', 'updated_at'], telegram_attachments: ['id', 'task_id', 'workspace_id', 'chat_id', 'file_id', 'file_name', 'mime_type', 'size_bytes', 'kind', 'stored_path', 'text_excerpt', 'transcription_status', 'created_at'],
  conversations: ['id', 'workspace_id', 'status', 'created_at', 'updated_at'], conversation_bindings: ['id', 'conversation_id', 'channel', 'channel_key', 'metadata', 'created_at'], unified_inputs: ['id', 'conversation_id', 'channel', 'actor_id', 'text', 'idempotency_key', 'policy_status', 'created_at'], task_events: ['id', 'conversation_id', 'task_id', 'type', 'payload', 'created_at'], channel_deliveries: ['id', 'event_id', 'conversation_id', 'channel', 'channel_key', 'status', 'attempts', 'last_error', 'next_attempt_at', 'created_at', 'updated_at'],
};

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
    for (const [table, expectedColumns] of Object.entries(REQUIRED_SCHEMA)) {
      if (!db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`database schema migration required: missing table ${table}; run BLACKSPIRE_RUN_MIGRATIONS=true node scripts/migrate.js`);
      const actualColumns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
      const missing = expectedColumns.filter((column) => !actualColumns.has(column));
      if (missing.length) throw new Error(`database schema migration required: ${table} is missing ${missing.join(', ')}; run BLACKSPIRE_RUN_MIGRATIONS=true node scripts/migrate.js`);
    }
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
