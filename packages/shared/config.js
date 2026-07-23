import { resolveBindTarget } from './bind.js';

export const DATA_DIR = process.env.BLACKSPIRE_DATA_DIR || '.blackspire-command';
export const DB_PATH = process.env.BLACKSPIRE_DB_PATH || `${DATA_DIR}/command.sqlite`;
export const ATTACHMENTS_DIR = process.env.TELEGRAM_TMP_DIR || `${DATA_DIR}/telegram-files`;
export const ADMIN_TOKEN = process.env.COMMAND_ADMIN_TOKEN || '';
export const TELEGRAM_ALLOWED_USERS = (process.env.TELEGRAM_ALLOWED_USERS || '1001').split(',').map((v)=>Number(v.trim())).filter(Boolean);
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
