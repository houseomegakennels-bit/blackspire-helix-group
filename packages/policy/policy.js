import { HIGH_RISK_ACTIONS } from '../shared/types.js';

export function decide(action, context = {}) {
  if (HIGH_RISK_ACTIONS.includes(action)) return { allowed: false, requiresApproval: true, reason: 'High-impact action requires administrator approval' };
  if (action === 'repository' && context.repository && context.allowlist && !context.allowlist.includes(context.repository)) return { allowed: false, requiresApproval: false, reason: 'Repository is not allowlisted for this workspace' };
  if (action === 'command' && !(context.allowedCommands || []).includes(context.command)) return { allowed: false, requiresApproval: true, reason: 'Command outside workspace allowlist' };
  if (action === 'path' && !isAllowedPath(context.path, context.allowedPaths || [])) return { allowed: false, requiresApproval: false, reason: 'Path blocked by workspace isolation' };
  return { allowed: true, requiresApproval: false, reason: 'Low-risk approved action' };
}

export function isAllowedPath(filePath, allowed) {
  const normalized = String(filePath || '').replaceAll('\\', '/');
  if (normalized.includes('..') || normalized.startsWith('/')) return false;
  if (allowed.includes('.')) return true;
  return allowed.some((entry) => normalized.startsWith(String(entry).replaceAll('\\', '/').replace(/^\.\/?/, '')));
}
