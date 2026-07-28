// Canonical list of tables and columns every genuine Blackspire database must contain. This is the
// single source of truth for "does this SQLite file actually belong to this application" - shared by
// packages/task-engine/db.js (gates application startup) and scripts/restore.js (proves a restored
// backup is a real Blackspire database and not merely a file SQLite is willing to open, such as an
// empty or zero-byte file, which SQLite treats as a valid new database with zero tables).
export const REQUIRED_SCHEMA = {
  workspaces: ['id', 'name', 'description', 'github_repository', 'default_branch', 'allowed_paths', 'build_commands', 'provider_policy', 'risk_level', 'budget_cents', 'secret_references', 'enabled_tools', 'last_health_status', 'root_path', 'created_at'],
  tasks: ['id', 'workspace_id', 'request', 'status', 'idempotency_key', 'provider', 'plan', 'summary', 'error', 'budget_cents', 'retry_count', 'created_at', 'updated_at', 'worker_id', 'claimed_at', 'heartbeat_at', 'current_stage', 'evidence', 'conversation_id', 'input_id', 'source_channel', 'actor_id', 'action_class', 'authority_class', 'policy_decision'],
  audit_events: ['id', 'task_id', 'actor', 'action', 'details', 'created_at'], approvals: ['id', 'task_id', 'action', 'status', 'reason', 'created_at', 'decided_at', 'risk_level', 'requested_by', 'decided_by', 'decision_note', 'expires_at'],
  provider_usage: ['id', 'task_id', 'provider', 'mode', 'latency_ms', 'input_tokens', 'output_tokens', 'cost_cents', 'created_at'], provider_attempts: ['id', 'task_id', 'provider', 'mode', 'status', 'request_packet', 'response_packet', 'error', 'latency_ms', 'created_at'],
  subtasks: ['id', 'task_id', 'title', 'status', 'stage', 'details', 'created_at', 'updated_at'], changed_files: ['id', 'task_id', 'path', 'status', 'additions', 'deletions', 'created_at'], command_results: ['id', 'task_id', 'command', 'cwd', 'ok', 'code', 'stdout', 'stderr', 'duration_ms', 'created_at'], task_evidence: ['id', 'task_id', 'kind', 'details', 'created_at'], system_flags: ['key', 'value', 'updated_at'],
  sessions: ['id', 'csrf_token', 'created_at', 'expires_at', 'rotated_at', 'user_agent', 'ip', 'revoked_at'], rate_limits: ['bucket_key', 'count', 'window_started_at', 'reset_at', 'window_ms', 'updated_at'], telegram_attachments: ['id', 'task_id', 'workspace_id', 'chat_id', 'file_id', 'file_name', 'mime_type', 'size_bytes', 'kind', 'stored_path', 'text_excerpt', 'transcription_status', 'created_at'],
  conversations: ['id', 'workspace_id', 'status', 'created_at', 'updated_at'], conversation_bindings: ['id', 'conversation_id', 'channel', 'channel_key', 'metadata', 'created_at'], unified_inputs: ['id', 'conversation_id', 'channel', 'actor_id', 'text', 'idempotency_key', 'policy_status', 'created_at'], task_events: ['id', 'conversation_id', 'task_id', 'type', 'payload', 'created_at'], channel_deliveries: ['id', 'event_id', 'conversation_id', 'channel', 'channel_key', 'status', 'attempts', 'last_error', 'next_attempt_at', 'created_at', 'updated_at'],
  // Hermes Intelligence Layer (Milestone 1). Additive orchestration/learning tables; kept in sync
  // with the schema-writer in scripts/migration-writer.js so a migrated database validates cleanly.
  hermes_workflow_runs: ['id', 'task_id', 'conversation_id', 'workspace_id', 'actor_id', 'channel', 'objective', 'classification', 'status', 'outcome', 'provider', 'agent', 'cost_cents', 'started_at', 'finished_at', 'created_at'],
  hermes_workflow_steps: ['id', 'run_id', 'seq', 'name', 'status', 'detail', 'started_at', 'finished_at', 'created_at'],
  hermes_routing_decisions: ['id', 'run_id', 'task_id', 'classification', 'candidates', 'selected_provider', 'selected_agent', 'capabilities', 'rationale', 'created_at'],
  hermes_policy_decisions: ['id', 'run_id', 'task_id', 'action_class', 'decision', 'requires_approval', 'reason', 'created_at'],
  hermes_verification_results: ['id', 'run_id', 'task_id', 'verifier', 'passed', 'checks', 'detail', 'created_at'],
  hermes_memory_candidates: ['id', 'run_id', 'task_id', 'workspace_id', 'kind', 'scope', 'lesson', 'evidence_ref', 'status', 'promoted_at', 'created_at'],
  // Hermes Runtime & Provider Framework (Milestone 2). Additive; kept in sync with the schema-writer.
  hermes_provider_invocations: ['id', 'run_id', 'task_id', 'provider', 'adapter_type', 'model', 'mode', 'status', 'attempt', 'input_bytes', 'output_bytes', 'input_tokens', 'output_tokens', 'cost_cents', 'duration_ms', 'timed_out', 'cancelled', 'error', 'created_at'],
  hermes_provider_health: ['provider', 'status', 'last_success_at', 'last_failure_at', 'failure_count', 'cooldown_until', 'disabled', 'updated_at'],
  hermes_approvals: ['id', 'run_id', 'task_id', 'scope', 'action_class', 'status', 'granted_by', 'reason', 'single_use', 'consumed_at', 'expires_at', 'created_at'],
};

// Returns a list of human-readable descriptions of missing schema objects (empty when the database
// on `db` (an already-open node:sqlite DatabaseSync connection) contains every required table and
// column. Never opens or closes the connection itself - callers own that lifecycle.
export function findMissingSchemaObjects(db) {
  const missing = [];
  for (const [table, expectedColumns] of Object.entries(REQUIRED_SCHEMA)) {
    if (!db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
      missing.push(`missing table ${table}`);
      continue;
    }
    const actualColumns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    const missingColumns = expectedColumns.filter((column) => !actualColumns.has(column));
    if (missingColumns.length) missing.push(`${table} is missing ${missingColumns.join(', ')}`);
  }
  return missing;
}

// Sorted names of every ordinary table on `db` (an already-open connection), excluding SQLite's own
// internal `sqlite_%` objects. Used to prove a snapshot faithfully reproduced its source's table set
// without pinning the source to the current application schema - a backup taken immediately before a
// migration legitimately has an older schema and must still be snapshottable. Never opens or closes
// the connection itself - callers own that lifecycle.
export function listTableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
}
