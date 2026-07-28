// Hermes policy engine (Milestone 1 — deterministic policy-decision model).
//
// Produces a structured PolicyDecision for a normalized+classified task. In M1 the rule set is
// deliberately conservative and deterministic:
//   - high-risk tasks are NOT executed; they are blocked pending approval (requiresApproval=true);
//   - everything else is allowed for the credential-free mock route.
// This intentionally reuses the *shape* the approval engine (packages/policy + approvals table)
// will consume in a later milestone, without wiring live approval persistence yet. It never grants
// itself execution of a real provider — routing is mock-only regardless of this decision.

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
  const actionClass = `${classification.domain}.${classification.risk}`;
  if (classification.risk === 'high') {
    return {
      actionClass,
      allowed: false,
      requiresApproval: true,
      decision: 'requires_approval',
      reason: 'High-risk task requires explicit administrator approval before Hermes may execute it (Milestone 1 blocks rather than executes).',
    };
  }
  return {
    actionClass,
    allowed: true,
    requiresApproval: false,
    decision: 'allow',
    reason: `Low/medium-risk ${classification.domain} task permitted on the credential-free mock route.`,
  };
}
