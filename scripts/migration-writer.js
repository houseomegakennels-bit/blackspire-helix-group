import { getDb, query, execSql } from '../packages/task-engine/db.js';

function tableColumns(table) {
  return query(`PRAGMA table_info(${table});`).map((row) => row.name);
}

function ensureColumn(table, name, definition) {
  if (!tableColumns(table).includes(name)) execSql(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
}

export function runMigration() {
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
  // Canonical authorization foundation: no implicit grants or identity backfill.
  db.exec(`CREATE TABLE IF NOT EXISTS auth_principals(id TEXT PRIMARY KEY,type TEXT NOT NULL CHECK(type IN ('admin','service')),actor_id TEXT NOT NULL,authentication_method TEXT NOT NULL,credential_reference TEXT,status TEXT NOT NULL CHECK(status IN ('active','revoked','disabled','expired')),issued_at INTEGER NOT NULL,expires_at INTEGER,revoked_at INTEGER,disabled_at INTEGER,security_version INTEGER NOT NULL CHECK(security_version>0),created_at INTEGER NOT NULL,UNIQUE(type,actor_id));
CREATE TABLE IF NOT EXISTS auth_workspace_grants(id TEXT PRIMARY KEY,principal_id TEXT NOT NULL,workspace_id TEXT NOT NULL,role TEXT NOT NULL,permissions TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked','expired','superseded')),version INTEGER NOT NULL CHECK(version>0),supersedes_grant_id TEXT,issued_at INTEGER NOT NULL,expires_at INTEGER,revoked_at INTEGER,issued_by TEXT,security_version INTEGER NOT NULL CHECK(security_version>0),created_at INTEGER NOT NULL,UNIQUE(principal_id,workspace_id,version));
CREATE TABLE IF NOT EXISTS auth_decisions(id TEXT PRIMARY KEY,principal_id TEXT,principal_type TEXT,workspace_id TEXT,permission TEXT,resource_type TEXT,resource_id TEXT,allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),reason_code TEXT NOT NULL,policy_version TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_auth_principals_lookup ON auth_principals(type,actor_id,status);
CREATE INDEX IF NOT EXISTS idx_auth_grants_active ON auth_workspace_grants(principal_id,workspace_id,status,version);
CREATE INDEX IF NOT EXISTS idx_auth_grants_supersedes ON auth_workspace_grants(supersedes_grant_id);
CREATE INDEX IF NOT EXISTS idx_auth_decisions_lookup ON auth_decisions(principal_id,workspace_id,permission,allowed,created_at);`);
  ensureColumn('sessions', 'principal_id', 'TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_principal ON sessions(principal_id);`);
  // --- Hermes Intelligence Layer (Milestone 1) ---
  // Additive, mock-only orchestration + learning foundation. These tables record structured
  // workflow runs/steps, routing/policy/verification decisions, and *unpromoted* memory
  // candidates. They are deliberately separate from the raw audit stream (audit_events/
  // task_events) and from any future promoted long-term memory table. No secrets are ever stored
  // here: every persisted payload is redacted before insert by packages/hermes-orchestrator.
  db.exec(`CREATE TABLE IF NOT EXISTS hermes_workflow_runs(id TEXT PRIMARY KEY,task_id TEXT,conversation_id TEXT,workspace_id TEXT,actor_id TEXT,channel TEXT,objective TEXT,classification TEXT,status TEXT,outcome TEXT,provider TEXT,agent TEXT,cost_cents INTEGER,started_at TEXT,finished_at TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS hermes_workflow_steps(id TEXT PRIMARY KEY,run_id TEXT,seq INTEGER,name TEXT,status TEXT,detail TEXT,started_at TEXT,finished_at TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS hermes_routing_decisions(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,classification TEXT,candidates TEXT,selected_provider TEXT,selected_agent TEXT,capabilities TEXT,rationale TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS hermes_policy_decisions(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,action_class TEXT,decision TEXT,requires_approval INTEGER,reason TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS hermes_verification_results(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,verifier TEXT,passed INTEGER,checks TEXT,detail TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS hermes_memory_candidates(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,workspace_id TEXT,kind TEXT,scope TEXT,lesson TEXT,evidence_ref TEXT,status TEXT,promoted_at TEXT,created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_hermes_steps_run ON hermes_workflow_steps(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_hermes_runs_task ON hermes_workflow_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_hermes_memory_status ON hermes_memory_candidates(status, created_at);`);
  // --- Hermes Runtime & Provider Framework (Milestone 2) ---
  // Additive. Records real/mock provider invocations (with null-safe usage/cost), per-provider
  // health, and task-scoped single-use approvals. No secrets are stored: every text field is
  // redacted by packages/hermes-orchestrator before insert. Separate from the raw audit stream and
  // from any future promoted memory.
  db.exec(`CREATE TABLE IF NOT EXISTS hermes_provider_invocations(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,provider TEXT,adapter_type TEXT,model TEXT,mode TEXT,status TEXT,attempt INTEGER,input_bytes INTEGER,output_bytes INTEGER,input_tokens INTEGER,output_tokens INTEGER,cost_cents INTEGER,duration_ms INTEGER,timed_out INTEGER,cancelled INTEGER,error TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS hermes_provider_health(provider TEXT PRIMARY KEY,status TEXT,last_success_at TEXT,last_failure_at TEXT,failure_count INTEGER,cooldown_until TEXT,disabled INTEGER,updated_at TEXT);
CREATE TABLE IF NOT EXISTS hermes_approvals(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,scope TEXT,action_class TEXT,status TEXT,granted_by TEXT,reason TEXT,single_use INTEGER,consumed_at TEXT,expires_at TEXT,created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_hermes_invocations_run ON hermes_provider_invocations(run_id);
CREATE INDEX IF NOT EXISTS idx_hermes_approvals_task ON hermes_approvals(task_id, status);`);
  // --- Hermes Verified Outcome Scoring (Milestone 3A) ---
  // Append-only factual evaluations. They are evidence records only: no routing, scorecard,
  // memory-promotion, or background-job behavior is introduced here.
  db.exec(`CREATE TABLE IF NOT EXISTS hermes_outcome_evaluations(id TEXT PRIMARY KEY,evaluation_version TEXT NOT NULL,user_id TEXT,project_id TEXT,workspace_id TEXT NOT NULL,task_id TEXT,run_id TEXT NOT NULL,routing_decision_id TEXT,policy_decision_id TEXT,verification_result_id TEXT,provider_invocation_id TEXT,execution_mode TEXT,provider_id TEXT,classification TEXT,terminal_status TEXT NOT NULL,terminal_outcome TEXT,verification_status TEXT NOT NULL,verifier_confidence TEXT NOT NULL,acceptance_status TEXT NOT NULL,retry_count INTEGER,duration_ms INTEGER,input_tokens INTEGER,output_tokens INTEGER,cost_cents INTEGER,timed_out INTEGER NOT NULL,cancelled INTEGER NOT NULL,rollback_evidence TEXT,stability_evidence TEXT,failure_category TEXT,learning_eligibility TEXT NOT NULL,source_event_start_seq INTEGER,source_event_end_seq INTEGER,evaluator_version TEXT NOT NULL,provenance_digest TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(run_id,evaluation_version));
CREATE TABLE IF NOT EXISTS hermes_outcome_evaluation_components(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL,name TEXT NOT NULL,value TEXT,status TEXT NOT NULL,detail TEXT,created_at TEXT NOT NULL,UNIQUE(evaluation_id,name));
CREATE INDEX IF NOT EXISTS idx_hermes_outcome_workspace_created ON hermes_outcome_evaluations(workspace_id,created_at);
CREATE INDEX IF NOT EXISTS idx_hermes_outcome_run ON hermes_outcome_evaluations(run_id);
CREATE TABLE IF NOT EXISTS hermes_outcome_corrections(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL,workspace_id TEXT NOT NULL,run_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),supersedes_correction_id TEXT,reason TEXT NOT NULL,source_evidence TEXT NOT NULL,actor_principal_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(evaluation_id,version),UNIQUE(supersedes_correction_id));
CREATE TABLE IF NOT EXISTS hermes_outcome_source_events(id TEXT PRIMARY KEY,evaluation_id TEXT NOT NULL,workspace_id TEXT NOT NULL,run_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(event_type IN ('accepted','rejected','partially_accepted','rollback','follow_up_verification','stability_confirmed','regression_linked')),evidence TEXT NOT NULL,actor_principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hermes_outcome_evaluation_failures(id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE,workspace_id TEXT,category TEXT NOT NULL,remediation_state TEXT NOT NULL CHECK(remediation_state IN ('open','retry_requested','resolved')),detail TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_hermes_outcome_corrections_evaluation ON hermes_outcome_corrections(evaluation_id,version);
CREATE INDEX IF NOT EXISTS idx_hermes_outcome_events_evaluation ON hermes_outcome_source_events(evaluation_id,created_at);`);
  for (const [name, definition] of [['worker_id', 'TEXT'], ['claimed_at', 'TEXT'], ['heartbeat_at', 'TEXT'], ['current_stage', 'TEXT'], ['evidence', 'TEXT'], ['conversation_id', 'TEXT'], ['input_id', 'TEXT'], ['source_channel', 'TEXT'], ['actor_id', 'TEXT'], ['action_class', 'TEXT'], ['authority_class', 'TEXT'], ['policy_decision', 'TEXT']]) ensureColumn('tasks', name, definition);
  for (const [name, definition] of [['risk_level','TEXT'], ['requested_by','TEXT'], ['decided_by','TEXT'], ['decision_note','TEXT'], ['expires_at','TEXT']]) ensureColumn('approvals', name, definition);
}
