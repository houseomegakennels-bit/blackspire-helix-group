#!/usr/bin/env node
// Explicit, development-only authorization bootstrap. It never migrates or selects an app DB.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalPermissions, AUTHZ_ROLES } from '../packages/shared/authz-schema.js';
import { findMissingSchemaObjects } from '../packages/shared/schema-validation.js';

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1] || null; };
const configPath = value('--config');
const databasePath = value('--database');
const mode = args.includes('--apply') ? 'apply' : args.includes('--dry-run') ? 'dry-run' : args.includes('--validate-only') ? 'validate-only' : null;
const fail = (code) => { process.stderr.write(`${code}\n`); process.exitCode = 1; };

try {
  if (!configPath || !mode || args.filter((a) => ['--apply', '--dry-run', '--validate-only'].includes(a)).length !== 1) throw new Error('AUTHZ_PROVISIONING_REFUSED');
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production') throw new Error('AUTHZ_PROVISIONING_REFUSED');
  const config = readConfig(configPath); validate(config);
  if (mode !== 'apply') output({ ok: true, mode, principal_ids: config.principals.map((p) => p.principal_id), grant_ids: config.workspace_grants.map((g) => g.grant_id), reason_codes: [] });
  else apply(config, requireSafeDatabase(databasePath));
} catch (error) { fail(error?.message === 'AUTHZ_CONFIG_INVALID' ? error.message : error?.message?.startsWith('AUTHZ_') ? error.message : 'AUTHZ_PROVISIONING_REFUSED'); }

function readConfig(file) { try { if (fs.statSync(file).size > 65536) bad(); return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('AUTHZ_CONFIG_INVALID'); } }
function requireSafeDatabase(file) {
  if (!file) throw new Error('AUTHZ_DATABASE_REQUIRED');
  if (!path.isAbsolute(file)) throw new Error('AUTHZ_DATABASE_REFUSED');
  const resolved = path.resolve(file); const parts = resolved.toLowerCase().split(path.sep);
  if (parts.some((part) => ['shared', 'staging', 'production'].includes(part))) throw new Error('AUTHZ_DATABASE_REFUSED');
  if (!fs.existsSync(resolved)) throw new Error('AUTHZ_DATABASE_REFUSED');
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('AUTHZ_DATABASE_REFUSED');
  return resolved;
}
function validate(c) {
  const keys = ['version', 'principals', 'workspace_grants', 'admin_bearer_principal_id', 'service_mappings'];
  if (!c || c.version !== 1 || Object.keys(c).some((k) => !keys.includes(k)) || !Array.isArray(c.principals) || !Array.isArray(c.workspace_grants) || !c.service_mappings || typeof c.service_mappings !== 'object' || Array.isArray(c.service_mappings)) bad();
  const principals = new Map(); const grants = new Map(); const scopeVersions = new Set();
  for (const p of c.principals) {
    if (!p || Object.keys(p).some((k) => !['principal_id','principal_type','actor_id','authentication_method','credential_reference','status','issued_at','expires_at','revoked_at','disabled_at','security_version'].includes(k)) || !authorityId(p.principal_id) || principals.has(p.principal_id) || !['admin','service'].includes(p.principal_type) || !authorityId(p.actor_id) || p.authentication_method !== (p.principal_type === 'admin' ? 'bearer' : 'service') || (p.principal_type === 'service' && !authorityId(p.credential_reference)) || (p.principal_type === 'admin' && !nullableAuthorityId(p.credential_reference)) || !principalLifecycle(p) || !integer(p.security_version) || p.security_version < 1) bad();
    principals.set(p.principal_id, p);
  }
  for (const g of c.workspace_grants) {
    const scope = `${g?.principal_id}\u0000${g?.workspace_id}\u0000${g?.version}`;
    if (!g || Object.keys(g).some((k) => !['grant_id','principal_id','workspace_id','role','permissions','status','version','supersedes_grant_id','issued_at','expires_at','revoked_at','issued_by','security_version'].includes(k)) || !authorityId(g.grant_id) || grants.has(g.grant_id) || !principals.has(g.principal_id) || !authorityId(g.workspace_id) || !AUTHZ_ROLES.includes(g.role) || !grantLifecycle(g) || !integer(g.version) || g.version < 1 || scopeVersions.has(scope) || !nullableAuthorityId(g.supersedes_grant_id) || !authorityId(g.issued_by) || !integer(g.security_version) || g.security_version < 1) bad();
    try { canonicalPermissions(g.permissions); } catch { bad(); } grants.set(g.grant_id, g); scopeVersions.add(scope);
  }
  if (c.admin_bearer_principal_id !== null && principals.get(c.admin_bearer_principal_id)?.principal_type !== 'admin') bad();
  for (const id of Object.values(c.service_mappings)) if (principals.get(id)?.principal_type !== 'service') bad();
  const scopes = new Map();
  for (const g of grants.values()) {
    const key = `${g.principal_id}\u0000${g.workspace_id}`;
    if (!scopes.has(key)) scopes.set(key, []);
    scopes.get(key).push(g);
    if (g.supersedes_grant_id) {
      const parent = grants.get(g.supersedes_grant_id);
      if (!parent || parent.principal_id !== g.principal_id || parent.workspace_id !== g.workspace_id || g.version !== parent.version + 1 || g.issued_at < parent.issued_at) bad();
    }
  }
  for (const rows of scopes.values()) validateGrantGraph(rows);
}
function apply(c, database) {
  const db = new DatabaseSync(database);
  try {
    const missing = findMissingSchemaObjects(db); if (missing.length) throw new Error('AUTHZ_SCHEMA_REQUIRED');
    let createdPrincipals = 0; let createdGrants = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const p of c.principals) { const row = db.prepare('SELECT * FROM auth_principals WHERE id=? OR (type=? AND actor_id=?)').get(p.principal_id, p.principal_type, p.actor_id); if (row && !samePrincipal(row, p)) throw new Error('AUTHZ_PRINCIPAL_CONFLICT'); if (!row) { db.prepare('INSERT INTO auth_principals(id,type,actor_id,authentication_method,credential_reference,status,issued_at,expires_at,revoked_at,disabled_at,security_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(p.principal_id,p.principal_type,p.actor_id,p.authentication_method,p.credential_reference ?? null,p.status,p.issued_at,p.expires_at ?? null,p.revoked_at ?? null,p.disabled_at ?? null,p.security_version,p.issued_at); createdPrincipals++; } }
      for (const g of c.workspace_grants) { const row = db.prepare('SELECT * FROM auth_workspace_grants WHERE id=? OR (principal_id=? AND workspace_id=? AND version=?)').get(g.grant_id,g.principal_id,g.workspace_id,g.version); if (row && !sameGrant(row, g)) throw new Error('AUTHZ_GRANT_CONFLICT'); if (!row) { db.prepare('INSERT INTO auth_workspace_grants(id,principal_id,workspace_id,role,permissions,status,version,supersedes_grant_id,issued_at,expires_at,revoked_at,issued_by,security_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(g.grant_id,g.principal_id,g.workspace_id,g.role,canonicalPermissions(g.permissions),g.status ?? 'active',g.version,g.supersedes_grant_id ?? null,g.issued_at,g.expires_at ?? null,g.revoked_at ?? null,g.issued_by,g.security_version,g.issued_at); createdGrants++; } }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    output({ ok: true, mode: 'apply', database: path.basename(database), principal_ids: c.principals.map((p) => p.principal_id), grant_ids: c.workspace_grants.map((g) => g.grant_id), created: { principals: createdPrincipals, grants: createdGrants }, skipped: { principals: c.principals.length - createdPrincipals, grants: c.workspace_grants.length - createdGrants }, reason_codes: [] });
  } finally { db.close(); }
}
function samePrincipal(r,p) { return r.id===p.principal_id && r.type===p.principal_type && r.actor_id===p.actor_id && r.authentication_method===p.authentication_method && (r.credential_reference??null)===(p.credential_reference??null) && r.status===p.status && r.issued_at===p.issued_at && (r.expires_at??null)===(p.expires_at??null) && (r.revoked_at??null)===(p.revoked_at??null) && (r.disabled_at??null)===(p.disabled_at??null) && r.security_version===p.security_version; }
function sameGrant(r,g) { return r.id===g.grant_id && r.principal_id===g.principal_id && r.workspace_id===g.workspace_id && r.role===g.role && r.permissions===canonicalPermissions(g.permissions) && r.status===(g.status ?? 'active') && r.version===g.version && (r.supersedes_grant_id??null)===(g.supersedes_grant_id??null) && r.issued_at===g.issued_at && (r.expires_at??null)===(g.expires_at??null) && (r.revoked_at??null)===(g.revoked_at??null) && r.issued_by===g.issued_by && r.security_version===g.security_version; }
function text(v) { return typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v); }
function authorityId(v) { return typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v) && !/(?:secret|token|credential|bearer|authorization|cookie|session|csrf|pem|aws|private-key|api[-_:]?key|^(?:sk|pk|rk|ghp|github_pat|xox|akia)[_-])/i.test(v); }
function nullableAuthorityId(v) { return v === null || v === undefined || authorityId(v); }
function integer(v) { return Number.isInteger(v); }
function nullableInteger(v) { return v === null || v === undefined || integer(v); }
function principalLifecycle(p) {
  const expiresAt = p.expires_at ?? null;
  const revokedAt = p.revoked_at ?? null;
  const disabledAt = p.disabled_at ?? null;
  if (!['active','revoked','disabled','expired'].includes(p.status) || !integer(p.issued_at) || !nullableInteger(expiresAt) || !nullableInteger(revokedAt) || !nullableInteger(disabledAt)) return false;
  if ((expiresAt !== null && expiresAt < p.issued_at) || (revokedAt !== null && revokedAt < p.issued_at) || (disabledAt !== null && disabledAt < p.issued_at)) return false;
  return (p.status === 'active' && revokedAt === null && disabledAt === null && (expiresAt === null || expiresAt > Date.now())) ||
    (p.status === 'revoked' && revokedAt !== null) || (p.status === 'disabled' && disabledAt !== null) ||
    (p.status === 'expired' && expiresAt !== null && expiresAt <= Date.now());
}
function grantLifecycle(g) {
  const status = g.status ?? 'active';
  const expiresAt = g.expires_at ?? null;
  const revokedAt = g.revoked_at ?? null;
  if (!['active','revoked','expired','superseded'].includes(status) || !integer(g.issued_at) || !nullableInteger(expiresAt) || !nullableInteger(revokedAt)) return false;
  if ((expiresAt !== null && expiresAt < g.issued_at) || (revokedAt !== null && revokedAt < g.issued_at)) return false;
  return (status === 'active' && revokedAt === null && (expiresAt === null || expiresAt > Date.now())) ||
    (status === 'revoked' && revokedAt !== null) || (status === 'expired' && expiresAt !== null && expiresAt <= Date.now()) ||
    status === 'superseded';
}
function validateGrantGraph(rows) {
  const byId = new Map(rows.map((row) => [row.grant_id, row]));
  const children = new Map(rows.map((row) => [row.grant_id, []]));
  for (const row of rows) if (row.supersedes_grant_id) children.get(row.supersedes_grant_id)?.push(row);
  const roots = rows.filter((row) => !row.supersedes_grant_id);
  const terminals = rows.filter((row) => children.get(row.grant_id).length === 0);
  if (roots.length !== 1 || terminals.length !== 1 || roots[0].version !== 1 || (terminals[0].status ?? 'active') !== 'active' || rows.filter((row) => (row.status ?? 'active') === 'active').length !== 1 || rows.some((row) => children.get(row.grant_id).length > 1)) bad();
  const seen = new Set();
  let current = roots[0];
  while (current) {
    if (seen.has(current.grant_id)) bad();
    seen.add(current.grant_id);
    current = children.get(current.grant_id)[0] || null;
  }
  if (seen.size !== byId.size) bad();
}
function bad() { throw new Error('AUTHZ_CONFIG_INVALID'); }
function output(v) { process.stdout.write(`${JSON.stringify(v)}\n`); }
