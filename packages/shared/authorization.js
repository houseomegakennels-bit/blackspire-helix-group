// Server-side authorization foundation. Not wired to HTTP routes in this slice.
import { all, get, run } from '../task-engine/db.js';
import { id } from './util.js';
import { AUTHZ_PERMISSIONS, canonicalPermissions, validateGrant } from './authz-schema.js';

const ROLE_PERMISSIONS = Object.freeze({
  admin: AUTHZ_PERMISSIONS,
  operator: ['workspace.read','task.read','task.create','task.execute','runtime.read','provider.use.development'],
  viewer: ['workspace.read','task.read','runtime.read'], service: [],
});
export const AUTHZ_POLICY_VERSION = 'authz-v1';
const resolvedPrincipals = new WeakSet();

export function resolvePrincipal({ principalId = null, authenticationMethod, credentialReference = null } = {}) {
  const p = principalId && get('SELECT * FROM auth_principals WHERE id=?', [principalId]);
  if (!p || !['admin','service'].includes(p.type) || p.status !== 'active' || (p.expires_at && Number(p.expires_at) <= Date.now()) || p.revoked_at || p.disabled_at) return null;
  if (authenticationMethod && p.authentication_method !== authenticationMethod) return null;
  if (credentialReference && p.credential_reference !== credentialReference) return null;
  const principal = Object.freeze({ principalId: p.id, principalType: p.type, actorId: p.actor_id, authenticationMethod: p.authentication_method, securityVersion: p.security_version });
  resolvedPrincipals.add(principal);
  return principal;
}
export const resolveAdminBearer = (principalId) => resolvePrincipal({ principalId, authenticationMethod: 'bearer' });
export const resolveServiceContext = (principalId, credentialReference) => resolvePrincipal({ principalId, authenticationMethod: 'service', credentialReference });
export const resolveBoundSession = (session) => session?.principal_id ? resolvePrincipal({ principalId: session.principal_id, authenticationMethod: 'session' }) : null;
export const requireAuthenticatedPrincipal = (p) => p ? allow('authenticated') : deny('unauthenticated');

export function activeGrant(principalId, workspaceId) {
  const rows = all(`SELECT * FROM auth_workspace_grants WHERE principal_id=? AND workspace_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?) AND revoked_at IS NULL ORDER BY version DESC`, [principalId, workspaceId, Date.now()]);
  if (rows.length !== 1) return null;
  const g = rows[0];
  try { validateGrant({ ...g, supersedesGrantId: g.supersedes_grant_id }); } catch { return null; }
  if (!validateGrantChain(g)) return null;
  return g;
}
// Versions are strictly increasing, but need not be contiguous: a revoked version may be retained
// without an active successor. Cycles/cross-scope links are refused before a grant is usable.
export function validateGrantChain(head) {
  const seen = new Set(); let current = head; let priorVersion = Infinity;
  while (current) {
    if (seen.has(current.id) || !Number.isInteger(Number(current.version)) || Number(current.version) < 1 || Number(current.version) >= priorVersion) return false;
    seen.add(current.id); priorVersion = Number(current.version);
    if (!current.supersedes_grant_id) return true;
    current = get('SELECT * FROM auth_workspace_grants WHERE id=?', [current.supersedes_grant_id]);
    if (!current || current.principal_id !== head.principal_id || current.workspace_id !== head.workspace_id) return false;
  }
  return false;
}
export function requireWorkspacePermission(principal, workspaceId, permission, resource = {}) {
  if (!principal || !resolvedPrincipals.has(principal) || !AUTHZ_PERMISSIONS.includes(permission) || !workspaceId) return decision(null, workspaceId, permission, resource, deny('invalid_scope'));
  const grant = activeGrant(principal.principalId, workspaceId); if (!grant) return decision(principal, workspaceId, permission, resource, deny('grant_missing'));
  const permissions = JSON.parse(canonicalPermissions(grant.permissions));
  const allowedPermission = permissions.includes(permission) || (grant.role !== 'service' && ROLE_PERMISSIONS[grant.role]?.includes(permission));
  return decision(principal, workspaceId, permission, resource, allowedPermission ? allow('granted') : deny('permission_denied'));
}
export const canReadTask = (p,w) => requireWorkspacePermission(p,w,'task.read');
export const canCreateTask = (p,w) => requireWorkspacePermission(p,w,'task.create');
export const canExecuteTask = (p,w) => requireWorkspacePermission(p,w,'task.execute');
export const canViewRuntimeStatus = (p,w) => requireWorkspacePermission(p,w,'runtime.read');
export const canUseDevelopmentProvider = (p,w) => requireWorkspacePermission(p,w,'provider.use.development');
export const canGrantApproval = (p,w) => requireWorkspacePermission(p,w,'approval.grant');
export const canReadEvaluation = (p,w) => requireWorkspacePermission(p,w,'evaluation.read');
export const canCorrectEvaluation = (p,w) => requireWorkspacePermission(p,w,'evaluation.correct');
function allow(reasonCode) { return { allowed: true, reasonCode }; } function deny(reasonCode) { return { allowed: false, reasonCode }; }
function decision(p,w,permission,resource,result) { try { run('INSERT INTO auth_decisions(id,principal_id,principal_type,workspace_id,permission,resource_type,resource_id,allowed,reason_code,policy_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id('authd'),p?.principalId||null,p?.principalType||null,w||null,permission||null,resource.type||null,resource.id||null,result.allowed?1:0,result.reasonCode,AUTHZ_POLICY_VERSION,Date.now()]); } catch { return deny('audit_unavailable'); } return result; }
