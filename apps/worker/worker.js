import { claimNext, getFlag } from '../../packages/task-engine/tasks.js';
import { processTask } from '../../packages/hermes/hermes.js';

export function startWorker({ intervalMs = Number(process.env.WORKER_POLL_MS || 750), once = false } = {}) {
  let running = false;
  async function tick() {
    if (running || getFlag('emergency_stop') === 'active') return;
    const task = claimNext({ workerId: process.env.WORKER_ID || 'worker-local' });
    if (!task) return;
    running = true;
    try {
      await processTask(task);
    } finally {
      running = false;
    }
  }
  if (once) return tick();
  const timer = setInterval(tick, intervalMs);
  console.log(JSON.stringify({ service: 'worker', intervalMs }));
  return { stop: () => clearInterval(timer), tick };
}

if (import.meta.url === `file://${process.argv[1]}`) startWorker();
