import { resolveBindTarget } from './bind.js';
import { resolveWorkspaceRoot } from './workspace-root.js';

export const DATA_DIR = process.env.BLACKSPIRE_DATA_DIR || '.blackspire-command';
// The cwd Hermes uses for git/build work. Defaults to the historical "." and is strictly validated
// (absolute, existing, non-symlink, directory, git checkout) whenever BLACKSPIRE_WORKSPACE_ROOT is
// set, failing startup closed rather than degrading to a read-only immutable release. Server-side
// environment only - never a request, frontend, or database value. See ./workspace-root.js.
export const WORKSPACE_ROOT = resolveWorkspaceRoot();
export const DB_PATH = process.env.BLACKSPIRE_DB_PATH || `${DATA_DIR}/command.sqlite`;
export const ATTACHMENTS_DIR = process.env.TELEGRAM_TMP_DIR || `${DATA_DIR}/telegram-files`;
export const ADMIN_TOKEN = process.env.COMMAND_ADMIN_TOKEN || '';
export const ADMIN_PASSWORD_HASH = process.env.COMMAND_ADMIN_PASSWORD_HASH || '';
const telegramAllowedUsersDefault = process.env.NODE_ENV === 'production' ? '' : '1001';
export const TELEGRAM_ALLOWED_USERS = (process.env.TELEGRAM_ALLOWED_USERS || telegramAllowedUsersDefault).split(',').map((v)=>Number(v.trim())).filter(Boolean);
// The listening port has exactly one source of truth: packages/shared/bind.js. Nothing imported
// this module's former PORT export, and keeping a second `process.env.PORT || 8787` here would
// have re-introduced the 8787 default that the production contract exists to forbid.
// resolveBindTarget preserves the historical development default and yields no port at all for a
// production profile without an explicit one, so no implicit base URL can be produced there -
// production must set PUBLIC_BASE_URL, and requireProductionSafeConfig already enforces that.
const boundPort = resolveBindTarget().port;
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || (boundPort === null ? '' : `http://localhost:${boundPort}`);
// Bearer-token auth bypasses cookie/CSRF protections. In production it is off unless explicitly opted into
// (server-to-server callers such as the Telegram bridge or scripts must set ALLOW_BEARER_AUTH=true deliberately).
export const ALLOW_BEARER_AUTH = process.env.NODE_ENV === 'production' ? process.env.ALLOW_BEARER_AUTH === 'true' : process.env.ALLOW_BEARER_AUTH !== 'false';
