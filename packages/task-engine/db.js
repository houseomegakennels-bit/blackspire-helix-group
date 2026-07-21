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

function tableColumns(table) {
  return query(`PRAGMA table_info(${table});`).map((row) => row.name);
}

function ensureColumn(table, name, definition) {
  if (!tableColumns(table).includes(name)) execSql(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
}

export function migrate() {
  const db = getDb({ allowCreate: true });
  db.exec(`PRAGMA journal_mode=WAL;
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
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,workspace_id TEXT,status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS conversation_bindings(id TEXT PRIMARY KEY,conversation_id TEXT,channel TEXT,channel_key TEXT,metadata TEXT,created_at TEXT,UNIQUE(channel,channel_key));
CREATE TABLE IF NOT EXISTS unified_inputs(id TEXT PRIMARY KEY,conversation_id TEXT,channel TEXT,actor_id TEXT,text TEXT,idempotency_key TEXT,policy_status TEXT,created_at TEXT,UNIQUE(channel,idempotency_key));
CREATE TABLE IF NOT EXISTS task_events(id TEXT PRIMARY KEY,conversation_id TEXT,task_id TEXT,type TEXT,payload TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS channel_deliveries(id TEXT PRIMARY KEY,event_id TEXT,conversation_id TEXT,channel TEXT,channel_key TEXT,status TEXT,attempts INTEGER,last_error TEXT,next_attempt_at TEXT,created_at TEXT,updated_at TEXT,UNIQUE(event_id,channel,channel_key));
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_events(task_id);
CREATE INDEX IF NOT EXISTS idx_approvals_task_status ON approvals(task_id, status);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON sessions(revoked_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
CREATE INDEX IF NOT EXISTS idx_telegram_attachments_task ON telegram_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_conversation_bindings_conversation ON conversation_bindings(conversation_id);
CREATE INDEX IF NOT EXISTS idx_unified_inputs_conversation ON unified_inputs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_task_events_conversation ON task_events(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_deliveries_status ON channel_deliveries(status, next_attempt_at);`);
  for (const [name, definition] of [['worker_id', 'TEXT'], ['claimed_at', 'TEXT'], ['heartbeat_at', 'TEXT'], ['current_stage', 'TEXT'], ['evidence', 'TEXT'], ['conversation_id', 'TEXT'], ['input_id', 'TEXT'], ['source_channel', 'TEXT'], ['actor_id', 'TEXT'], ['action_class', 'TEXT'], ['authority_class', 'TEXT'], ['policy_decision', 'TEXT']]) ensureColumn('tasks', name, definition);
  for (const [name, definition] of [['risk_level','TEXT'], ['requested_by','TEXT'], ['decided_by','TEXT'], ['decision_note','TEXT'], ['expires_at','TEXT']]) ensureColumn('approvals', name, definition);
}
