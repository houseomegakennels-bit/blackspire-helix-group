const CLASSIFICATIONS = new Set(['proceed','observe','rollback recommended','operator intervention required']);
export function postDeployReportObservation(report, { workspaceId, correlationId, timestamp }) {
  if (!report || report.kind !== 'blackspire-post-deploy-verification' || report.schemaVersion !== 1 || report.readOnly !== true || report.automaticActionTaken !== false) throw new Error('invalid post-deploy verification contract');
  if (!CLASSIFICATIONS.has(report.classification)) throw new Error('invalid post-deploy classification');
  if (!['staging','disposable-staging'].includes(report.environment) || report.expected?.environment !== report.environment) throw new Error('post-deploy environment mismatch');
  if (!report.observed?.deploymentIdentity || !['VERIFIED','UNVERIFIED','MISMATCH','UNKNOWN'].includes(report.observed.deploymentIdentity.state)) throw new Error('post-deploy deployment identity missing');
  const common = { environment: report.environment, workspaceId, timestamp, correlationId, commit: report.expected?.commit, buildFingerprint: report.expected?.buildFingerprint, dependency: null, source: 'post_deploy_verifier', metadata: { mode: report.classification } };
  if (report.classification === 'proceed') return { ...common, component: 'build', state: 'healthy', reasonCode: 'check_passed', reason: 'Post-deploy verification passed' };
  if (report.classification === 'observe') return { ...common, component: 'startup', state: 'recovering', reasonCode: 'startup_pending', reason: 'Post-deploy verification requires bounded observation' };
  if (report.classification === 'rollback recommended') return { ...common, component: 'api_readiness', state: 'unavailable', reasonCode: 'check_failed', reason: 'Post-deploy verification recommends rollback review' };
  return { ...common, component: 'build', state: 'dependency_failure', reasonCode: 'check_failed', reason: 'Post-deploy verification requires operator intervention' };
}
