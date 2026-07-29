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
const AUTHORITY_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SENSITIVE_AUTHORITY_VALUE = /(?:secret|token|credential|bearer|authorization|cookie|session|csrf|pem|aws|private-key|api[-_:]?key|^(?:sk|pk|rk|ghp|github_pat|xox|akia)[_-])/i;

function validAuthorityId(value, { nullable = false } = {}) {
  return (nullable && value === null) || (typeof value === 'string' && AUTHORITY_ID.test(value) && !SENSITIVE_AUTHORITY_VALUE.test(value));
}

function validEpoch(value, { nullable = false } = {}) {
  return (nullable && value === null) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function validLifecycle(row) {
  const disabledAt = Object.hasOwn(row, 'disabled_at') ? row.disabled_at : null;
  if (!validEpoch(row.issued_at) || !validEpoch(row.created_at) || !validEpoch(row.expires_at, { nullable: true }) ||
    !validEpoch(row.revoked_at, { nullable: true }) || !validEpoch(disabledAt, { nullable: true }) ||
    !Number.isSafeInteger(row.security_version) || row.security_version < 1) return false;
  if (row.issued_at > Date.now() || row.created_at > Date.now() || (row.revoked_at !== null && row.revoked_at > Date.now()) ||
    (disabledAt !== null && disabledAt > Date.now())) return false;
  return (row.expires_at === null || row.expires_at >= row.issued_at) &&
    (row.revoked_at === null || row.revoked_at >= row.issued_at) &&
    (disabledAt === null || disabledAt >= row.issued_at);
}

function validGrantRow(grant) {
  if (!validAuthorityId(grant.id) || !validAuthorityId(grant.principal_id) || !validAuthorityId(grant.workspace_id) ||
    !validAuthorityId(grant.issued_by, { nullable: true }) || !validLifecycle(grant) || !['active', 'revoked', 'expired', 'superseded'].includes(grant.status)) return false;
  try { validateGrant({ ...grant, supersedesGrantId: grant.supersedes_grant_id }); } catch { return false; }
  return true;
}

export function resolvePrincipal({ principalId = null, authenticationMethod, credentialReference = null } = {}) {
  const p = principalId && get('SELECT * FROM auth_principals WHERE id=?', [principalId]);
  if (!p || !validAuthorityId(p.id) || !validAuthorityId(p.actor_id) || !validAuthorityId(p.credential_reference, { nullable: true }) || !validLifecycle(p) || !['admin','service'].includes(p.type) || p.authentication_method !== (p.type === 'admin' ? 'bearer' : 'service') || p.status !== 'active' || (p.expires_at !== null && p.expires_at <= Date.now()) || p.revoked_at !== null || p.disabled_at !== null) return null;
  if (authenticationMethod && p.authentication_method !== authenticationMethod) return null;
  if (credentialReference && p.credential_reference !== credentialReference) return null;
  const principal = Object.freeze({ principalId: p.id, principalType: p.type, actorId: p.actor_id, authenticationMethod: p.authentication_method, securityVersion: p.security_version });
  resolvedPrincipals.add(principal);
  return principal;
}
export const resolveAdminBearer = (principalId) => resolvePrincipal({ principalId, authenticationMethod: 'bearer' });
export const resolveServiceContext = (principalId, credentialReference) => resolvePrincipal({ principalId, authenticationMethod: 'service', credentialReference });
// Sessions are bound only by server-side code after credential verification.  Their stored
// principal remains an admin/service principal authenticated by its configured method; `session`
// is a transport, not a new principal type or an impersonation input.
export function resolveBoundSession(session) {
  const principalId = session?.principalId ?? session?.principal_id;
  const principal = typeof principalId === 'string' ? resolvePrincipal({ principalId }) : null;
  return principal?.principalType === 'admin' ? principal : null;
}
export const requireAuthenticatedPrincipal = (p) => p ? allow('authenticated') : deny('unauthenticated');

export function activeGrant(principalId, workspaceId) {
  const rows = all(`SELECT * FROM auth_workspace_grants WHERE principal_id=? AND workspace_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?) AND revoked_at IS NULL ORDER BY version DESC`, [principalId, workspaceId, Date.now()]);
  if (rows.length !== 1) return null;
  const g = rows[0];
  if (!validGrantRow(g)) return null;
  // An immutable successor makes this row stale regardless of the successor's lifecycle.
  // Otherwise a corrupted successor marked non-active could leave its older parent authorized.
  if (get('SELECT id FROM auth_workspace_grants WHERE supersedes_grant_id=? LIMIT 1', [g.id])) return null;
  if (!validateGrantChain(g)) return null;
  return g;
}
// Versions are strictly increasing, but need not be contiguous: a revoked version may be retained
// without an active successor. Cycles/cross-scope links are refused before a grant is usable.
export function validateGrantChain(head) {
  const seen = new Set(); let current = head; let child = null; let priorVersion = Infinity;
  while (current) {
    if (!validGrantRow(current) || seen.has(current.id) || !Number.isInteger(current.version) || current.version < 1 || current.version >= priorVersion) return false;
    const successors = all('SELECT * FROM auth_workspace_grants WHERE supersedes_grant_id=?', [current.id]);
    // A head has no successor. Every ancestor has exactly the child already traversed;
    // extra, cross-scope, or malformed children make the chain ambiguous.
    if ((!child && successors.length) || (child && (successors.length !== 1 || successors[0].id !== child.id || !validGrantRow(successors[0])))) return false;
    seen.add(current.id); priorVersion = Number(current.version);
    if (!current.supersedes_grant_id) return true;
    child = current;
    current = get('SELECT * FROM auth_workspace_grants WHERE id=?', [current.supersedes_grant_id]);
    if (!current || current.principal_id !== head.principal_id || current.workspace_id !== head.workspace_id) return false;
  }
  return false;
}
export function requireWorkspacePermission(principal, workspaceId, permission, resource = {}) {
  if (!principal || !resolvedPrincipals.has(principal) || !AUTHZ_PERMISSIONS.includes(permission) || !workspaceId) return decision(null, null, permission, deny('invalid_scope'));
  const grant = activeGrant(principal.principalId, workspaceId); if (!grant) return decision(principal, null, permission, deny('grant_missing'));
  const permissions = JSON.parse(canonicalPermissions(grant.permissions));
  const allowedPermission = permissions.includes(permission) || (principal.principalType !== 'service' && grant.role !== 'service' && ROLE_PERMISSIONS[grant.role]?.includes(permission));
  return decision(principal, grant.workspace_id, permission, allowedPermission ? allow('granted') : deny('permission_denied'));
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
function auditValue(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && !/(?:secret|token|credential|bearer|authorization|cookie|session|csrf|pem|aws|private-key|api[-_:]?key|^(?:sk|pk|rk|ghp|github_pat|xox|akia)[_-])/i.test(value) ? value : null; }
function decision(p,w,permission,result) { try { run('INSERT INTO auth_decisions(id,principal_id,principal_type,workspace_id,permission,resource_type,resource_id,allowed,reason_code,policy_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id('authd'),auditValue(p?.principalId),auditValue(p?.principalType),auditValue(w),auditValue(permission),null,null,result.allowed?1:0,result.reasonCode,AUTHZ_POLICY_VERSION,Date.now()]); } catch { return deny('audit_unavailable'); } return result; }
