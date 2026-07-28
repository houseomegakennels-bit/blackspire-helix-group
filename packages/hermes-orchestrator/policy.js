// Hermes policy engine (Milestone 1 — policy-decision model).
//
// Produces a structured PolicyDecision for a normalized+classified task. It MUST NOT be more
// permissive than canonical intake, so it:
//   1. honors any denial already recorded by canonical intake (`priorPolicyDecision === 'denied'`),
//      never re-allowing a task the intake policy already denied; and
//   2. delegates classification/allow-deny to the reviewed canonical engine in packages/policy
//      (`evaluateRequestPolicy`), which recognises protected actions (repository visibility/delete,
//      deploy, merge, credential exposure, host-security, funds, etc.) that a keyword-only classifier
//      would miss.
// The Hermes risk classifier is retained only as an *additional* gate: it can escalate to
// approval-required, never downgrade a canonical denial. Milestone 1 blocks (does not queue)
// approval-required tasks.
import { evaluateRequestPolicy } from '../policy/policy.js';

/**
 * @typedef {Object} PolicyDecision
 * @property {string} actionClass
 * @property {boolean} allowed
 * @property {boolean} requiresApproval
 * @property {'allow'|'requires_approval'|'deny'} decision
 * @property {string} reason
 */

/** @returns {PolicyDecision} */
export function evaluatePolicy(normalized, classification) {
  // 1. Never re-open a task canonical intake already denied.
  if (normalized.priorPolicyDecision === 'denied') {
    return { actionClass: 'intake_denied', allowed: false, requiresApproval: false, decision: 'deny', reason: 'Task was denied by canonical intake policy; Hermes will not re-evaluate it.' };
  }

  // 2. Defer to the reviewed canonical policy engine (cannot be laxer than intake).
  const canonical = evaluateRequestPolicy({ request: normalized.objective, channel: normalized.channel, authority: normalized.authority });
  const actionClass = canonical.actionClass || `${classification.domain}.${classification.risk}`;

  if (!canonical.allowed) {
    return {
      actionClass,
      allowed: false,
      requiresApproval: Boolean(canonical.requiresApproval),
      decision: canonical.requiresApproval ? 'requires_approval' : 'deny',
      reason: canonical.reason || 'Denied by Blackspire policy.',
    };
  }

  // 3. Canonical allowed. Block pending approval if canonical demands it OR the Hermes classifier
  //    independently flags high risk (defense in depth — escalate only, never downgrade).
  if (canonical.requiresApproval || classification.risk === 'high') {
    return {
      actionClass,
      allowed: false,
      requiresApproval: true,
      decision: 'requires_approval',
      reason: canonical.reason || 'High-impact task requires administrator approval before Hermes may execute it.',
    };
  }

  return { actionClass, allowed: true, requiresApproval: false, decision: 'allow', reason: canonical.reason || 'Low-risk approved action.' };
}
