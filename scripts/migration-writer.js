import { getDb, query, execSql } from '../packages/task-engine/db.js';
import { findMissingSchemaObjects } from '../packages/shared/schema-validation.js';
import { seedWorkspace } from '../packages/workspace-registry/workspaces.js';

function tableColumns(table) {
  return query(`PRAGMA table_info(${table});`).map((row) => row.name);
}

function ensureColumn(table, name, definition) {
  if (!tableColumns(table).includes(name)) execSql(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
}

export function runMigration() {
  const db = getDb({ allowCreate: true });
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('BEGIN IMMEDIATE;');
  try {
  db.exec(`CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT,description TEXT,github_repository TEXT,default_branch TEXT,allowed_paths TEXT,build_commands TEXT,provider_policy TEXT,risk_level TEXT,budget_cents INTEGER,secret_references TEXT,enabled_tools TEXT,last_health_status TEXT,root_path TEXT,created_at TEXT);
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
CREATE INDEX IF NOT EXISTS idx_auth_decisions_lookup ON auth_decisions(principal_id,workspace_id,permission,allowed,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_principals_identity_unique ON auth_principals(type,actor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_grants_scope_version_unique ON auth_workspace_grants(principal_id,workspace_id,version);`);
  ensureColumn('sessions', 'principal_id', 'TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_principal ON sessions(principal_id);`);
  // --- Hermes Intelligence Layer (Milestone 1) ---
  // Additive, mock-only orchestration + learning foundation. These tables record structured
  // workflow runs/steps, routing/policy/verification decisions, and *unpromoted* memory
  // candidates. They are deliberately separate from the raw audit stream (audit_events/
  // task_events) and from any future promoted long-term memory table. No secrets are ever stored
  // here: every persisted payload is redacted before insert by packages/hermes-orchestrator.
  db.exec(`CREATE TABLE IF NOT EXISTS hermes_workflow_runs(id TEXT PRIMARY KEY,task_id TEXT,conversation_id TEXT,workspace_id TEXT,actor_id TEXT,channel TEXT,objective TEXT,classification TEXT,status TEXT,outcome TEXT,provider TEXT,agent TEXT,cost_cents INTEGER,started_at TEXT,finished_at TEXT,created_at TEXT,requested_provider TEXT);
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
CREATE INDEX IF NOT EXISTS idx_hermes_outcome_events_evaluation ON hermes_outcome_source_events(evaluation_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_outcome_evaluations_run_version_unique ON hermes_outcome_evaluations(run_id,evaluation_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_outcome_components_name_unique ON hermes_outcome_evaluation_components(evaluation_id,name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_outcome_corrections_version_unique ON hermes_outcome_corrections(evaluation_id,version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_outcome_corrections_parent_unique ON hermes_outcome_corrections(supersedes_correction_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_outcome_source_events_idempotency_unique ON hermes_outcome_source_events(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_outcome_failures_run_unique ON hermes_outcome_evaluation_failures(run_id);
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_evaluations_immutable_update BEFORE UPDATE ON hermes_outcome_evaluations BEGIN SELECT RAISE(ABORT,'immutable outcome evaluation'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_evaluations_immutable_delete BEFORE DELETE ON hermes_outcome_evaluations BEGIN SELECT RAISE(ABORT,'immutable outcome evaluation'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_components_immutable_update BEFORE UPDATE ON hermes_outcome_evaluation_components BEGIN SELECT RAISE(ABORT,'immutable outcome component'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_components_immutable_delete BEFORE DELETE ON hermes_outcome_evaluation_components BEGIN SELECT RAISE(ABORT,'immutable outcome component'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_corrections_immutable_update BEFORE UPDATE ON hermes_outcome_corrections BEGIN SELECT RAISE(ABORT,'immutable outcome correction'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_corrections_immutable_delete BEFORE DELETE ON hermes_outcome_corrections BEGIN SELECT RAISE(ABORT,'immutable outcome correction'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_source_events_immutable_update BEFORE UPDATE ON hermes_outcome_source_events BEGIN SELECT RAISE(ABORT,'immutable outcome source event'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_source_events_immutable_delete BEFORE DELETE ON hermes_outcome_source_events BEGIN SELECT RAISE(ABORT,'immutable outcome source event'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_failures_immutable_update BEFORE UPDATE ON hermes_outcome_evaluation_failures BEGIN SELECT RAISE(ABORT,'immutable outcome failure'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_outcome_failures_immutable_delete BEFORE DELETE ON hermes_outcome_evaluation_failures BEGIN SELECT RAISE(ABORT,'immutable outcome failure'); END;`);
  // --- Hermes Verified Scorecards (Milestone 3B) ---
  // Additive, append-only read model derived only from intact Milestone 3A evaluations. A scorecard
  // is learning-quality evidence, never an execution control: nothing here participates in routing,
  // provider selection, approvals, task execution, or memory promotion. Recalculation appends a
  // successor linked to its predecessor; the immutability triggers guarantee no snapshot or lineage
  // row is ever updated or deleted. Every metric is an exact integer count or an integer
  // numerator/denominator pair - no floating point - and "unknown" is a first-class count that is
  // never folded into zero and never read as success.
  db.exec(`CREATE TABLE IF NOT EXISTS hermes_verified_scorecards(id TEXT PRIMARY KEY,scorecard_version TEXT NOT NULL,derivation_version TEXT NOT NULL,workspace_id TEXT NOT NULL,dimension_provider_id TEXT NOT NULL,dimension_agent_id TEXT NOT NULL,dimension_capability TEXT NOT NULL,dimension_classification TEXT NOT NULL,cutoff_created_at TEXT NOT NULL,cutoff_evaluation_id TEXT NOT NULL,scope_version INTEGER NOT NULL CHECK(scope_version>0),supersedes_scorecard_id TEXT,source_evaluation_count INTEGER NOT NULL CHECK(source_evaluation_count>=0),confidence_band TEXT NOT NULL CHECK(confidence_band IN ('insufficient','limited','established')),positive_eligible_count INTEGER NOT NULL CHECK(positive_eligible_count>=0),negative_terminal_count INTEGER NOT NULL CHECK(negative_terminal_count>=0),blocked_ineligible_count INTEGER NOT NULL CHECK(blocked_ineligible_count>=0),accepted_count INTEGER NOT NULL CHECK(accepted_count>=0),rejected_count INTEGER NOT NULL CHECK(rejected_count>=0),partially_accepted_count INTEGER NOT NULL CHECK(partially_accepted_count>=0),rollback_count INTEGER NOT NULL CHECK(rollback_count>=0),follow_up_verification_count INTEGER NOT NULL CHECK(follow_up_verification_count>=0),stability_confirmed_count INTEGER NOT NULL CHECK(stability_confirmed_count>=0),regression_linked_count INTEGER NOT NULL CHECK(regression_linked_count>=0),unknown_acceptance_count INTEGER NOT NULL CHECK(unknown_acceptance_count>=0),unknown_rollback_count INTEGER NOT NULL CHECK(unknown_rollback_count>=0),unknown_stability_count INTEGER NOT NULL CHECK(unknown_stability_count>=0),retry_total INTEGER NOT NULL CHECK(retry_total>=0),known_retry_evaluations INTEGER NOT NULL CHECK(known_retry_evaluations>=0),timeout_count INTEGER NOT NULL CHECK(timeout_count>=0),unknown_timeout_count INTEGER NOT NULL CHECK(unknown_timeout_count>=0),cancellation_count INTEGER NOT NULL CHECK(cancellation_count>=0),known_input_tokens INTEGER NOT NULL CHECK(known_input_tokens>=0),known_input_token_evaluations INTEGER NOT NULL CHECK(known_input_token_evaluations>=0),known_output_tokens INTEGER NOT NULL CHECK(known_output_tokens>=0),known_output_token_evaluations INTEGER NOT NULL CHECK(known_output_token_evaluations>=0),known_cost_cents INTEGER NOT NULL CHECK(known_cost_cents>=0),known_cost_evaluations INTEGER NOT NULL CHECK(known_cost_evaluations>=0),verified_success_numerator INTEGER NOT NULL CHECK(verified_success_numerator>=0),verified_success_denominator INTEGER NOT NULL CHECK(verified_success_denominator>=0),acceptance_numerator INTEGER NOT NULL CHECK(acceptance_numerator>=0),acceptance_denominator INTEGER NOT NULL CHECK(acceptance_denominator>=0),lineage_digest TEXT NOT NULL,content_digest TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(workspace_id,scorecard_version,dimension_provider_id,dimension_agent_id,dimension_capability,dimension_classification,cutoff_created_at,cutoff_evaluation_id),UNIQUE(workspace_id,scorecard_version,dimension_provider_id,dimension_agent_id,dimension_capability,dimension_classification,scope_version),UNIQUE(supersedes_scorecard_id));
CREATE TABLE IF NOT EXISTS hermes_verified_scorecard_sources(id TEXT PRIMARY KEY,scorecard_id TEXT NOT NULL,seq INTEGER NOT NULL CHECK(seq>0),evaluation_id TEXT NOT NULL,workspace_id TEXT NOT NULL,evaluation_created_at TEXT NOT NULL,provenance_digest TEXT NOT NULL,correction_head_id TEXT,correction_head_version INTEGER,source_event_ids TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(scorecard_id,seq),UNIQUE(scorecard_id,evaluation_id));
CREATE INDEX IF NOT EXISTS idx_hermes_scorecards_workspace_created ON hermes_verified_scorecards(workspace_id,created_at);
CREATE INDEX IF NOT EXISTS idx_hermes_scorecard_sources_evaluation ON hermes_verified_scorecard_sources(evaluation_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_scorecards_identity_unique ON hermes_verified_scorecards(workspace_id,scorecard_version,dimension_provider_id,dimension_agent_id,dimension_capability,dimension_classification,cutoff_created_at,cutoff_evaluation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_scorecards_scope_version_unique ON hermes_verified_scorecards(workspace_id,scorecard_version,dimension_provider_id,dimension_agent_id,dimension_capability,dimension_classification,scope_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_scorecards_parent_unique ON hermes_verified_scorecards(supersedes_scorecard_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_scorecard_sources_seq_unique ON hermes_verified_scorecard_sources(scorecard_id,seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_scorecard_sources_evaluation_unique ON hermes_verified_scorecard_sources(scorecard_id,evaluation_id);
CREATE TRIGGER IF NOT EXISTS trg_hermes_scorecards_immutable_update BEFORE UPDATE ON hermes_verified_scorecards BEGIN SELECT RAISE(ABORT,'immutable verified scorecard'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_scorecards_immutable_delete BEFORE DELETE ON hermes_verified_scorecards BEGIN SELECT RAISE(ABORT,'immutable verified scorecard'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_scorecard_sources_immutable_update BEFORE UPDATE ON hermes_verified_scorecard_sources BEGIN SELECT RAISE(ABORT,'immutable verified scorecard source'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_scorecard_sources_immutable_delete BEFORE DELETE ON hermes_verified_scorecard_sources BEGIN SELECT RAISE(ABORT,'immutable verified scorecard source'); END;`);
  // Hermes Milestone 3C: approval-gated memory-candidate review. Additive and idempotent.
  //
  // A review is a row in this NEW append-only table, never a mutation of `hermes_memory_candidates`.
  // That Milestone 1 table has no immutability triggers, and its `status`/`promoted_at` columns ARE
  // the promotion mechanism; introducing the first UPDATE path against it would make "review-only" a
  // code convention rather than a structural fact. Both columns stay 'pending' and NULL all milestone.
  //
  // `decision` is deliberately advisory and there is no `promote` value: `recommend_promote` records
  // a human judgement, and nothing in `m3c-v1` reads it. The CHECK constraint refuses a promotion-
  // shaped value at the database layer, not merely in application code.
  //
  // `candidate_digest` pins the candidate row as it read at decision time. Because the candidate
  // table has no immutability triggers, that pin is the only thing that makes a review verifiable at
  // all: it turns "reviewed candidate X" into "reviewed candidate X as it then was". One terminal
  // review per candidate in `m3c-v1`; re-review and successor chains are deferred.
  db.exec(`CREATE TABLE IF NOT EXISTS hermes_memory_candidate_reviews(id TEXT PRIMARY KEY,review_version TEXT NOT NULL,decision_version TEXT NOT NULL,candidate_id TEXT NOT NULL,workspace_id TEXT NOT NULL,run_id TEXT NOT NULL,task_id TEXT,decision TEXT NOT NULL CHECK(decision IN ('recommend_promote','reject','defer_needs_evidence')),rationale TEXT NOT NULL,candidate_kind TEXT NOT NULL,candidate_scope TEXT NOT NULL CHECK(candidate_scope='workspace'),candidate_status_at_review TEXT NOT NULL CHECK(candidate_status_at_review='pending'),candidate_digest TEXT NOT NULL,evaluation_id TEXT NOT NULL,evaluation_version TEXT NOT NULL,provenance_digest TEXT NOT NULL,reviewer_principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,content_digest TEXT NOT NULL,lineage_digest TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(candidate_id),UNIQUE(workspace_id,idempotency_key));
CREATE INDEX IF NOT EXISTS idx_hermes_memory_reviews_workspace_created ON hermes_memory_candidate_reviews(workspace_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_memory_reviews_candidate_unique ON hermes_memory_candidate_reviews(candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_memory_reviews_idempotency_unique ON hermes_memory_candidate_reviews(workspace_id,idempotency_key);
CREATE TRIGGER IF NOT EXISTS trg_hermes_memory_reviews_immutable_update BEFORE UPDATE ON hermes_memory_candidate_reviews BEGIN SELECT RAISE(ABORT,'immutable memory candidate review'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_memory_reviews_immutable_delete BEFORE DELETE ON hermes_memory_candidate_reviews BEGIN SELECT RAISE(ABORT,'immutable memory candidate review'); END;`);
  // Hermes Milestone 3C, second slice: re-review as an explicit successor. Additive and idempotent.
  //
  // A re-review is a NEW append-only row here that LINKS to the record it supersedes and never
  // touches it. The chain root is the one `hermes_memory_candidate_reviews` row for the candidate;
  // successors are `chain_version` 1..n in this table. This is the Milestone 3A correction-chain
  // shape (`hermes_outcome_corrections`), not the 3B in-table `supersedes_*` shape, for a structural
  // reason: the merged review table above declares an INLINE table-level `UNIQUE(candidate_id)`,
  // which SQLite cannot drop without rebuilding the table - and rebuilding an append-only table
  // means copying and re-writing historical immutable rows, which is exactly what a successor chain
  // exists to avoid. Keeping the root byte-untouched is the whole point.
  //
  // Chain shape is enforced by the database, not by convention:
  //   UNIQUE(root_review_id,chain_version)  - no forks at ANY depth, including the first successor,
  //                                           because chain_version 1 can exist only once per root.
  //   UNIQUE(supersedes_rereview_id)        - no forks off a successor. SQLite permits many NULLs,
  //                                           which is why the pair above carries the depth-1 case.
  //   the chain_version/supersedes CHECK    - depth 1 supersedes the root and names no successor;
  //                                           every deeper row must name one. No ambiguous ancestry.
  //   id<>root_review_id, id<>supersedes    - no self-links.
  // Cycles are unreachable given strictly increasing `chain_version` over an append-only table.
  //
  // Still review-only. Same advisory vocabulary with no `promote` value, refused by CHECK; no writer
  // for `hermes_memory_candidates` anywhere; `status`/`promoted_at` remain untouched. A successor
  // INHERITS NO AUTHORITY: `decision` and `rationale` are supplied fresh by the caller and are never
  // copied from the predecessor, and `inherited_context` carries only an allowlisted, provenance-
  // tracked copy of the subject's identity. `predecessor_content_digest`/`predecessor_lineage_digest`
  // pin the superseded record as it read at decision time, so a stale or altered predecessor refuses.
  db.exec(`CREATE TABLE IF NOT EXISTS hermes_memory_candidate_rereviews(id TEXT PRIMARY KEY,rereview_version TEXT NOT NULL,decision_version TEXT NOT NULL,root_review_id TEXT NOT NULL,supersedes_rereview_id TEXT,chain_version INTEGER NOT NULL CHECK(chain_version>0),candidate_id TEXT NOT NULL,workspace_id TEXT NOT NULL,run_id TEXT NOT NULL,task_id TEXT,decision TEXT NOT NULL CHECK(decision IN ('recommend_promote','reject','defer_needs_evidence')),rationale TEXT NOT NULL,candidate_kind TEXT NOT NULL,candidate_scope TEXT NOT NULL CHECK(candidate_scope='workspace'),candidate_status_at_review TEXT NOT NULL CHECK(candidate_status_at_review='pending'),candidate_digest TEXT NOT NULL,evaluation_id TEXT NOT NULL,evaluation_version TEXT NOT NULL,provenance_digest TEXT NOT NULL,predecessor_content_digest TEXT NOT NULL,predecessor_lineage_digest TEXT NOT NULL,inherited_context TEXT NOT NULL,reviewer_principal_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,content_digest TEXT NOT NULL,lineage_digest TEXT NOT NULL,created_at TEXT NOT NULL,CHECK(id<>root_review_id),CHECK(supersedes_rereview_id IS NULL OR supersedes_rereview_id<>id),CHECK((chain_version=1 AND supersedes_rereview_id IS NULL) OR (chain_version>1 AND supersedes_rereview_id IS NOT NULL)),UNIQUE(root_review_id,chain_version),UNIQUE(supersedes_rereview_id),UNIQUE(workspace_id,idempotency_key));
CREATE INDEX IF NOT EXISTS idx_hermes_memory_rereviews_workspace_created ON hermes_memory_candidate_rereviews(workspace_id,created_at);
CREATE INDEX IF NOT EXISTS idx_hermes_memory_rereviews_candidate ON hermes_memory_candidate_rereviews(candidate_id,chain_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_memory_rereviews_chain_unique ON hermes_memory_candidate_rereviews(root_review_id,chain_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_memory_rereviews_parent_unique ON hermes_memory_candidate_rereviews(supersedes_rereview_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_memory_rereviews_idempotency_unique ON hermes_memory_candidate_rereviews(workspace_id,idempotency_key);
CREATE TRIGGER IF NOT EXISTS trg_hermes_memory_rereviews_immutable_update BEFORE UPDATE ON hermes_memory_candidate_rereviews BEGIN SELECT RAISE(ABORT,'immutable memory candidate rereview'); END;
CREATE TRIGGER IF NOT EXISTS trg_hermes_memory_rereviews_immutable_delete BEFORE DELETE ON hermes_memory_candidate_rereviews BEGIN SELECT RAISE(ABORT,'immutable memory candidate rereview'); END;`);
  for (const [name, definition] of [['worker_id', 'TEXT'], ['claimed_at', 'TEXT'], ['heartbeat_at', 'TEXT'], ['current_stage', 'TEXT'], ['evidence', 'TEXT'], ['conversation_id', 'TEXT'], ['input_id', 'TEXT'], ['source_channel', 'TEXT'], ['actor_id', 'TEXT'], ['action_class', 'TEXT'], ['authority_class', 'TEXT'], ['policy_decision', 'TEXT']]) ensureColumn('tasks', name, definition);
  for (const [name, definition] of [['risk_level','TEXT'], ['requested_by','TEXT'], ['decided_by','TEXT'], ['decision_note','TEXT'], ['expires_at','TEXT']]) ensureColumn('approvals', name, definition);
  ensureColumn('hermes_workflow_runs', 'requested_provider', 'TEXT');
  const missing = findMissingSchemaObjects(db);
  if (missing.length) throw new Error(`migration produced incompatible schema: ${missing.join('; ')}`);
  db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (process.env.BLACKSPIRE_RUN_MIGRATIONS !== 'true') throw new Error('dedicated writer authorization missing');
    runMigration();
    seedWorkspace();
    console.log('Migrated Blackspire Command SQLite database.');
  } catch (error) {
    console.error(`migration failed: ${String(error?.message || error).replace(/(?:token|secret|password|key)\s*[=:]\s*\S+/gi, '[redacted]')}`);
    process.exitCode = 1;
  }
}
