import { HIGH_RISK_ACTIONS } from '../shared/types.js';

const REPOSITORY = '(?:github\\s+)?(?:repo(?:sitory|s)?|repositories)';
const MUTATION = '(?:create|make|initialize|init|publish|delete|remove|destroy|change|modify|set|enable|disable|increase|decrease|reset|rotate|transfer|send|move|deploy|merge)';
const PROTECTED_TARGET = '(?:repo(?:sitory|s)?|repositories|github|deploy(?:ment)?|production|protected\\s+branch|credentials?|secrets?|tokens?|passwords?|api\\s+keys?|private\\s+keys?|host\\s+security|firewall|budget|billing|emergency\\s+(?:stop|controls?)|constitution|constitutional|trad(?:e|ing)|funds?)';

export function normalizeRequest(request) {
  return String(request || '').normalize('NFKC').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[_/\\-]+/g, ' ').replace(/[^a-z0-9.'\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyRequest(request) {
  const normalized = normalizeRequest(request);
  const result = (actionClass, { privileged = true, prohibited = false } = {}) => ({ actionClass, privileged, prohibited, normalized });
  if (/\b(?:live\s+trad(?:e|ing)|send\s+funds?|transfer\s+funds?|move\s+funds?)\b/i.test(normalized)) return result('live_trading_or_funds', { prohibited: true });
  if (/\b(?:show|read|print|expose|return|give|reveal|access)\b.{0,80}(?:\b(?:secrets?|credentials?|tokens?|passwords?|api\s+keys?|private\s+keys?)\b|\.env\b)/i.test(normalized)) return result('rotate_or_expose_credentials', { prohibited: true });
  if (new RegExp(`\\b(?:delete|remove|destroy)\\b.{0,60}\\b${REPOSITORY}\\b|\\b${REPOSITORY}\\b.{0,60}\\b(?:delete|remove|destroy)\\b`, 'i').test(normalized)) return result('repository_delete');
  if (new RegExp(`\\b(?:make|set|change|modify)\\b.{0,60}\\b${REPOSITORY}\\b.{0,60}\\b(?:public|private|visibility)\\b|\\b${REPOSITORY}\\b.{0,60}\\b(?:visibility|public|private)\\b`, 'i').test(normalized)) return result('repository_visibility');
  if (new RegExp(`\\b(?:create|make|initialize|init|publish|set\\s+up|start)\\b.{0,80}\\b${REPOSITORY}\\b`, 'i').test(normalized)) return result('repository_create');
  if (/\b(?:delete|remove|destroy)\b.{0,60}\b(?:data|database|records?|files?)\b/i.test(normalized)) return result('delete_data');
  if (/\bdeploy(?:ment|ing)?\b|\bdeploy\b/i.test(normalized)) return result('production_deploy');
  if (/\bmerge\b/i.test(normalized)) return result('merge_protected_branch');
  if (/\b(?:credentials?|secrets?|tokens?|passwords?|api\s+keys?|private\s+keys?)\b|\.env\b/i.test(normalized)) return result('rotate_or_expose_credentials');
  if (/\b(?:host\s+security|firewall|apparmor|kernel|sysctl)\b/i.test(normalized)) return result('disable_security_control');
  if (/\b(?:increase|raise|change|modify)\b.{0,40}\b(?:budget|billing)\b|\b(?:budget|billing)\b.{0,40}\b(?:increase|raise|change|modify)\b/i.test(normalized)) return result('change_billing');
  if (/\b(?:emergency\s+(?:stop|controls?)|reset\s+emergency)\b/i.test(normalized)) return result('disable_security_control');
  if (/\b(?:constitution|constitutional)\b/i.test(normalized)) return result('change_approval_policy');
  if (/\b(?:trad(?:e|ing)|funds?)\b/i.test(normalized)) return result('live_trading_or_funds');
  if (new RegExp(`\\b${MUTATION}\\b.{0,80}\\b${PROTECTED_TARGET}\\b`, 'i').test(normalized)) return result('unknown_privileged');
  return result('low_risk', { privileged: false });
}

export function evaluateRequestPolicy({ request, channel = 'api', authority = 'untrusted' }) {
  const classification = classifyRequest(request);
  if (classification.prohibited || classification.actionClass === 'unknown_privileged') return { ...classification, allowed: false, requiresApproval: false, reason: 'Request denied by Blackspire policy' };
  const restricted = channel === 'telegram' || ['telegram', 'test_operator', 'untrusted'].includes(authority);
  if (classification.privileged && restricted) return { ...classification, allowed: false, requiresApproval: false, reason: channel === 'telegram' ? 'Telegram cannot perform privileged or prohibited actions' : 'Request requires authenticated administrator authority' };
  if (classification.privileged) return { ...classification, allowed: true, requiresApproval: true, reason: 'High-impact action requires administrator approval' };
  return { ...classification, allowed: true, requiresApproval: false, reason: 'Low-risk approved action' };
}

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
