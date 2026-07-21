import {spawnSync} from 'node:child_process';
import {readFileSync, statSync} from 'node:fs';

const staged = spawnSync('git', ['diff', '--cached'], {encoding: 'utf8'});
const unstaged = spawnSync('git', ['diff'], {encoding: 'utf8'});
const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {encoding: 'utf8'}).stdout.split('\n').filter(Boolean);
const untrackedText = untracked.map((file) => {
  try { return statSync(file).size <= 1024 * 1024 ? readFileSync(file, 'utf8') : ''; } catch { return ''; }
}).join('\n');
const diff = `${staged.stdout || ''}\n${unstaged.stdout || ''}\n${untrackedText}`;
const secretShape = /(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|[A-Za-z0-9_]{8,}:AA[A-Za-z0-9_-]{20,})/;
const protectedCredentialCopy = /(^|\/)(github\.env|\.config\/blackspire\/github\.env)$/;
const tracked = spawnSync('git', ['ls-files'], {encoding: 'utf8'}).stdout.split('\n').filter(Boolean);

if (secretShape.test(diff)) {
  console.error('Potential secret detected');
  process.exit(1);
}
if (tracked.some((file) => protectedCredentialCopy.test(file))) {
  console.error('Protected credential path is tracked');
  process.exit(1);
}
console.log('No obvious secrets or protected credential files detected.');
