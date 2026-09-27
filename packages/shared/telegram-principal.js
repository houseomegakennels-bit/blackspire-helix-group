import { resolveAdminBearer, requireWorkspacePermission } from './authorization.js';

// This is an explicit operator-owned channel delegation, never a client principal ID.
// Keep the Telegram policy class; this binding grants no approval or write authority.
export function telegramReadPrincipal({ actorId, channelKey, workspaceId, authority, executionIntent }, env = process.env) {
  const principalId = env.BLACKSPIRE_TELEGRAM_PRINCIPAL_ID;
  if (!principalId || executionIntent !== 'read_only') return null;
  const owner = env.TELEGRAM_PRIVATE_CHAT_ID;
  if (authority !== 'telegram' || !/^[1-9][0-9]{0,15}$/.test(owner || '') ||
      String(actorId) !== owner || String(channelKey) !== owner ||
      env.TELEGRAM_ALLOWED_USERS !== owner) throw new Error('Telegram identity binding is unavailable');
  const principal = resolveAdminBearer(principalId);
  if (!principal || !['workspace.read', 'task.create', 'task.execute'].every(
    permission => requireWorkspacePermission(principal, workspaceId, permission).allowed
  )) throw new Error('Telegram workspace access is unavailable');
  return principal.principalId;
}
