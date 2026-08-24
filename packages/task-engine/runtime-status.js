import { getFlag, setFlag } from './tasks.js';

const WORKER_KEY_PREFIX = 'runtime.worker.';

function safeWorkerId(value) {
  const workerId = String(value || 'worker-local');
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(workerId)) throw new Error('invalid worker id');
  return workerId;
}

function safeGenerationId(value) {
  const generationId = String(value || '');
  return /^[a-f0-9]{32}$/.test(generationId) ? generationId : null;
}

export function recordWorkerHeartbeat({ workerId, phase, taskId = null, startedAt, generationId = process.env.INVOCATION_ID, now = new Date() }) {
  const id = safeWorkerId(workerId);
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const record = {
    version: 2,
    phase,
    heartbeatAt: timestamp,
    startedAt: startedAt || timestamp,
    generationId: safeGenerationId(generationId),
    activeTask: Boolean(taskId),
  };
  setFlag(`${WORKER_KEY_PREFIX}${id}`, JSON.stringify(record));
  return record;
}

export function workerRuntimeStatus({
  workerId = process.env.WORKER_ID || 'worker-local',
  required = process.env.BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT === 'true',
  staleAfterMs = Number(process.env.WORKER_HEARTBEAT_STALE_MS || 30_000),
  now = Date.now(),
} = {}) {
  const id = safeWorkerId(workerId);
  let record;
  try { record = JSON.parse(getFlag(`${WORKER_KEY_PREFIX}${id}`) || 'null'); }
  catch { record = null; }
  const heartbeatMs = Date.parse(record?.heartbeatAt || '');
  const ageMs = Number.isFinite(heartbeatMs) ? Math.max(0, now - heartbeatMs) : null;
  const threshold = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : 30_000;
  const runningPhase = ['starting', 'idle', 'working', 'draining'].includes(record?.phase);
  const fresh = ageMs !== null && ageMs <= threshold;
  const state = !record ? 'missing' : !runningPhase ? record.phase === 'stopped' ? 'stopped' : 'unhealthy' : fresh ? record.phase : 'stale';
  return {
    required: Boolean(required),
    ok: !required || (fresh && runningPhase && record.phase !== 'draining'),
    state,
    heartbeatAgeMs: ageMs,
    activeTask: Boolean(record?.activeTask),
    restartDetected: Boolean(record && record.phase !== 'stopped' && !fresh),
    generationId: safeGenerationId(record?.generationId),
  };
}

export function schedulerRuntimeStatus() {
  return { required: false, ok: true, state: 'disabled' };
}
