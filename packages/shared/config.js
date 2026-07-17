export const DATA_DIR = process.env.BLACKSPIRE_DATA_DIR || '.blackspire-command';
export const WORKSPACE_ROOT = process.env.BLACKSPIRE_WORKSPACE_ROOT || '.';
export const DB_PATH = process.env.BLACKSPIRE_DB_PATH || `${DATA_DIR}/command.sqlite`;
export const ATTACHMENTS_DIR = process.env.TELEGRAM_TMP_DIR || `${DATA_DIR}/telegram-files`;
export const ADMIN_TOKEN = process.env.COMMAND_ADMIN_TOKEN || 'dev-admin-token-change-me';
export const TELEGRAM_ALLOWED_USERS = (process.env.TELEGRAM_ALLOWED_USERS || '1001').split(',').map((v)=>Number(v.trim())).filter(Boolean);
export const PORT = Number(process.env.PORT || 8787);
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
// Bearer-token auth bypasses cookie/CSRF protections. In production it is off unless explicitly opted into
// (server-to-server callers such as the Telegram bridge or scripts must set ALLOW_BEARER_AUTH=true deliberately).
export const ALLOW_BEARER_AUTH = process.env.NODE_ENV === 'production' ? process.env.ALLOW_BEARER_AUTH === 'true' : process.env.ALLOW_BEARER_AUTH !== 'false';
