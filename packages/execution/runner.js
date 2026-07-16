import { spawn } from 'node:child_process';
import path from 'node:path';
import { redact } from '../shared/util.js';

export function assertInsideWorkspace(relativePath, workspaceRoot) {
  const root = path.resolve(workspaceRoot || '.');
  const target = path.resolve(root, relativePath || '.');
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes workspace: ${relativePath}`);
  return target;
}

export function runAllowed(command, { cwd = '.', allowedCommands = [], timeoutMs = 30000, maxOutput = 12000 } = {}) {
  if (!allowedCommands.includes(command)) return Promise.resolve({ ok: false, code: null, command, cwd, stdout: '', stderr: 'Command is not allowlisted', durationMs: 0 });
  const root = assertInsideWorkspace('.', cwd);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: root, shell: true, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV || 'test' } });
    let stdout = '';
    let stderr = '';
    const cap = (value) => value.slice(0, maxOutput);
    child.stdout.on('data', (data) => { stdout = cap(stdout + data); });
    child.stderr.on('data', (data) => { stderr = cap(stderr + data); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, code: null, command, cwd: root, stdout: redact(stdout), stderr: redact(`${stderr}\nTimed out`), durationMs: Date.now() - started });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, command, cwd: root, stdout: redact(stdout), stderr: redact(stderr), durationMs: Date.now() - started });
    });
  });
}
