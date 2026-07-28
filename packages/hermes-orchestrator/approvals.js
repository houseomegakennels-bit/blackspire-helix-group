// Hermes scoped approvals (Milestone 2).
//
// Task/workflow-scoped, single-use, expiring approvals for medium-risk development tasks. There is
// NO reusable blanket approval: a grant is bound to one task_id + action_class, is consumed on use,
// and fails closed once expired. This does not implement live *production* approval execution.
import { insertApproval, latestApprovalForTask, consumeApproval } from './store.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Grant a scoped, single-use approval for one task + action class.
 * @returns {{id:string, expiresAt:string}}
 */
export function grantApproval({ taskId, runId = null, actionClass, grantedBy = 'operator', reason = '', ttlMs = DEFAULT_TTL_MS }) {
  if (!taskId || !actionClass) throw new Error('grantApproval requires taskId and actionClass');
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const id = insertApproval({ taskId, runId, scope: 'task', actionClass, status: 'granted', grantedBy, reason, singleUse: true, expiresAt });
  return { id, expiresAt };
}

/**
 * Check whether a valid, unexpired, unconsumed approval exists for this task + action class.
 * @returns {{ok:boolean, reason?:string, approvalId?:string}}
 */
export function checkApproval(taskId, actionClass, at = Date.now()) {
  const row = latestApprovalForTask(taskId, actionClass);
  if (!row) return { ok: false, reason: 'no approval on record for this task and action' };
  if (row.status === 'consumed') return { ok: false, reason: 'approval already used (single-use)' };
  if (row.status !== 'granted') return { ok: false, reason: `approval is ${row.status}` };
  if (row.expires_at && Date.parse(row.expires_at) <= at) return { ok: false, reason: 'approval expired' };
  return { ok: true, approvalId: row.id };
}

/** Consume a granted approval (single-use). Safe to call only after checkApproval succeeds. */
export function consume(approvalId) { consumeApproval(approvalId); }
