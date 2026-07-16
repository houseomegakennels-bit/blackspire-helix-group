export const DATA_DIR = process.env.BLACKSPIRE_DATA_DIR || '.blackspire-command';
export const DB_PATH = process.env.BLACKSPIRE_DB_PATH || `${DATA_DIR}/command.sqlite`;
export const ADMIN_TOKEN = process.env.COMMAND_ADMIN_TOKEN || 'dev-admin-token-change-me';
export const TELEGRAM_ALLOWED_USERS = (process.env.TELEGRAM_ALLOWED_USERS || '1001').split(',').map((v)=>Number(v.trim())).filter(Boolean);
export const PORT = Number(process.env.PORT || 8787);
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
