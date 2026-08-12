import { spawnSync } from 'node:child_process';

if (process.env.BLACKSPIRE_RUN_MIGRATIONS !== 'true') {
  console.error('migration refused: set BLACKSPIRE_RUN_MIGRATIONS=true to run the dedicated migration command');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['scripts/migration-writer.js'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
if (result.error) {
  console.error('migration failed: dedicated writer process could not start');
  process.exitCode = 1;
} else {
  process.exitCode = result.status === 0 ? 0 : 1;
}
