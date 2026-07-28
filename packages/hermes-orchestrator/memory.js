// Hermes memory extractor (Milestone 1 — candidate creation only, NEVER promotion).
//
// Extracts a structured, reusable lesson from a COMPLETED and VERIFIED workflow and records it as a
// memory *candidate* with status 'pending'. Charter #9/#13 and the controlled-learning model: raw
// audit history stays separate from promoted long-term memory, and nothing is promoted without an
// explicit policy or human approval — which does not exist in Milestone 1. This module therefore
// has no promotion path; it only proposes.
//
// It refuses to extract from an unverified or failed workflow, which is the guard against memory
// poisoning and learning from false success.
import { insertMemoryCandidate } from './store.js';
import { redactString } from './redaction.js';

/**
 * @typedef {Object} MemoryCandidate
 * @property {string} id
 * @property {'workflow_lesson'} kind
 * @property {'workspace'|'global'} scope
 * @property {string} lesson         redacted, human-readable reusable lesson
 * @property {string} status         always 'pending' in M1
 */

/**
 * @returns {{created:boolean, id?:string, reason?:string}}
 */
export function extractMemoryCandidate({ runId, normalized, classification, verification }) {
  if (!verification || verification.passed !== true) {
    return { created: false, reason: 'verification did not pass; no lesson extracted (prevents learning from unverified outcomes)' };
  }
  const lesson = redactString(
    `For a ${classification.complexity} ${classification.domain} task at ${classification.risk} risk on workspace ${normalized.workspaceId}, `
    + `the mock ${classification.requiredCapabilities.join('/')} route completed and passed deterministic verification.`,
  );
  const id = insertMemoryCandidate(runId, normalized.taskId, {
    workspaceId: normalized.workspaceId,
    kind: 'workflow_lesson',
    scope: 'workspace',
    lesson,
    evidenceRef: `hermes_workflow_runs:${runId}`,
  });
  return { created: true, id, status: 'pending' };
}
