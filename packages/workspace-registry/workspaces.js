import { execSql, query, esc } from '../task-engine/db.js';
import { now } from '../shared/util.js';
import { WORKSPACE_ROOT } from '../shared/config.js';

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

const quarantineKey = (id) => `workspace_quarantine:${id}`;

export function quarantineWorkspace(id, { reason = 'workspace integrity is unverified', taskId = null } = {}) {
  const value = JSON.stringify({ state: 'quarantined', reason, taskId, quarantinedAt: now() });
  execSql(`INSERT OR REPLACE INTO system_flags VALUES (${esc(quarantineKey(id))},${esc(value)},${esc(now())});`);
  return workspaceDispatchEligibility(id);
}

export function workspaceDispatchEligibility(id) {
  const value = query(`SELECT value FROM system_flags WHERE key=${esc(quarantineKey(id))};`)[0]?.value;
  if (!value) return { eligible: true, state: 'available' };
  try {
    const quarantine = JSON.parse(value);
    return quarantine?.state === 'quarantined'
      ? { eligible: false, state: 'quarantined', reason: quarantine.reason || 'workspace integrity is unverified', taskId: quarantine.taskId || null }
      : { eligible: false, state: 'quarantined', reason: 'workspace quarantine state is invalid', taskId: null };
  } catch {
    return { eligible: false, state: 'quarantined', reason: 'workspace quarantine state is unreadable', taskId: null };
  }
}

export function recoverWorkspace(id, { containmentVerified = false, integrityVerified = false } = {}) {
  if (!containmentVerified || !integrityVerified) throw new Error('workspace recovery requires verified process containment and workspace integrity');
  execSql(`DELETE FROM system_flags WHERE key=${esc(quarantineKey(id))};`);
  return workspaceDispatchEligibility(id);
}

function parse(workspace) {
  for (const key of ['allowed_paths', 'build_commands', 'secret_references', 'enabled_tools']) workspace[key] = JSON.parse(workspace[key] || '[]');
  workspace.provider_policy = JSON.parse(workspace.provider_policy || '{}');
  return workspace;
}
