import fs from 'node:fs';
import path from 'node:path';
import {DB_PATH} from '../packages/shared/config.js';

const protectedCredentialPath = '/root/.config/blackspire/github.env';
const target = path.resolve(process.argv[2] || `${DB_PATH}.bak`);
if (target === protectedCredentialPath || path.resolve(DB_PATH) === protectedCredentialPath) {
  throw new Error('Protected credential paths cannot be used for database backup or restore data.');
}
fs.copyFileSync(DB_PATH, target);
console.log(`Backup written to ${target}`);
