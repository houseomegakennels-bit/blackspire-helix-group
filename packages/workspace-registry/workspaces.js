import { execSql, query, esc, run, transaction } from '../task-engine/db.js';
import { now } from '../shared/util.js';
import { WORKSPACE_ROOT } from '../shared/config.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function seedWorkspace() {
  upsertWorkspace({
    id: 'blackspire-command', name: 'Blackspire Command', description: 'Safe local foundation workspace', githubRepository: 'local/blackspire-command', defaultBranch: 'work',
    allowedPaths: ['.', 'docs', 'packages', 'apps', 'tests'], buildCommands: ['npm run build', 'npm test', 'npm run lint'], providerPolicy: { preferred: ['codex', 'openai', 'anthropic', 'claudeCode', 'manual'] },
    riskLevel: 'low', budgetCents: 500, secretReferences: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'TELEGRAM_BOT_TOKEN'], enabledTools: ['read', 'write_branch', 'test', 'draft_pr'], lastHealthStatus: 'unknown', rootPath: WORKSPACE_ROOT,
  });
}

export function upsertWorkspace(workspace) {
  execSql(`INSERT OR REPLACE INTO workspaces VALUES (${esc(workspace.id)},${esc(workspace.name)},${esc(workspace.description || '')},${esc(workspace.githubRepository)},${esc(workspace.defaultBranch || 'main')},${esc(JSON.stringify(workspace.allowedPaths || ['.']))},${esc(JSON.stringify(workspace.buildCommands || []))},${esc(JSON.stringify(workspace.providerPolicy || { preferred: ['manual'] }))},${esc(workspace.riskLevel || 'low')},${Number(workspace.budgetCents || 0)},${esc(JSON.stringify(workspace.secretReferences || []))},${esc(JSON.stringify(workspace.enabledTools || []))},${esc(workspace.lastHealthStatus || 'unknown')},${esc(workspace.rootPath || '.')},${esc(now())});`);
}

export function listWorkspaces() {
  seedWorkspace();
  return query('SELECT * FROM workspaces ORDER BY name;').map(parse);
}

export function getWorkspace(id = 'blackspire-command') {
  seedWorkspace();
  const workspace = query(`SELECT * FROM workspaces WHERE id=${esc(id)};`)[0];
  return workspace && parse(workspace);
}

export function workspaceRootIdentity(id) {
  const workspace = query(`SELECT root_path FROM workspaces WHERE id=${esc(id)};`)[0];
  if (!workspace?.root_path) throw new Error('workspace root unavailable for quarantine');
  const logicalRoot = path.resolve(workspace.root_path);
  const physicalRoot = fs.realpathSync(logicalRoot);
  const stat = fs.statSync(physicalRoot, { bigint: true });
  return { logicalRoot, physicalRoot, rootDevice: String(stat.dev), rootInode: String(stat.ino) };
}

export function quarantineKeys({ logicalRoot, physicalRoot, rootDevice, rootInode }) {
  if (!/^\d+$/.test(rootDevice) || !/^\d+$/.test(rootInode)) throw new Error('workspace directory identity unavailable for quarantine');
  const pathKeys = [...new Set([logicalRoot, physicalRoot])].map((root) => `workspace_quarantine_root:${createHash('sha256').update(root).digest('hex')}`);
  const directoryKey = `workspace_quarantine_identity:${createHash('sha256').update(`${rootDevice}:${rootInode}`).digest('hex')}`;
  return [...pathKeys, directoryKey];
}

export function quarantineWorkspace(id, { reason = 'workspace integrity is unverified', taskId = null } = {}) {
  const identity = workspaceRootIdentity(id);
  const value = JSON.stringify({ state: 'quarantined', reason, taskId, quarantinedAt: now(), rootDevice: identity.rootDevice, rootInode: identity.rootInode });
  const timestamp = now();
  transaction(() => { for (const key of quarantineKeys(identity)) run('INSERT OR REPLACE INTO system_flags VALUES (?,?,?);', [key, value, timestamp]); });
  return { ...workspaceDispatchEligibility(id), ...identity };
}

export function workspaceDispatchEligibility(id) {
  let keys;
  try { keys = quarantineKeys(workspaceRootIdentity(id)); } catch { return { eligible: false, state: 'quarantined', reason: 'workspace root identity is unverified', taskId: null }; }
  const values = query(`SELECT value FROM system_flags WHERE key IN (${keys.map(esc).join(',')});`).map((row) => row.value);
  if (!values.length) return { eligible: true, state: 'available' };
  try {
    const quarantines = values.map((value) => JSON.parse(value));
    const quarantine = quarantines.find((entry) => entry?.state === 'quarantined');
    return quarantine && quarantines.every((entry) => entry?.state === 'quarantined')
      ? { eligible: false, state: 'quarantined', reason: quarantine.reason || 'workspace integrity is unverified', taskId: quarantine.taskId || null }
      : { eligible: false, state: 'quarantined', reason: 'workspace quarantine state is invalid', taskId: null };
  } catch {
    return { eligible: false, state: 'quarantined', reason: 'workspace quarantine state is unreadable', taskId: null };
  }
}

export function recoverWorkspace(id, { containmentVerified = false, integrityVerified = false, expectedPhysicalRoot = null } = {}) {
  if (!containmentVerified || !integrityVerified) throw new Error('workspace recovery requires verified process containment and workspace integrity');
  const identity = workspaceRootIdentity(id);
  if (expectedPhysicalRoot && identity.physicalRoot !== expectedPhysicalRoot) throw new Error('workspace recovery requires the quarantined physical root identity');
  const stored = query(`SELECT value FROM system_flags WHERE key IN (${quarantineKeys(identity).map(esc).join(',')});`).map((row) => JSON.parse(row.value));
  if (!stored.length || stored.some((entry) => entry?.rootDevice !== identity.rootDevice || entry?.rootInode !== identity.rootInode)) throw new Error('workspace recovery requires the quarantined directory identity');
  transaction(() => {
    const flags = query("SELECT key,value FROM system_flags WHERE key LIKE 'workspace_quarantine_root:%' OR key LIKE 'workspace_quarantine_identity:%';");
    for (const flag of flags) {
      let value;
      try { value = JSON.parse(flag.value); } catch { continue; }
      if (value?.state === 'quarantined' && value.rootDevice === identity.rootDevice && value.rootInode === identity.rootInode) run('DELETE FROM system_flags WHERE key=?;', [flag.key]);
    }
  });
  return workspaceDispatchEligibility(id);
}

function parse(workspace) {
  for (const key of ['allowed_paths', 'build_commands', 'secret_references', 'enabled_tools']) workspace[key] = JSON.parse(workspace[key] || '[]');
  workspace.provider_policy = JSON.parse(workspace.provider_policy || '{}');
  return workspace;
}
