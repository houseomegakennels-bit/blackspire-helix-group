// Hermes deterministic verifier (Milestone 1).
//
// Verifies a mock workflow's ExecutionResult against explicit, deterministic checks BEFORE the
// orchestrator is allowed to mark the run successful (charter requirement #8: verify results before
// marking tasks complete). It performs no network or shell work — it inspects the structured result
// only. A failing verification blocks completion and blocks memory-candidate extraction, so a
// non-verified (or falsely "successful") output can never become a learned lesson.

/**
 * @typedef {Object} VerificationCheck
 * @property {string} name
 * @property {boolean} passed
 * @property {string} detail
 */

/**
 * @typedef {Object} VerificationResult
 * @property {string} verifier
 * @property {boolean} passed
 * @property {VerificationCheck[]} checks
 * @property {string} detail
 */

/** @returns {VerificationResult} */
export function verifyExecution(execution, { classification } = {}) {
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });

  check('execution_ok', execution && execution.ok === true, execution?.error ? `execution error: ${execution.error}` : 'execution reported ok');
  check('provider_present', typeof execution?.provider === 'string' && execution.provider.length > 0, `provider=${execution?.provider}`);
  check('artifacts_is_array', Array.isArray(execution?.artifacts), `artifacts type=${typeof execution?.artifacts}`);
  check('has_summary', typeof execution?.summary === 'string' && execution.summary.length > 0, 'summary present');
  // The mock provider is always free; a real provider may report a (bounded, budget-checked) cost or
  // null. Only enforce zero-cost for the mock.
  if (execution?.mode === 'mock') check('mock_is_free', (execution?.usage?.costCents || 0) === 0, `costCents=${execution?.usage?.costCents || 0}`);
  // Artifact paths must be relative (no absolute paths / traversal) even for a mock proposal.
  const badPath = (execution?.artifacts || []).find((a) => typeof a?.path !== 'string' || a.path.startsWith('/') || a.path.includes('..'));
  check('artifact_paths_safe', !badPath, badPath ? `unsafe artifact path: ${badPath.path}` : 'all artifact paths relative and traversal-free');
  // If the classifier required doc/code editing, a proposal artifact should exist.
  const requiresArtifact = (classification?.requiredCapabilities || []).some((c) => c === 'doc.edit' || c === 'code.edit');
  if (requiresArtifact) check('artifact_present_for_edit', (execution?.artifacts || []).length > 0, 'edit task produced at least one artifact');

  const passed = checks.every((c) => c.passed);
  return {
    verifier: 'deterministic-mock-verifier-v1',
    passed,
    checks,
    detail: passed ? 'all deterministic checks passed' : `failed checks: ${checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`,
  };
}
