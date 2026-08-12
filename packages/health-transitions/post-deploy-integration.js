const CLASSIFICATIONS = new Set(['proceed','observe','rollback recommended','operator intervention required']);
export function postDeployReportObservation(report, { workspaceId, correlationId, timestamp }) {
  if (!report || report.kind !== 'blackspire-post-deploy-verification' || report.schemaVersion !== 1 || report.readOnly !== true || report.automaticActionTaken !== false) throw new Error('invalid post-deploy verification contract');
  if (!CLASSIFICATIONS.has(report.classification)) throw new Error('invalid post-deploy classification');
  if (!['staging','disposable-staging'].includes(report.environment) || report.expected?.environment !== report.environment) throw new Error('post-deploy environment mismatch');
  // EVERY classification is recorded on the dedicated 'post_deploy' component, never on a runtime
  // component. The store keys latest state by (environment, workspaceId, component) ONLY -- 'source'
  // is not part of the key -- so writing this advisory channel to 'build', 'startup', or
  // 'api_readiness' let a read-only verifier report OVERWRITE the live runtime observation for that
  // component. A measured example: runtime reports build dependency_failure (fingerprint mismatch,
  // rollbackRecommendation operator_intervention_required), then an advisory 'proceed' one second
  // later reset the same key to healthy and the operator diagnostics published 'rollback none /
  // HEALTHY'. An advisory channel that can erase a runtime alarm is worse than no channel, and it
  // also mis-attributed diagnostics' `deployment` field, which reads the 'build' component, to the
  // APPROVED commit rather than the running one. A separate component identity closes both: the
  // advisory state is additive and the runtime channels stay authoritative.
  const common = { environment: report.environment, workspaceId, timestamp, correlationId, commit: report.expected?.commit, buildFingerprint: report.expected?.buildFingerprint, dependency: null, source: 'post_deploy_verifier', component: 'post_deploy', metadata: { mode: report.classification } };
  if (report.classification === 'proceed') return { ...common, state: 'healthy', reasonCode: 'check_passed', reason: 'Post-deploy verification passed' };
  if (report.classification === 'observe') return { ...common, state: 'recovering', reasonCode: 'startup_pending', reason: 'Post-deploy verification requires bounded observation' };
  if (report.classification === 'rollback recommended') return { ...common, state: 'unavailable', reasonCode: 'check_failed', reason: 'Post-deploy verification recommends rollback review' };
  return { ...common, state: 'dependency_failure', reasonCode: 'check_failed', reason: 'Post-deploy verification requires operator intervention' };
}
