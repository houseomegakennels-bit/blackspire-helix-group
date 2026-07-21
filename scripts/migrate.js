import { runMigration } from './migration-writer.js';
import { seedWorkspace } from '../packages/workspace-registry/workspaces.js';

if (process.env.BLACKSPIRE_RUN_MIGRATIONS !== 'true') {
  console.error('migration refused: set BLACKSPIRE_RUN_MIGRATIONS=true to run the dedicated migration command');
  process.exit(1);
}

runMigration();
seedWorkspace();
console.log('Migrated Blackspire Command SQLite database.');
