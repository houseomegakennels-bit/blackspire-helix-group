import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// The parent remains responsive even if trusted route code blocks its child VM.
// Child has no ambient credentials, stdin, inherited NODE_OPTIONS or extra FDs.
export function supervise(args, { timeoutMs = 15_000, maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zola-six-read-'));
    let cleaned = false;
    let child; let timer; let killTimer; let bytes = 0; let output = ''; let failure = null;
    const signalHandlers = new Map();
    const fail = (reason) => {
      if (failure) return;
      failure = new Error(reason);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      // Never wait indefinitely for pipe closure after terminating the process group.
      killTimer = setTimeout(() => { clean(); reject(failure); }, 1000);
    };
    const clean = () => {
      clearTimeout(timer); clearTimeout(killTimer);
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
      child?.stdout?.destroy(); child?.stderr?.destroy();
      if (!cleaned) {
        cleaned = true;
        try {
          for (const name of fs.readdirSync(root)) {
            if (!['command.sqlite', 'command.sqlite-wal', 'command.sqlite-shm'].includes(name)) throw new Error('unexpected disposable artifact');
            fs.unlinkSync(path.join(root, name));
          }
          fs.rmdirSync(root);
        } catch { failure = new Error('offline child cleanup failed'); }
      }
    };
    try {
      child = spawn(process.execPath, args, { env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', ZOLA_SIX_READ_DISPOSABLE_DIR: root }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { clean(); reject(new Error('offline child spawn failed')); return; }
    timer = setTimeout(() => fail('offline child deadline'), timeoutMs);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => fail('offline child interrupted');
      signalHandlers.set(signal, handler); process.on(signal, handler);
    }
    child.on('error', () => { clean(); reject(new Error('offline child spawn failed')); });
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { fail('offline child output bound'); return; }
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail('offline child output bound');
    });
    child.on('close', (code) => {
      clean();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('offline child failed'));
      else resolve(output);
    });
  });
}
