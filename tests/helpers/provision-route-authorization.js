import { run } from '../../packages/task-engine/db.js';

const permissions = ['approval.grant', 'runtime.read', 'task.create', 'task.execute', 'task.read', 'workspace.read'];

export function provisionRouteAuthorization(workspaceIds, { principalId = 'test-route-operator' } = {}) {
  process.env.BLACKSPIRE_OPERATOR_PRINCIPAL_ID = principalId;
  const now = Date.now();
  run('INSERT OR IGNORE INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [principalId, 'admin', principalId, 'bearer', null, 'active', now, null, null, null, 1, now]);
  for (const workspaceId of [...new Set(workspaceIds)]) {
    run('INSERT OR IGNORE INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [`${principalId}-${workspaceId}`, principalId, workspaceId, 'service', JSON.stringify(permissions), 'active', 1, null, now, null, null, 'test', 1, now]);
  }
}
