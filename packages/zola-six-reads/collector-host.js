import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createBuyerWriterRuntimeInspector, readBuyerWriterProcess } from '../buyer-writer/runtime-inspection.js';
import { readRootOwnedJson } from '../buyer-writer/protected-json.js';
import { createProductionDatabaseObserver } from './database-host.js';
import { digest, refuse } from './collector.js';

// Called in production by root; tests may use a private directory owned by the
// current test uid. Production CLI fixes owner=0 and rejects writable ancestors.
export function openCollectorJournal(directory, runId, { owner = 0 } = {}) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runId) || !path.isAbsolute(directory) || path.resolve(directory) !== directory) refuse('JOURNAL_PATH_REJECTED');
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== owner || (stat.mode & 0o777) !== 0o700) refuse('JOURNAL_DIRECTORY_REJECTED');
  if (owner === 0) {
    let ancestor = directory;
    while (ancestor !== '/') {
      const s = fs.lstatSync(ancestor);
      if (s.uid !== 0 || s.isSymbolicLink() || (s.mode & 0o022)) refuse('JOURNAL_ANCESTOR_REJECTED');
      ancestor = path.dirname(ancestor);
    }
  }
  const filename = path.join(directory, `${runId}.jsonl`), lock = path.join(directory, `${runId}.lock`);
  // A crash leaves the lock in place. Never delete it automatically: an operator
  // must establish no collector is still running before removing only this lock.
  const lockFd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  let fd, closed = false;
  try {
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startTime: fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8').split(')').at(-1).trim().split(/\s+/)[19] }));
    fs.fsyncSync(lockFd);
    fd = fs.openSync(filename, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.uid !== owner || s.nlink !== 1 || (s.mode & 0o7777) !== 0o600 || s.size > 1024 * 1024) refuse('JOURNAL_FILE_REJECTED');
    const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    const bytes = fs.readFileSync(fd, 'utf8');
    if (bytes && !bytes.endsWith('\n')) refuse('JOURNAL_TORN_WRITE');
    const events = []; let last = '0'.repeat(64);
    for (const line of bytes.split('\n').filter(Boolean)) {
      const envelope = JSON.parse(line);
      if (envelope.sequence !== events.length || envelope.previous !== last || envelope.digest !== digest({ sequence: envelope.sequence, previous: last, event: envelope.event })) refuse('JOURNAL_INTEGRITY_FAILED');
      last = envelope.digest; events.push(envelope.event);
    }
    return {
      events: () => structuredClone(events),
      append(event) {
        if (closed || fs.fstatSync(fd).size > 1000000) refuse('JOURNAL_CLOSED_OR_FULL');
        const next = { sequence: events.length, previous: last, event };
        const hash = digest(next), line = `${JSON.stringify({ ...next, digest: hash })}\n`;
        // Append is synchronous and fsynced before the admission caller resumes.
        fs.writeFileSync(fd, line); fs.fsyncSync(fd); last = hash; events.push(structuredClone(event));
      },
      close() { if (!closed) { closed = true; fs.closeSync(fd); fs.closeSync(lockFd); fs.unlinkSync(lock); } },
    };
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd); fs.closeSync(lockFd);
    // Failed opening is not an uncertain admission; leave malformed journal intact.
    fs.unlinkSync(lock); throw error;
  }
}

export async function boundedRequest(config, pathname, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${config.port}${pathname}`, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000), redirect: 'error', cache: 'no-store' });
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') || response.redirected || !response.body) refuse('HTTP_RESPONSE_REJECTED');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 128 * 1024) refuse('HTTP_BODY_TOO_LARGE'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refuse('HTTP_JSON_REJECTED'); }
  return { status: response.status, data };
}
function assertListener(config) {
  const output = execFileSync('/usr/bin/ss', ['-H','-ltnp',`sport = :${config.port}`], { encoding: 'utf8', timeout: 1000, maxBuffer: 8192, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, stdio: ['ignore','pipe','pipe'] }).trim();
  const lines = output.split('\n'), pids = [...output.matchAll(/\bpid=(\d+),fd=/g)].map(m => Number(m[1]));
  if (lines.length !== 1 || lines[0].split(/\s+/)[3] !== `127.0.0.1:${config.port}` || pids.length !== 1 || pids[0] !== config.apiPid) refuse('API_SOCKET_OWNER_MISMATCH');
}
function assertProcessDatabase(pid, database) {
  const expected = fs.statSync(database);
  const match = fs.readdirSync(`/proc/${pid}/fd`).some(name => {
    try { const actual = fs.statSync(`/proc/${pid}/fd/${name}`); return actual.dev === expected.dev && actual.ino === expected.ino; } catch { return false; }
  });
  if (!match) refuse('RUNTIME_DATABASE_MISMATCH');
}
function processEnvironment(pid) {
  const bytes = fs.readFileSync(`/proc/${pid}/environ`);
  if (bytes.length > 256 * 1024) refuse('WORKER_ENVIRONMENT_REJECTED');
  // Secrets are never serialized, logged, or passed to a subprocess.
  return new Map(bytes.toString('utf8').split('\0').map(s => { const i = s.indexOf('='); return [s.slice(0,i), s.slice(i+1)]; }));
}
function assertWorkerFrontend(config) {
  const environment = processEnvironment(config.workerPid);
  for (const division of ['SELLER','BUYER','DEAL','NEXUS']) {
    const name = `BLACKSPIRE_${division}_CAPABILITY_URL`;
    const value = environment.get(name); let origin;
    try { origin = new URL(value).origin; } catch { refuse('WORKER_FRONTEND_UNCONFIGURED'); }
    if (origin !== config.frontendOrigin) refuse('WORKER_FRONTEND_PAIRING_MISMATCH');
  }
  const workerId = environment.get('WORKER_ID') || 'worker-local';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(workerId)) refuse('WORKER_ID_REJECTED');
  return workerId;
}
export function createProductionCollectorHost(config) {
  if (process.getuid() !== 0) refuse('ROOT_REQUIRED');
  const gitOptions = { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 2000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_NO_REPLACE_OBJECTS: '1' }, stdio: ['ignore','pipe','pipe'] };
  if (execFileSync('/usr/bin/git', ['rev-parse','--verify','HEAD'], gitOptions).trim() !== config.releaseSha ||
      execFileSync('/usr/bin/git', ['status','--porcelain=v1','--untracked-files=all'], gitOptions).trim()) refuse('COLLECTOR_SOURCE_SHA_OR_DIRTY_TREE');
  const credentials = readRootOwnedJson(config.credentialPath, { groupId: 0 });
  if (Object.keys(credentials).sort().join(',') !== 'bearer,deniedCookie' ||
      typeof credentials.bearer !== 'string' || credentials.bearer.length < 24 || credentials.bearer.length > 4096 || /[\r\n]/.test(credentials.bearer) ||
      typeof credentials.deniedCookie !== 'string' || credentials.deniedCookie.length < 10 || credentials.deniedCookie.length > 8192 || /[\r\n]/.test(credentials.deniedCookie)) refuse('CREDENTIAL_CONTRACT_REJECTED');
  const reader = openCollectorDatabaseReader(config);
  const inspect = createBuyerWriterRuntimeInspector({ apiPid: config.apiPid });
  return {
    async generation() {
      assertListener(config);
      const apiEnvironment = processEnvironment(config.apiPid);
      if ((apiEnvironment.get('BLACKSPIRE_OPERATOR_PRINCIPAL_ID') || apiEnvironment.get('BLACKSPIRE_EVALUATION_ADMIN_PRINCIPAL_ID')) !== config.principal ||
          apiEnvironment.get('COMMAND_ADMIN_TOKEN') !== credentials.bearer || apiEnvironment.get('ALLOW_BEARER_AUTH') !== 'true') refuse('API_PRINCIPAL_OR_CREDENTIAL_MISMATCH');
      const runtime = await inspect(); const worker = readBuyerWriterProcess(config.workerPid);
      if (worker.parentPid !== runtime.worker.pid || worker.controlGroup !== runtime.worker.controlGroup) refuse('WORKER_PROCESS_MISMATCH');
      reader.assertIdentity(); assertProcessDatabase(config.apiPid, config.databasePath); assertProcessDatabase(config.workerPid, config.databasePath); const workerId = assertWorkerFrontend(config);
      for (const endpoint of ['/health','/ready']) {
        const { status, data } = await boundedRequest(config, endpoint);
        if (status !== 200 || data.ok !== true || data.lifecycle !== 'ready' || data.deploymentIdentity?.state !== 'VERIFIED' ||
            data.deploymentIdentity.build?.value !== config.releaseSha || data.deploymentIdentity.environment?.value !== 'production' ||
            data.dependencies?.worker?.generationId !== runtime.worker.invocationId || data.dependencies.worker.ok !== true ||
            !['idle','working'].includes(data.dependencies.worker.state) || data.dependencies.worker.heartbeatAgeMs > 30000 ||
            (endpoint === '/health' && data.emergencyStop !== false)) refuse('RUNTIME_HEALTH_PAIRING_MISMATCH');
      }
      assertListener(config); const after = await inspect();
      if (JSON.stringify(runtime) !== JSON.stringify(after) || worker.startTime !== readBuyerWriterProcess(config.workerPid).startTime) refuse('RUNTIME_CHANGED_DURING_INSPECTION');
      return { apiGeneration: runtime.api.invocationId, apiPid: config.apiPid, apiStartTime: runtime.api.startTime,
        workerGeneration: runtime.worker.invocationId, workerId, workerPid: config.workerPid, workerStartTime: worker.startTime };
    },
    ...createCollectorHttpBoundary(config, credentials),
    ...(config.version === 2 ? { observeDatabase: createProductionDatabaseObserver(config) } : {}),
    lookup: key => reader.lookup(key),
    pause: () => new Promise(resolve => setTimeout(resolve, 500)),
    close: () => reader.close(),
  };
}

// Exact-key reconciliation opens only the existing authority DB in read-only mode.
export function openCollectorDatabaseReader(config) {
  const dbstat = fs.lstatSync(config.databasePath);
  if (!dbstat.isFile() || dbstat.isSymbolicLink() || path.resolve(config.databasePath) !== config.databasePath) refuse('DATABASE_PATH_REJECTED');
  const database = new DatabaseSync(config.databasePath, { readOnly: true });
  database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
  const assertIdentity = () => {
    const current = fs.lstatSync(config.databasePath);
    if (current.isSymbolicLink() || current.dev !== dbstat.dev || current.ino !== dbstat.ino) refuse('RECONCILIATION_DATABASE_REPLACED');
  };
  assertIdentity();
  return {
    assertIdentity,
    lookup(key) {
      assertIdentity();
      database.exec('BEGIN');
      try {
        const rows = database.prepare('SELECT * FROM tasks WHERE idempotency_key=? LIMIT 2').all(`unified:jarvis:${key}`);
        if (rows.length > 1) refuse('AMBIGUOUS_ADMISSION');
        if (!rows.length) return null;
        const task = rows[0];
        const input = database.prepare('SELECT actor_id,channel,text,idempotency_key FROM unified_inputs WHERE id=?').get(task.input_id);
        if (!input || input.actor_id !== config.principal || input.channel !== 'jarvis' || input.text !== task.request || input.idempotency_key !== key) refuse('INPUT_BINDING_MISMATCH');
        const attempts = database.prepare('SELECT * FROM provider_attempts WHERE task_id=? LIMIT 3').all(task.id);
        return { task, attempts };
      } finally { database.exec('ROLLBACK'); }
    },
    close: () => database.close(),
  };
}

// Shared by the protected production host and the isolated actual-API rehearsal.
// This boundary cannot establish host generation or deployment identity.
export function createCollectorHttpBoundary(config, credentials) {
  const bearer = { authorization: `Bearer ${credentials.bearer}` }, denied = { cookie: credentials.deniedCookie };
  return {
    async deniedIdentity() {
      const { status, data } = await boundedRequest(config, '/api/auth/session', { headers: denied });
      if (status !== 200 || data.authenticated !== true || data.principalId !== config.deniedPrincipal) refuse('DENIAL_PRINCIPAL_UNAVAILABLE');
    },
    async admit(body) {
      const { status, data } = await boundedRequest(config, '/api/unified-input', { method: 'POST', headers: bearer, body });
      if (status !== 202 || data.denied || data.error) refuse('ADMISSION_NOT_ACCEPTED');
      return data;
    },
    async disclosure(task) {
      await this.deniedIdentity();
      const url = `/api/tasks/${encodeURIComponent(task.id)}`;
      const own = await boundedRequest(config, url, { headers: bearer });
      if (own.status !== 200 || own.data.task?.id !== task.id || own.data.task?.evidence !== task.evidence || own.data.task?.status !== 'completed') refuse('TASK_HTTP_DISCLOSURE_MISMATCH');
      const foreign = await boundedRequest(config, url, { headers: denied });
      if (foreign.status !== 404 || JSON.stringify(foreign.data) !== '{"error":"not found"}') refuse('CROSS_PRINCIPAL_DENIAL_FAILED');
      await this.deniedIdentity();
    },
  };
}
