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
const resolvedPrincipals = new WeakMap();
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
  return row.created_at >= row.issued_at &&
    (row.expires_at === null || row.expires_at >= row.issued_at) &&
    (row.revoked_at === null || row.revoked_at >= row.issued_at) &&
    (disabledAt === null || disabledAt >= row.issued_at);
}

function validGrantRow(grant) {
  if (!validAuthorityId(grant.id) || !validAuthorityId(grant.principal_id) || !validAuthorityId(grant.workspace_id) ||
    !validAuthorityId(grant.issued_by, { nullable: true }) || !validLifecycle(grant) || !['active', 'revoked', 'expired', 'superseded'].includes(grant.status)) return false;
  if ((grant.status === 'active' && (grant.revoked_at !== null || (grant.expires_at !== null && grant.expires_at <= Date.now()))) ||
    (grant.status === 'revoked' && grant.revoked_at === null) ||
    (grant.status === 'expired' && (grant.expires_at === null || grant.expires_at > Date.now()))) return false;
  try { validateGrant({ ...grant, supersedesGrantId: grant.supersedes_grant_id }); } catch { return false; }
  return true;
}

export function resolvePrincipal({ principalId = null, authenticationMethod, credentialReference = null } = {}) {
  const p = principalId && get('SELECT * FROM auth_principals WHERE id=?', [principalId]);
  if (!p || !validAuthorityId(p.id) || !validAuthorityId(p.actor_id) || !validAuthorityId(p.credential_reference, { nullable: true }) || !validLifecycle(p) || !['admin','service'].includes(p.type) || p.authentication_method !== (p.type === 'admin' ? 'bearer' : 'service') || p.status !== 'active' || (p.expires_at !== null && p.expires_at <= Date.now()) || p.revoked_at !== null || p.disabled_at !== null) return null;
  // This is an authentication boundary, not a persisted-row lookup. Callers must select the
  // canonical method explicitly, and service principals must prove the exact configured reference.
  if (!['bearer', 'service'].includes(authenticationMethod) || p.authentication_method !== authenticationMethod) return null;
  if (p.type === 'service' && (!validAuthorityId(credentialReference) || p.credential_reference !== credentialReference)) return null;
  const principal = Object.freeze({ principalId: p.id, principalType: p.type, actorId: p.actor_id, authenticationMethod: p.authentication_method, securityVersion: p.security_version });
  resolvedPrincipals.set(principal, p.credential_reference);
  return principal;
}
export const resolveAdminBearer = (principalId) => resolvePrincipal({ principalId, authenticationMethod: 'bearer' });
export const resolveServiceContext = (principalId, credentialReference) => validAuthorityId(credentialReference)
  ? resolvePrincipal({ principalId, authenticationMethod: 'service', credentialReference }) : null;
// Sessions are bound only by server-side code after credential verification.  Their stored
// principal remains an admin/service principal authenticated by its configured method; `session`
// is a transport, not a new principal type or an impersonation input.
export function resolveBoundSession(session) {
  const principalId = session?.principalId ?? session?.principal_id;
  const principal = typeof principalId === 'string' ? resolveAdminBearer(principalId) : null;
  return principal?.principalType === 'admin' ? principal : null;
}
export const requireAuthenticatedPrincipal = (principal) => currentPrincipal(principal) ? allow('authenticated') : deny('unauthenticated');

export function activeGrant(principalId, workspaceId) {
  const rows = all(`SELECT * FROM auth_workspace_grants WHERE principal_id=? AND workspace_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?) AND revoked_at IS NULL ORDER BY version DESC`, [principalId, workspaceId, Date.now()]);
  if (rows.length !== 1) return null;
  const g = rows[0];
  if (!validGrantRow(g)) return null;
  if (!validateGrantChain(g)) return null;
  return g;
}
// Authority requires one complete, linear, contiguous graph for the principal/workspace. Every
// persisted row (including non-active siblings and detached rows) is checked before permission use.
export function validateGrantChain(head) {
  if (!head || !validGrantRow(head)) return false;
  const rows = all('SELECT * FROM auth_workspace_grants WHERE principal_id=? AND workspace_id=?', [head.principal_id, head.workspace_id]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const persistedHead = byId.get(head.id);
  if (!rows.length || byId.size !== rows.length || !persistedHead ||
    Object.keys(persistedHead).some((key) => persistedHead[key] !== head[key]) ||
    rows.some((row) => !validGrantRow(row))) return false;
  const children = new Map(rows.map((row) => [row.id, []]));
  for (const row of rows) {
    if (!row.supersedes_grant_id) continue;
    const parent = byId.get(row.supersedes_grant_id);
    if (!parent || row.version !== parent.version + 1 || row.issued_at < parent.issued_at || row.created_at < parent.created_at) return false;
    children.get(parent.id).push(row);
  }
  // Check globally, so a cross-principal/workspace sibling cannot be ignored.
  for (const row of rows) {
    const allChildren = all('SELECT * FROM auth_workspace_grants WHERE supersedes_grant_id=?', [row.id]);
    if (allChildren.some((child) => child.principal_id !== head.principal_id || child.workspace_id !== head.workspace_id || !validGrantRow(child))) return false;
    if (allChildren.length !== children.get(row.id).length || allChildren.length > 1) return false;
  }
  const roots = rows.filter((row) => !row.supersedes_grant_id);
  const terminals = rows.filter((row) => children.get(row.id).length === 0);
  if (roots.length !== 1 || terminals.length !== 1 || roots[0].version !== 1 || terminals[0].id !== head.id || head.status !== 'active') return false;
  const seen = new Set(); let current = roots[0];
  while (current) { if (seen.has(current.id)) return false; seen.add(current.id); current = children.get(current.id)[0] || null; }
  return seen.size === rows.length;
}
export function requireWorkspacePermission(principal, workspaceId, permission, resource = {}) {
  const resolved = resolveWorkspacePermission(principal, workspaceId, permission);
  return decision(resolved.principal, resolved.workspaceId, permission, resolved.result);
}

export function hasCurrentWorkspacePermission(principal, workspaceId, permission) {
  return resolveWorkspacePermission(principal, workspaceId, permission).result.allowed;
}

function resolveWorkspacePermission(principal, workspaceId, permission) {
  const current = currentPrincipal(principal);
  if (!current || !AUTHZ_PERMISSIONS.includes(permission) || !workspaceId) return { principal: null, workspaceId: null, result: deny('invalid_scope') };
  const grant = activeGrant(current.principalId, workspaceId);
  if (!grant) return { principal: current, workspaceId: null, result: deny('grant_missing') };
  const permissions = JSON.parse(canonicalPermissions(grant.permissions));
  const allowedPermission = permissions.includes(permission) || (current.principalType !== 'service' && grant.role !== 'service' && ROLE_PERMISSIONS[grant.role]?.includes(permission));
  return { principal: current, workspaceId: grant.workspace_id, result: allowedPermission ? allow('granted') : deny('permission_denied') };
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
function currentPrincipal(principal) {
  if (!principal || !resolvedPrincipals.has(principal)) return null;
  const credentialReference = resolvedPrincipals.get(principal);
  const current = resolvePrincipal({ principalId: principal.principalId, authenticationMethod: principal.authenticationMethod, credentialReference });
  if (!current) return null;
  return ['principalId','principalType','actorId','authenticationMethod','securityVersion'].every((key) => current[key] === principal[key]) ? current : null;
}
function auditValue(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && !/(?:secret|token|credential|bearer|authorization|cookie|session|csrf|pem|aws|private-key|api[-_:]?key|^(?:sk|pk|rk|ghp|github_pat|xox|akia)[_-])/i.test(value) ? value : null; }
function decision(p,w,permission,result) { try { run('INSERT INTO auth_decisions(id,principal_id,principal_type,workspace_id,permission,resource_type,resource_id,allowed,reason_code,policy_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id('authd'),auditValue(p?.principalId),auditValue(p?.principalType),auditValue(w),auditValue(permission),null,null,result.allowed?1:0,result.reasonCode,AUTHZ_POLICY_VERSION,Date.now()]); } catch { return deny('audit_unavailable'); } return result; }
