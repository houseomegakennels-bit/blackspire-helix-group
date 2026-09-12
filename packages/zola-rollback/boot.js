// Actual fixed-artifact process lifecycle, exclusively inside the rehearsal netns.
// This does not substitute for production launchers, owner policies or systemd.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { computeArtifactDigest } from '../shared/release-evidence.js';
import { RECOVERY_SHA, RECOVERY_ARTIFACT, RETIRED_PATHS } from './intake.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const apiEntry = `
import { start, beginGracefulShutdown } from './apps/api/server.js';
const server = start(0, '127.0.0.1');
server.once('listening', () => process.send({ port: server.address().port }));
let stopping = false;
process.on('SIGTERM', async () => {
  if (stopping) return; stopping = true;
  await beginGracefulShutdown(server, { deadlineMs: 500 });
  process.disconnect();
});
`;

export async function rehearseRecoveryBoot({ artifact, root, frontend = null, principalId = null, exercise = null }) {
  assert.equal(process.getuid(), 0);
  assert.match(process.env.ZOLA_CANDIDATE_PARENT_NET || '', /^net:\[\d+\]$/);
  assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.ZOLA_CANDIDATE_PARENT_NET);
  const ip = args => execFileSync('/usr/sbin/ip', args, { encoding: 'utf8', timeout: 2000,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
  assert.deepEqual(JSON.parse(ip(['-j', 'link', 'show'])).map(link => link.ifname), ['lo']);
  for (const family of ['-4', '-6']) assert.equal(ip([family, 'route', 'show', 'default']).trim(), '');
  assert.equal(artifact, `/var/lib/blackspire-zola-rehearsal/releases/${RECOVERY_SHA}`);
  assert.equal(computeArtifactDigest(artifact), RECOVERY_ARTIFACT);
  assert.equal(root, process.env.ZOLA_SIX_READ_DISPOSABLE_DIR);
  assert.equal(fs.realpathSync(root), root);
  const rootStat = fs.lstatSync(root);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink() && rootStat.uid === process.getuid());
  assert.equal(rootStat.mode & 0o777, 0o700);
  ip(['link', 'set', 'lo', 'up']);
  const env = { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', BLACKSPIRE_RUNTIME_MODE: 'test',
    BLACKSPIRE_DB_PATH: path.join(root, 'command.sqlite'), BLACKSPIRE_DATA_DIR: root,
    COMMAND_ADMIN_TOKEN: randomBytes(32).toString('base64url'),
    BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT: 'true', WORKER_ID: 'recovery-boot',
    WORKER_POLL_MS: '25', WORKER_HEARTBEAT_INTERVAL_MS: '25' };
  if (frontend) {
    assert.equal(typeof exercise, 'function');
    assert.match(principalId || '', /^[a-z][a-z0-9-]{1,63}$/);
    assert.match(frontend.origin, /^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/);
    assert.match(frontend.token, /^[a-f0-9]{64}$/);
    env.BLACKSPIRE_OPERATOR_PRINCIPAL_ID = principalId;
    for (const division of ['SELLER','BUYER','DEAL','NEXUS']) {
      env[`BLACKSPIRE_${division}_CAPABILITY_URL`] = frontend.origin;
      env[`BLACKSPIRE_${division}_CAPABILITY_TOKEN`] = frontend.token;
    }
  } else assert.equal(exercise, null);
  const apiGeneration = randomBytes(16).toString('hex');
  let integrated = null;
  const children = [];
  function launch(args, generation = null) {
    const processHandle = spawn(process.execPath, args, { cwd: artifact,
      env: { ...env, ...(generation ? { INVOCATION_ID: generation } : {}) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const child = { process: processHandle, closed: false, failure: false, code: null, port: null };
    children.push(child);
    let bytes = 0;
    for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 8192) { child.failure = true; processHandle.kill('SIGKILL'); }
    });
    processHandle.on('error', () => { child.failure = true; });
    processHandle.on('message', message => {
      if (Number.isInteger(message?.port) && message.port > 0 && message.port < 65536) child.port = message.port;
      else { child.failure = true; processHandle.kill('SIGKILL'); }
    });
    child.completion = new Promise(resolve => processHandle.once('close', (code, signal) => {
      child.closed = true; child.code = code; child.signal = signal; resolve();
    }));
    return child;
  }
  async function until(predicate) {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      assert.ok(!children.some(child => child.failure), 'recovery process failure');
      if (await predicate()) return;
      await pause();
    }
    throw new Error('recovery lifecycle deadline');
  }
  async function stop(child) {
    if (!child.closed) child.process.kill('SIGTERM');
    try { await until(() => child.closed); }
    finally {
      if (!child.closed) child.process.kill('SIGKILL');
      await child.completion;
    }
    assert.equal(child.code, 0);
  }
  try {
    const api = launch(['--input-type=module', '--eval', apiEntry], apiGeneration);
    await until(() => api.port !== null);
    const base = `http://127.0.0.1:${api.port}`;
    async function get(route) {
      assert.equal(api.closed, false);
      const response = await fetch(`${base}${route}`, { redirect: 'error', signal: AbortSignal.timeout(500) });
      return { status: response.status, body: await response.json() };
    }
    const health = await get('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.deploymentIdentity.build.value, RECOVERY_SHA);
    const missing = await get('/ready');
    assert.equal(missing.status, 503);
    assert.equal(missing.body.dependencies.worker.state, 'missing');
    const generations = [randomBytes(16).toString('hex'), randomBytes(16).toString('hex')];
    for (const generation of generations) {
      const worker = launch(['apps/worker/worker.js'], generation);
      await until(async () => {
        assert.equal(worker.closed, false);
        const ready = await get('/ready');
        return ready.status === 200 && ready.body.ok === true && ready.body.dependencies.worker.generationId === generation;
      });
      if (exercise && generation === generations[1]) {
        for (const [child, expectedGeneration] of [[api, apiGeneration], [worker, generation]]) {
          assert.equal(fs.realpathSync(`/proc/${child.process.pid}/cwd`), artifact);
          assert.equal(fs.realpathSync(`/proc/${child.process.pid}/exe`), fs.realpathSync(process.execPath));
          const actualEnvironment=fs.readFileSync(`/proc/${child.process.pid}/environ`, 'utf8').split('\0');
          assert.ok(actualEnvironment.includes(`INVOCATION_ID=${expectedGeneration}`), 'actual child generation mismatch');
        }
        integrated = await exercise({ base, token: env.COMMAND_ADMIN_TOKEN, apiGeneration, workerGeneration: generation,
          apiPid: api.process.pid, workerPid: worker.process.pid });
        assert.equal(api.closed, false); assert.equal(worker.closed, false);
        assert.equal((await get('/ready')).body.dependencies.worker.generationId, generation);
      }
      await stop(worker);
      const stopped = await get('/ready');
      assert.equal(stopped.status, 503);
      assert.equal(stopped.body.dependencies.worker.state, 'stopped');
      assert.equal(stopped.body.dependencies.worker.generationId, generation);
    }
    for (const route of RETIRED_PATHS) {
      for (const authorization of [null, 'Bearer invalid-recovery-token']) {
        const denied = await fetch(`${base}${route}`, { method: 'POST', redirect: 'error',
          headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: '{}', signal: AbortSignal.timeout(500) });
        assert.ok([401, 403, 404].includes(denied.status));
        await denied.arrayBuffer();
      }
    }
    await stop(api);
    assert.equal(computeArtifactDigest(artifact), RECOVERY_ARTIFACT);
    return { scope: 'fixed recovery processes on isolated loopback', recoverySha: RECOVERY_SHA,
      apiBoot: 'PASS', workerBoot: 'PASS', workerRestart: 'PASS', readinessLifecycle: 'PASS',
      stoppedWorkerReadinessDenied: true, heartbeatGenerationChangeObserved: true,
      anonymousPostDenials: RETIRED_PATHS.length, invalidTokenPostDenials: RETIRED_PATHS.length, gracefulProcessExit: 'PASS',
      ...(integrated ? { integrated } : {}),
      productionAccepted: false, generationAuthority: 'disposable process supervisor; not systemd',
      limitations: ['Test runtime configuration; production launchers and writer dependencies not exercised',
        'No recovery frontend included in sealed backend artifact', 'No production routing or owner-policy acceptance'] };
  } finally {
    for (const child of children) if (!child.closed) child.process.kill('SIGKILL');
    await Promise.all(children.map(child => child.completion));
  }
}
