import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, DATA_DIR } from '../shared/config.js';

export function esc(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

let connection = null;
let connectionPath = null;

export function getDb() {
  if (connection && connectionPath === DB_PATH) return connection;
  if (connection) connection.close();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  connection = new DatabaseSync(DB_PATH);
  connectionPath = DB_PATH;
  connection.exec('PRAGMA journal_mode=WAL;');
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

function tableColumns(table) {
  return query(`PRAGMA table_info(${table});`).map((row) => row.name);
}

function ensureColumn(table, name, definition) {
  if (!tableColumns(table).includes(name)) execSql(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
}

export function migrate() {
  execSql(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT,description TEXT,github_repository TEXT,default_branch TEXT,allowed_paths TEXT,build_commands TEXT,provider_policy TEXT,risk_level TEXT,budget_cents INTEGER,secret_references TEXT,enabled_tools TEXT,last_health_status TEXT,root_path TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,workspace_id TEXT,request TEXT,status TEXT,idempotency_key TEXT UNIQUE,provider TEXT,plan TEXT,summary TEXT,error TEXT,budget_cents INTEGER,retry_count INTEGER,created_at TEXT,updated_at TEXT,worker_id TEXT,claimed_at TEXT,heartbeat_at TEXT,current_stage TEXT,evidence TEXT);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,task_id TEXT,actor TEXT,action TEXT,details TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,task_id TEXT,action TEXT,status TEXT,reason TEXT,created_at TEXT,decided_at TEXT,risk_level TEXT,requested_by TEXT,decided_by TEXT,decision_note TEXT,expires_at TEXT);
CREATE TABLE IF NOT EXISTS provider_usage(id TEXT PRIMARY KEY,task_id TEXT,provider TEXT,mode TEXT,latency_ms INTEGER,input_tokens INTEGER,output_tokens INTEGER,cost_cents INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS provider_attempts(id TEXT PRIMARY KEY,task_id TEXT,provider TEXT,mode TEXT,status TEXT,request_packet TEXT,response_packet TEXT,error TEXT,latency_ms INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS subtasks(id TEXT PRIMARY KEY,task_id TEXT,title TEXT,status TEXT,stage TEXT,details TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS changed_files(id TEXT PRIMARY KEY,task_id TEXT,path TEXT,status TEXT,additions INTEGER,deletions INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS command_results(id TEXT PRIMARY KEY,task_id TEXT,command TEXT,cwd TEXT,ok INTEGER,code INTEGER,stdout TEXT,stderr TEXT,duration_ms INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS task_evidence(id TEXT PRIMARY KEY,task_id TEXT,kind TEXT,details TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,csrf_token TEXT,created_at INTEGER,expires_at INTEGER,rotated_at INTEGER,user_agent TEXT,ip TEXT,revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS rate_limits(bucket_key TEXT PRIMARY KEY,count INTEGER,window_started_at INTEGER,reset_at INTEGER,window_ms INTEGER,updated_at INTEGER);
CREATE TABLE IF NOT EXISTS telegram_attachments(id TEXT PRIMARY KEY,task_id TEXT,workspace_id TEXT,chat_id TEXT,file_id TEXT,file_name TEXT,mime_type TEXT,size_bytes INTEGER,kind TEXT,stored_path TEXT,text_excerpt TEXT,transcription_status TEXT,created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_events(task_id);
CREATE INDEX IF NOT EXISTS idx_approvals_task_status ON approvals(task_id, status);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON sessions(revoked_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
CREATE INDEX IF NOT EXISTS idx_telegram_attachments_task ON telegram_attachments(task_id);`);
  for (const [name, definition] of [['worker_id', 'TEXT'], ['claimed_at', 'TEXT'], ['heartbeat_at', 'TEXT'], ['current_stage', 'TEXT'], ['evidence', 'TEXT']]) ensureColumn('tasks', name, definition);
  for (const [name, definition] of [['risk_level','TEXT'], ['requested_by','TEXT'], ['decided_by','TEXT'], ['decision_note','TEXT'], ['expires_at','TEXT']]) ensureColumn('approvals', name, definition);
}
