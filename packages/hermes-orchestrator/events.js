// Hermes structured event types + recorder (Milestone 1).
//
// Defines the canonical ordered event vocabulary for a Hermes workflow and records each event into
// BOTH the reused ordered task_events stream (so Jarvis/PWA/Telegram see it through the existing
// event system — charter #14) AND, for step-level detail, the hermes_workflow_steps table. Raw
// audit stays separate from any promoted long-term memory: these events are audit history, never
// memory. All payloads are redacted by the store layer before persistence.
import { recordTaskEvent } from '../task-engine/tasks.js';
import { insertWorkflowStep } from './store.js';
import { redactDeep } from './redaction.js';

export const HERMES_EVENTS = Object.freeze({
  RECEIVED: 'hermes.received',
  NORMALIZED: 'hermes.normalized',
  CLASSIFIED: 'hermes.classified',
  POLICY_EVALUATED: 'hermes.policy_evaluated',
  ROUTED: 'hermes.routed',
  EXECUTED: 'hermes.executed',
  VERIFIED: 'hermes.verified',
  MEMORY_CANDIDATE: 'hermes.memory_candidate_recorded',
  COMPLETED: 'hermes.completed',
  FAILED: 'hermes.failed',
});

/**
 * Records a Hermes workflow event. Writes an ordered task_event (reusing the canonical stream) and,
 * when a run/step is provided, a redacted workflow step row.
 * @returns {{seq:number}}
 */
export function makeEventRecorder({ taskId, runId }) {
  let seq = 0;
  return {
    /** @param {string} type one of HERMES_EVENTS @param {any} detail redactable payload */
    record(type, detail = null, status = 'completed') {
      seq += 1;
      // Ordered, canonical event stream (best-effort: a missing task row must not crash the run).
      try { recordTaskEvent(taskId, type, redactSafe(detail)); } catch { /* non-canonical/synthetic task: skip */ }
      if (runId) insertWorkflowStep(runId, seq, { name: type, status, detail });
      return { seq };
    },
    current: () => seq,
  };
}

// task_events payloads are JSON-serialized by task-engine; keep them small and non-secret. The
// hermes step store applies deep redaction, but the task_event path gets a light guard here too.
function redactSafe(detail) {
  if (detail == null) return {};
  if (typeof detail === 'object') return redactDeep(detail);
  return { value: redactDeep(String(detail)) };
}
