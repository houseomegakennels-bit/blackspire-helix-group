import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DB_PATH, DATA_DIR } from '../shared/config.js';

export function esc(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function execSql(sql) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const result = spawnSync('sqlite3', [DB_PATH], { input: `.timeout 5000\n${sql}`, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'sqlite failed');
  return result.stdout;
}

export function query(sql) {
  const output = execSql(`.mode json\n${sql}`);
  return output.trim() ? JSON.parse(output) : [];
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
CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,task_id TEXT,action TEXT,status TEXT,reason TEXT,created_at TEXT,decided_at TEXT);
CREATE TABLE IF NOT EXISTS provider_usage(id TEXT PRIMARY KEY,task_id TEXT,provider TEXT,mode TEXT,latency_ms INTEGER,input_tokens INTEGER,output_tokens INTEGER,cost_cents INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS provider_attempts(id TEXT PRIMARY KEY,task_id TEXT,provider TEXT,mode TEXT,status TEXT,request_packet TEXT,response_packet TEXT,error TEXT,latency_ms INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS subtasks(id TEXT PRIMARY KEY,task_id TEXT,title TEXT,status TEXT,stage TEXT,details TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS changed_files(id TEXT PRIMARY KEY,task_id TEXT,path TEXT,status TEXT,additions INTEGER,deletions INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS command_results(id TEXT PRIMARY KEY,task_id TEXT,command TEXT,cwd TEXT,ok INTEGER,code INTEGER,stdout TEXT,stderr TEXT,duration_ms INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS task_evidence(id TEXT PRIMARY KEY,task_id TEXT,kind TEXT,details TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT,csrf_token TEXT,ip TEXT,user_agent TEXT,expires_at TEXT,revoked_at TEXT,created_at TEXT,rotated_from TEXT);
CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions(id,expires_at,revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup ON sessions(expires_at,revoked_at);
CREATE TABLE IF NOT EXISTS session_revocations(user_id TEXT PRIMARY KEY,revoked_before TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS rate_limits(scope TEXT,key TEXT,window_start INTEGER,count INTEGER,updated_at TEXT,PRIMARY KEY(scope,key,window_start));
CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup ON rate_limits(updated_at);
CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,task_id TEXT,workspace_id TEXT,telegram_file_id TEXT,path TEXT,mime TEXT,size INTEGER,kind TEXT,content TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS evidence_exports(id TEXT PRIMARY KEY,task_id TEXT,format TEXT,path TEXT,size INTEGER,created_at TEXT);`);
  for (const [name, definition] of [['worker_id', 'TEXT'], ['claimed_at', 'TEXT'], ['heartbeat_at', 'TEXT'], ['current_stage', 'TEXT'], ['evidence', 'TEXT']]) ensureColumn('tasks', name, definition);
}
