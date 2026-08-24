// Canonical list of tables and columns every genuine Blackspire database must contain. This is the
// single source of truth for "does this SQLite file actually belong to this application" - shared by
// packages/task-engine/db.js (gates application startup) and scripts/restore.js (proves a restored
// backup is a real Blackspire database and not merely a file SQLite is willing to open, such as an
// empty or zero-byte file, which SQLite treats as a valid new database with zero tables).
export const REQUIRED_SCHEMA = {
  workspaces: ['id', 'name', 'description', 'github_repository', 'default_branch', 'allowed_paths', 'build_commands', 'provider_policy', 'risk_level', 'budget_cents', 'secret_references', 'enabled_tools', 'last_health_status', 'root_path', 'created_at'],
  tasks: ['id', 'workspace_id', 'request', 'status', 'idempotency_key', 'provider', 'plan', 'summary', 'error', 'budget_cents', 'retry_count', 'created_at', 'updated_at', 'worker_id', 'claim_token', 'claimed_at', 'heartbeat_at', 'current_stage', 'evidence', 'conversation_id', 'input_id', 'source_channel', 'actor_id', 'action_class', 'authority_class', 'policy_decision'],
  audit_events: ['id', 'task_id', 'actor', 'action', 'details', 'created_at'], approvals: ['id', 'task_id', 'action', 'status', 'reason', 'created_at', 'decided_at', 'risk_level', 'requested_by', 'decided_by', 'decision_note', 'expires_at'],
  provider_usage: ['id', 'task_id', 'provider', 'mode', 'latency_ms', 'input_tokens', 'output_tokens', 'cost_cents', 'created_at', 'monetary_cost_state', 'accounting_metadata', 'attempt_id'], provider_attempts: ['id', 'task_id', 'provider', 'mode', 'status', 'request_packet', 'response_packet', 'error', 'latency_ms', 'created_at'],
  subtasks: ['id', 'task_id', 'title', 'status', 'stage', 'details', 'created_at', 'updated_at'], changed_files: ['id', 'task_id', 'path', 'status', 'additions', 'deletions', 'created_at'], command_results: ['id', 'task_id', 'command', 'cwd', 'ok', 'code', 'stdout', 'stderr', 'duration_ms', 'created_at'], task_evidence: ['id', 'task_id', 'kind', 'details', 'created_at'], system_flags: ['key', 'value', 'updated_at'],
  sessions: ['id', 'csrf_token', 'created_at', 'expires_at', 'rotated_at', 'user_agent', 'ip', 'revoked_at', 'principal_id'], rate_limits: ['bucket_key', 'count', 'window_started_at', 'reset_at', 'window_ms', 'updated_at'], telegram_attachments: ['id', 'task_id', 'workspace_id', 'chat_id', 'file_id', 'file_name', 'mime_type', 'size_bytes', 'kind', 'stored_path', 'text_excerpt', 'transcription_status', 'created_at'],
  conversations: ['id', 'workspace_id', 'status', 'created_at', 'updated_at'], conversation_bindings: ['id', 'conversation_id', 'channel', 'channel_key', 'metadata', 'created_at'], unified_inputs: ['id', 'conversation_id', 'channel', 'actor_id', 'text', 'idempotency_key', 'policy_status', 'created_at'], task_events: ['id', 'conversation_id', 'task_id', 'type', 'payload', 'created_at'], channel_deliveries: ['id', 'event_id', 'conversation_id', 'channel', 'channel_key', 'status', 'attempts', 'last_error', 'next_attempt_at', 'created_at', 'updated_at'],
  // Hermes Intelligence Layer (Milestone 1). Additive orchestration/learning tables; kept in sync
  // with the schema-writer in scripts/migration-writer.js so a migrated database validates cleanly.
  hermes_workflow_runs: ['id', 'task_id', 'conversation_id', 'workspace_id', 'actor_id', 'channel', 'objective', 'classification', 'status', 'outcome', 'provider', 'agent', 'cost_cents', 'started_at', 'finished_at', 'created_at', 'requested_provider'],
  hermes_workflow_steps: ['id', 'run_id', 'seq', 'name', 'status', 'detail', 'started_at', 'finished_at', 'created_at'],
  hermes_routing_decisions: ['id', 'run_id', 'task_id', 'classification', 'candidates', 'selected_provider', 'selected_agent', 'capabilities', 'rationale', 'created_at'],
  hermes_policy_decisions: ['id', 'run_id', 'task_id', 'action_class', 'decision', 'requires_approval', 'reason', 'created_at'],
  hermes_verification_results: ['id', 'run_id', 'task_id', 'verifier', 'passed', 'checks', 'detail', 'created_at'],
  hermes_memory_candidates: ['id', 'run_id', 'task_id', 'workspace_id', 'kind', 'scope', 'lesson', 'evidence_ref', 'status', 'promoted_at', 'created_at'],
  // Hermes Runtime & Provider Framework (Milestone 2). Additive; kept in sync with the schema-writer.
  hermes_provider_invocations: ['id', 'run_id', 'task_id', 'provider', 'adapter_type', 'model', 'mode', 'status', 'attempt', 'input_bytes', 'output_bytes', 'input_tokens', 'output_tokens', 'cost_cents', 'duration_ms', 'timed_out', 'cancelled', 'error', 'created_at'],
  hermes_provider_health: ['provider', 'status', 'last_success_at', 'last_failure_at', 'failure_count', 'cooldown_until', 'disabled', 'updated_at'],
  hermes_approvals: ['id', 'run_id', 'task_id', 'scope', 'action_class', 'status', 'granted_by', 'reason', 'single_use', 'consumed_at', 'expires_at', 'created_at'],
  auth_principals: ['id','type','actor_id','authentication_method','credential_reference','status','issued_at','expires_at','revoked_at','disabled_at','security_version','created_at'],
  auth_workspace_grants: ['id','principal_id','workspace_id','role','permissions','status','version','supersedes_grant_id','issued_at','expires_at','revoked_at','issued_by','security_version','created_at'],
  auth_decisions: ['id','principal_id','principal_type','workspace_id','permission','resource_type','resource_id','allowed','reason_code','policy_version','created_at'],
  hermes_outcome_evaluations: ['id', 'evaluation_version', 'user_id', 'project_id', 'workspace_id', 'task_id', 'run_id', 'routing_decision_id', 'policy_decision_id', 'verification_result_id', 'provider_invocation_id', 'execution_mode', 'provider_id', 'classification', 'terminal_status', 'terminal_outcome', 'verification_status', 'verifier_confidence', 'acceptance_status', 'retry_count', 'duration_ms', 'input_tokens', 'output_tokens', 'cost_cents', 'timed_out', 'cancelled', 'rollback_evidence', 'stability_evidence', 'failure_category', 'learning_eligibility', 'source_event_start_seq', 'source_event_end_seq', 'evaluator_version', 'provenance_digest', 'created_at'],
  hermes_outcome_evaluation_components: ['id', 'evaluation_id', 'name', 'value', 'status', 'detail', 'created_at'],
  hermes_outcome_corrections: ['id', 'evaluation_id', 'workspace_id', 'run_id', 'version', 'supersedes_correction_id', 'reason', 'source_evidence', 'actor_principal_id', 'created_at'],
  hermes_outcome_source_events: ['id', 'evaluation_id', 'workspace_id', 'run_id', 'event_type', 'evidence', 'actor_principal_id', 'idempotency_key', 'created_at'],
  hermes_outcome_evaluation_failures: ['id', 'run_id', 'workspace_id', 'category', 'remediation_state', 'detail', 'created_at'],
  // Hermes Verified Scorecards (Milestone 3B). Additive append-only read model over intact 3A
  // evidence; kept in sync with the schema-writer in scripts/migration-writer.js.
  hermes_verified_scorecards: ['id', 'scorecard_version', 'derivation_version', 'workspace_id', 'dimension_provider_id', 'dimension_agent_id', 'dimension_capability', 'dimension_classification', 'cutoff_created_at', 'cutoff_evaluation_id', 'scope_version', 'supersedes_scorecard_id', 'source_evaluation_count', 'confidence_band', 'positive_eligible_count', 'negative_terminal_count', 'blocked_ineligible_count', 'accepted_count', 'rejected_count', 'partially_accepted_count', 'rollback_count', 'follow_up_verification_count', 'stability_confirmed_count', 'regression_linked_count', 'unknown_acceptance_count', 'unknown_rollback_count', 'unknown_stability_count', 'retry_total', 'known_retry_evaluations', 'timeout_count', 'unknown_timeout_count', 'cancellation_count', 'known_input_tokens', 'known_input_token_evaluations', 'known_output_tokens', 'known_output_token_evaluations', 'known_cost_cents', 'known_cost_evaluations', 'verified_success_numerator', 'verified_success_denominator', 'acceptance_numerator', 'acceptance_denominator', 'lineage_digest', 'content_digest', 'created_at'],
  hermes_verified_scorecard_sources: ['id', 'scorecard_id', 'seq', 'evaluation_id', 'workspace_id', 'evaluation_created_at', 'provenance_digest', 'correction_head_id', 'correction_head_version', 'source_event_ids', 'created_at'],
  // Hermes Memory-Candidate Review (Milestone 3C). Additive append-only human review decisions over
  // Milestone 1 candidates; kept in sync with the schema-writer. Review-only: nothing here promotes,
  // and `hermes_memory_candidates.status`/`promoted_at` are never written by this milestone.
  hermes_memory_candidate_reviews: ['id', 'review_version', 'decision_version', 'candidate_id', 'workspace_id', 'run_id', 'task_id', 'decision', 'rationale', 'candidate_kind', 'candidate_scope', 'candidate_status_at_review', 'candidate_digest', 'evaluation_id', 'evaluation_version', 'provenance_digest', 'reviewer_principal_id', 'idempotency_key', 'content_digest', 'lineage_digest', 'created_at'],
  // Hermes Memory-Candidate Re-Review (Milestone 3C, second slice). Additive append-only successor
  // chain over the reviews above; the root review row is never modified and no candidate is written.
  hermes_memory_candidate_rereviews: ['id', 'rereview_version', 'decision_version', 'root_review_id', 'supersedes_rereview_id', 'chain_version', 'candidate_id', 'workspace_id', 'run_id', 'task_id', 'decision', 'rationale', 'candidate_kind', 'candidate_scope', 'candidate_status_at_review', 'candidate_digest', 'evaluation_id', 'evaluation_version', 'provenance_digest', 'predecessor_content_digest', 'predecessor_lineage_digest', 'inherited_context', 'reviewer_principal_id', 'idempotency_key', 'content_digest', 'lineage_digest', 'created_at'],
};

export const REQUIRED_SCHEMA_OBJECTS = {
  index: {
    idx_provider_usage_attempt_unique: { table: 'provider_usage', columns: ['attempt_id'] },
    idx_auth_principals_identity_unique: { table: 'auth_principals', columns: ['type','actor_id'] },
    idx_auth_grants_scope_version_unique: { table: 'auth_workspace_grants', columns: ['principal_id','workspace_id','version'] },
    idx_hermes_outcome_evaluations_run_version_unique: { table: 'hermes_outcome_evaluations', columns: ['run_id','evaluation_version'] },
    idx_hermes_outcome_components_name_unique: { table: 'hermes_outcome_evaluation_components', columns: ['evaluation_id','name'] },
    idx_hermes_outcome_corrections_version_unique: { table: 'hermes_outcome_corrections', columns: ['evaluation_id','version'] },
    idx_hermes_outcome_corrections_parent_unique: { table: 'hermes_outcome_corrections', columns: ['supersedes_correction_id'] },
    idx_hermes_outcome_source_events_idempotency_unique: { table: 'hermes_outcome_source_events', columns: ['idempotency_key'] },
    idx_hermes_outcome_failures_run_unique: { table: 'hermes_outcome_evaluation_failures', columns: ['run_id'] },
    idx_hermes_scorecards_identity_unique: { table: 'hermes_verified_scorecards', columns: ['workspace_id','scorecard_version','dimension_provider_id','dimension_agent_id','dimension_capability','dimension_classification','cutoff_created_at','cutoff_evaluation_id'] },
    idx_hermes_scorecards_scope_version_unique: { table: 'hermes_verified_scorecards', columns: ['workspace_id','scorecard_version','dimension_provider_id','dimension_agent_id','dimension_capability','dimension_classification','scope_version'] },
    idx_hermes_scorecards_parent_unique: { table: 'hermes_verified_scorecards', columns: ['supersedes_scorecard_id'] },
    idx_hermes_scorecard_sources_seq_unique: { table: 'hermes_verified_scorecard_sources', columns: ['scorecard_id','seq'] },
    idx_hermes_scorecard_sources_evaluation_unique: { table: 'hermes_verified_scorecard_sources', columns: ['scorecard_id','evaluation_id'] },
    idx_hermes_memory_reviews_candidate_unique: { table: 'hermes_memory_candidate_reviews', columns: ['candidate_id'] },
    idx_hermes_memory_reviews_idempotency_unique: { table: 'hermes_memory_candidate_reviews', columns: ['workspace_id','idempotency_key'] },
    idx_hermes_memory_candidates_review_queue: { table: 'hermes_memory_candidates', columns: ['workspace_id','status','created_at','id'], unique: false },
    // The chain-shape guarantees. The pair index forbids a fork at every depth including the first
    // successor; the parent index forbids two successors of the same successor.
    idx_hermes_memory_rereviews_chain_unique: { table: 'hermes_memory_candidate_rereviews', columns: ['root_review_id','chain_version'] },
    idx_hermes_memory_rereviews_parent_unique: { table: 'hermes_memory_candidate_rereviews', columns: ['supersedes_rereview_id'] },
    idx_hermes_memory_rereviews_idempotency_unique: { table: 'hermes_memory_candidate_rereviews', columns: ['workspace_id','idempotency_key'] },
  },
  trigger: Object.fromEntries([
    ['trg_hermes_outcome_evaluations_immutable_update','hermes_outcome_evaluations','UPDATE','immutable outcome evaluation'],
    ['trg_hermes_outcome_evaluations_immutable_delete','hermes_outcome_evaluations','DELETE','immutable outcome evaluation'],
    ['trg_hermes_outcome_components_immutable_update','hermes_outcome_evaluation_components','UPDATE','immutable outcome component'],
    ['trg_hermes_outcome_components_immutable_delete','hermes_outcome_evaluation_components','DELETE','immutable outcome component'],
    ['trg_hermes_outcome_corrections_immutable_update','hermes_outcome_corrections','UPDATE','immutable outcome correction'],
    ['trg_hermes_outcome_corrections_immutable_delete','hermes_outcome_corrections','DELETE','immutable outcome correction'],
    ['trg_hermes_outcome_source_events_immutable_update','hermes_outcome_source_events','UPDATE','immutable outcome source event'],
    ['trg_hermes_outcome_source_events_immutable_delete','hermes_outcome_source_events','DELETE','immutable outcome source event'],
    ['trg_hermes_outcome_failures_immutable_update','hermes_outcome_evaluation_failures','UPDATE','immutable outcome failure'],
    ['trg_hermes_outcome_failures_immutable_delete','hermes_outcome_evaluation_failures','DELETE','immutable outcome failure'],
    ['trg_hermes_scorecards_immutable_update','hermes_verified_scorecards','UPDATE','immutable verified scorecard'],
    ['trg_hermes_scorecards_immutable_delete','hermes_verified_scorecards','DELETE','immutable verified scorecard'],
    ['trg_hermes_scorecard_sources_immutable_update','hermes_verified_scorecard_sources','UPDATE','immutable verified scorecard source'],
    ['trg_hermes_scorecard_sources_immutable_delete','hermes_verified_scorecard_sources','DELETE','immutable verified scorecard source'],
    ['trg_hermes_memory_reviews_immutable_update','hermes_memory_candidate_reviews','UPDATE','immutable memory candidate review'],
    ['trg_hermes_memory_reviews_immutable_delete','hermes_memory_candidate_reviews','DELETE','immutable memory candidate review'],
    ['trg_hermes_memory_rereviews_immutable_update','hermes_memory_candidate_rereviews','UPDATE','immutable memory candidate rereview'],
    ['trg_hermes_memory_rereviews_immutable_delete','hermes_memory_candidate_rereviews','DELETE','immutable memory candidate rereview'],
  ].map(([name, table, operation, message]) => [name, {
    table,
    sql: `CREATE TRIGGER ${name} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'${message}'); END`,
  }])),
};

// Security- and integrity-bearing CHECK constraints that must survive backup/restore and startup.
// Column presence, indexes, and triggers are not enough: SQLite's `CREATE TABLE IF NOT EXISTS` will
// leave an existing weakened table untouched, so a database with a removed or widened CHECK would
// otherwise be accepted forever. Expressions are compared as an exact normalized multiset, not by
// substring, so adding `promote`, changing `>0` to `>=0`, or dropping one duplicate-looking guard is
// detected. Keep this inventory synchronized with scripts/migration-writer.js.
const NONNEGATIVE_SCORECARD_FIELDS = [
  'source_evaluation_count', 'positive_eligible_count', 'negative_terminal_count',
  'blocked_ineligible_count', 'accepted_count', 'rejected_count', 'partially_accepted_count',
  'rollback_count', 'follow_up_verification_count', 'stability_confirmed_count',
  'regression_linked_count', 'unknown_acceptance_count', 'unknown_rollback_count',
  'unknown_stability_count', 'retry_total', 'known_retry_evaluations', 'timeout_count',
  'unknown_timeout_count', 'cancellation_count', 'known_input_tokens',
  'known_input_token_evaluations', 'known_output_tokens', 'known_output_token_evaluations',
  'known_cost_cents', 'known_cost_evaluations', 'verified_success_numerator',
  'verified_success_denominator', 'acceptance_numerator', 'acceptance_denominator',
];

export const REQUIRED_TABLE_CHECKS = {
  auth_principals: [
    "type IN ('admin','service')",
    "status IN ('active','revoked','disabled','expired')",
    'security_version>0',
  ],
  auth_workspace_grants: [
    "status IN ('active','revoked','expired','superseded')",
    'version>0',
    'security_version>0',
  ],
  auth_decisions: ['allowed IN (0,1)'],
  hermes_outcome_corrections: ['version>0'],
  hermes_outcome_source_events: [
    "event_type IN ('accepted','rejected','partially_accepted','rollback','follow_up_verification','stability_confirmed','regression_linked')",
  ],
  hermes_outcome_evaluation_failures: ["remediation_state IN ('open','retry_requested','resolved')"],
  hermes_verified_scorecards: [
    'scope_version>0',
    "confidence_band IN ('insufficient','limited','established')",
    ...NONNEGATIVE_SCORECARD_FIELDS.map((field) => `${field}>=0`),
  ],
  hermes_verified_scorecard_sources: ['seq>0'],
  hermes_memory_candidate_reviews: [
    "decision IN ('recommend_promote','reject','defer_needs_evidence')",
    "candidate_scope='workspace'",
    "candidate_status_at_review='pending'",
  ],
  hermes_memory_candidate_rereviews: [
    'chain_version>0',
    "decision IN ('recommend_promote','reject','defer_needs_evidence')",
    "candidate_scope='workspace'",
    "candidate_status_at_review='pending'",
    'id<>root_review_id',
    'supersedes_rereview_id IS NULL OR supersedes_rereview_id<>id',
    '(chain_version=1 AND supersedes_rereview_id IS NULL) OR (chain_version>1 AND supersedes_rereview_id IS NOT NULL)',
  ],
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
  for (const [name, expected] of Object.entries(REQUIRED_SCHEMA_OBJECTS.index)) {
    const index = db.prepare(`PRAGMA index_list("${expected.table}")`).all().find((row) => row.name === name);
    const columns = index ? db.prepare(`PRAGMA index_info("${name}")`).all().map((row) => row.name) : [];
    const schemaRow = db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get('index', name);
    const unique = expected.unique !== false;
    const expectedSql = `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${expected.table}(${expected.columns.join(',')})`;
    if (!index || index.unique !== (unique ? 1 : 0) || index.origin !== 'c' || index.partial !== 0 ||
      normalizeSql(schemaRow?.sql) !== normalizeSql(expectedSql) ||
      columns.length !== expected.columns.length || columns.some((column, position) => column !== expected.columns[position])) missing.push(`invalid index ${name}`);
  }
  for (const [name, expected] of Object.entries(REQUIRED_SCHEMA_OBJECTS.trigger)) {
    const trigger = db.prepare('SELECT tbl_name,sql FROM sqlite_master WHERE type=? AND name=?').get('trigger', name);
    if (!trigger || trigger.tbl_name !== expected.table || normalizeSql(trigger.sql) !== normalizeSql(expected.sql)) missing.push(`invalid trigger ${name}`);
  }
  for (const [table, expectedChecks] of Object.entries(REQUIRED_TABLE_CHECKS)) {
    const schemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!schemaRow) continue; // The required-table pass above already reports the absence.
    const actual = extractCheckExpressions(schemaRow.sql).map(normalizeCheckExpression).sort();
    const expected = expectedChecks.map(normalizeCheckExpression).sort();
    if (actual.length !== expected.length || actual.some((expression, position) => expression !== expected[position])) {
      missing.push(`invalid table constraints ${table}`);
    }
  }
  return missing;
}

function normalizeSql(sql) {
  return String(sql || '').trim().replace(/;$/, '').replace(/\s+/g, ' ').toLowerCase();
}

// Extracts balanced CHECK(...) bodies while respecting SQLite single/double quoted tokens. This is
// deliberately a small syntax-aware scanner rather than a regular expression: CHECK expressions can
// contain nested parentheses and escaped quotes, and a loose textual search can accept a widened
// constraint merely because the old expression survives inside unrelated SQL.
function extractCheckExpressions(sql) {
  const source = String(sql || '');
  const expressions = [];
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i + 1] === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (source.slice(i, i + 5).toLowerCase() !== 'check' || /[A-Za-z0-9_]/.test(source[i - 1] || '') ||
      /[A-Za-z0-9_]/.test(source[i + 5] || '')) continue;
    let open = i + 5;
    while (/\s/.test(source[open] || '')) open += 1;
    if (source[open] !== '(') continue;
    let depth = 1;
    let innerQuote = null;
    let end = open + 1;
    for (; end < source.length && depth > 0; end += 1) {
      const inner = source[end];
      if (innerQuote) {
        if (inner === innerQuote && source[end + 1] === innerQuote) end += 1;
        else if (inner === innerQuote) innerQuote = null;
      } else if (inner === "'" || inner === '"') innerQuote = inner;
      else if (inner === '(') depth += 1;
      else if (inner === ')') depth -= 1;
    }
    if (depth !== 0) return [];
    expressions.push(source.slice(open + 1, end - 1));
    i = end - 1;
  }
  return expressions;
}

function normalizeCheckExpression(expression) {
  let normalized = '';
  let quote = null;
  const source = String(expression || '').trim();
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      normalized += char;
      if (char === quote && source[i + 1] === quote) normalized += source[++i];
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"') { quote = char; normalized += char; }
    else if (!/\s/.test(char)) normalized += char.toLowerCase();
  }
  return normalized;
}

// Sorted names of every ordinary table on `db` (an already-open connection), excluding SQLite's own
// internal `sqlite_%` objects. Used to prove a snapshot faithfully reproduced its source's table set
// without pinning the source to the current application schema - a backup taken immediately before a
// migration legitimately has an older schema and must still be snapshottable. Never opens or closes
// the connection itself - callers own that lifecycle.
export function listTableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
}
