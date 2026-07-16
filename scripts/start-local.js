import { spawn } from 'node:child_process';
import './migrate.js';

const services = [
  ['api', ['apps/api/server.js']],
  ['worker', ['apps/worker/worker.js']],
  ['telegram', ['apps/telegram/bot.js']],
];

for (const [name, args] of services) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => console.log(JSON.stringify({ service: name, exited: code })));
}

console.log(JSON.stringify({ service: 'local', mode: 'api+worker+telegram', jarvis: process.env.PUBLIC_BASE_URL || 'http://localhost:8787/jarvis' }));
