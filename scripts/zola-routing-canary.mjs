import { readFileSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const RECOVERY = '2c0b600c268faa0571f08322e16d7f81f37789be';
class CanaryError extends Error {}
const requireThat = (value, code) => { if (!value) throw new CanaryError(code); };
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hostname = (value) => typeof value === 'string' && value.length <= 253 && value.split('.').length >= 2 && value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));

// A random canary is never an application intake and is not an auth bypass token.
export function prepareCanary({ inventory, sha, nonce }) {
  requireThat(/^[a-f0-9]{40}$/.test(sha) && /^[a-f0-9]{32}$/.test(nonce), 'INVALID_BINDING');
  requireThat(inventory?.projectId === PROJECT && inventory.teamId === TEAM, 'INVENTORY_PROJECT');
  for (const name of ['deployments', 'domains', 'aliases']) {
    const item = inventory.observations?.find((row) => row.name === name);
    requireThat(item?.status === 'COMPLETE' && item.value?.paginationComplete === true, 'INVENTORY_INCOMPLETE');
  }
  requireThat(inventory.deployments.some((row) => row.sha === sha && row.state === 'READY') && inventory.deployments.some((row) => row.sha === RECOVERY && row.state === 'READY'), 'RELEASE_RECOVERY_MISSING');
  const hosts = [...new Set([...inventory.deployments.filter((row) => row.state === 'READY').map((row) => row.url), ...inventory.domains.map((row) => row.name), ...inventory.aliases.map((row) => row.alias)])].sort();
  requireThat(hosts.length > 0 && hosts.length <= 2000 && hosts.every(hostname), 'INVALID_HOST_INVENTORY');
  const path = `/zola-routing-canary-${nonce}`;
  return { schema: 1, sha, nonce, path, hosts, excludedDeployments: inventory.deployments.filter((row) => row.state !== 'READY').map((row) => ({ id: row.id, state: row.state })), projectId: PROJECT, teamId: TEAM,
    add: { route: { name: `ZOLA routing canary ${nonce}`, enabled: true, srcSyntax: 'regex',
      route: { src: `^${path}$`, status: 418, headers: { 'x-zola-routing-canary': nonce, 'cache-control': 'no-store' } } }, position: { placement: 'start' } },
    applicationDenialProven: false };
}

// No retry of any management mutation. Each intent is durably retained first.
// Exclusive routing maintenance is still required: Vercel exposes no CAS here.
export async function runCanary({ plan, token, fetchImpl = fetch, record, now = () => Date.now(), cleanupOnly = false, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  requireThat(typeof token === 'string' && token.length >= 16 && typeof record === 'function', 'MISSING_PROTECTED_INPUT');
  requireThat(plan?.projectId === PROJECT && plan.teamId === TEAM, 'PLAN_PROJECT');
  requireThat(/^[a-f0-9]{40}$/.test(plan.sha) && /^[a-f0-9]{32}$/.test(plan.nonce) && plan.path === `/zola-routing-canary-${plan.nonce}` && Array.isArray(plan.hosts) && plan.hosts.length <= 2000 && plan.hosts.length > 0 && plan.hosts.every(hostname), 'INVALID_PLAN');
  const expected = { route: { name: `ZOLA routing canary ${plan.nonce}`, enabled: true, srcSyntax: 'regex', route: { src: `^${plan.path}$`, status: 418, headers: { 'x-zola-routing-canary': plan.nonce, 'cache-control': 'no-store' } } }, position: { placement: 'start' } };
  requireThat(canonical(plan.add) === canonical(expected), 'PLAN_SCOPE_MISMATCH');
  const evidence = { schema: 2, sha: plan.sha, path: plan.path, status: 'INCOMPLETE', restored: false, applicationDenialProven: false, probes: [] };
  const started = now(); let requests = 0, routeId, canaryVersion, mutationAttempted = false, recoveredPrior = false;
  const attempted = new Set();
  async function api(method, suffix = '', body, versionId) {
    requireThat(now() - started < 900000 && ++requests <= 160, 'MANAGEMENT_BOUND');
    const url = new URL(`/v1/projects/${PROJECT}/routes${suffix}`, 'https://api.vercel.com'); url.searchParams.set('teamId', TEAM);
    if (versionId) url.searchParams.set('versionId', versionId);
    if (method !== 'GET') {
      const operation = canonical({ method, suffix, body }); requireThat(!attempted.has(operation), 'MUTATION_ALREADY_ATTEMPTED');
      // A record failure prevents the request. The CLI fsyncs each record.
      record({ event: 'mutation_intent', method, suffix, body }); attempted.add(operation); mutationAttempted = true;
    }
    const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (method === 'GET' && versionId && response.status === 404) { await response.body?.cancel(); return { notFound: true }; }
    requireThat(response.ok, `MANAGEMENT_HTTP_${response.status}`);
    if (method !== 'GET') { await response.body?.cancel(); record({ event: 'mutation_response', method, suffix, status: response.status }); return; }
    let bytes = 0; const chunks = [];
    for await (const chunk of response.body) { bytes += chunk.byteLength; requireThat(bytes <= 1048576, 'MANAGEMENT_RESPONSE_LIMIT'); chunks.push(Buffer.from(chunk)); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CanaryError('MANAGEMENT_JSON'); }
  }
  function flags(version) {
    requireThat(identifier(version?.id), 'VERSION_ID');
    for (const key of ['isLive', 'isStaging']) requireThat(version[key] === undefined || typeof version[key] === 'boolean', 'VERSION_FLAG');
    requireThat(!(version.isLive === true && version.isStaging === true), 'CONTRADICTORY_VERSION');
    requireThat(version.ruleCount === undefined || Number.isSafeInteger(version.ruleCount) && version.ruleCount >= 0, 'VERSION_COUNT');
  }
  function content(data, metadata) {
    requireThat(Array.isArray(data?.routes) && data.routes.length <= 1 && data.pagination == null, 'ROUTING_SCHEMA');
    if (!metadata) { requireThat(data.version === null && data.routes.length === 0, 'UNPROVEN_EMPTY'); return; }
    flags(data.version); requireThat(data.version.id === metadata.id, 'VERSION_CONTENT_MISMATCH');
    for (const key of ['isLive', 'isStaging']) requireThat(data.version[key] === undefined || data.version[key] === (metadata[key] === true), 'CONTENT_FLAG_MISMATCH');
    requireThat((metadata.ruleCount === undefined || metadata.ruleCount === data.routes.length) && (data.version.ruleCount === undefined || data.version.ruleCount === data.routes.length) && (data.limit?.currentRoutes === undefined || data.limit.currentRoutes === data.routes.length), 'ROUTE_COUNT');
  }
  function exactCanary(data) {
    requireThat(data.routes.length === 1, 'CANARY_MISSING'); const row = data.routes[0];
    requireThat(identifier(row.id) && (routeId === undefined || routeId === row.id) && row.enabled === true && row.name === expected.route.name && canonical(row.route) === canonical(expected.route.route), 'CANARY_DRIFT');
    return row.id;
  }
  async function observe() {
    const current = await api('GET'), history = await api('GET', '/versions');
    requireThat(Array.isArray(history?.versions) && history.pagination == null && history.versions.length <= 10000, 'HISTORY_SCHEMA');
    for (const item of history.versions) flags(item);
    requireThat(new Set(history.versions.map(item => item.id)).size === history.versions.length, 'DUPLICATE_VERSION');
    const stages = history.versions.filter(item => item.isStaging === true), lives = history.versions.filter(item => item.isLive === true);
    requireThat(stages.length <= 1 && lives.length <= 1, 'AMBIGUOUS_ROUTING');
    const selected = stages[0] ?? lives[0];
    // No active metadata means only an entirely empty history is authoritative.
    requireThat(selected || history.versions.length === 0, 'ACTIVE_VERSION_UNPROVEN');
    content(current, selected);
    let explicit = current, live = null;
    if (selected) { explicit = await api('GET', '', undefined, selected.id); content(explicit, selected); requireThat(canonical(explicit.routes) === canonical(current.routes), 'CURRENT_VERSION_DRIFT'); }
    if (lives[0]) { live = lives[0].id === selected.id ? explicit : await api('GET', '', undefined, lives[0].id); content(live, lives[0]); }
    record({ event: 'routing_observation', currentVersionId: selected?.id ?? null, currentCount: current.routes.length, stageId: stages[0]?.id ?? null, liveId: lives[0]?.id ?? null, liveCount: live?.routes.length ?? null, historyCount: history.versions.length });
    return { current, history, stage: stages[0] ?? null, liveMeta: lives[0] ?? null, live };
  }
  async function stable(check) {
    const first = await observe(); check(first); const second = await observe(); check(second);
    requireThat(canonical(first) === canonical(second), 'ROUTING_DRIFT'); return second;
  }
  const empty = state => { requireThat(!state.stage && state.current.routes.length === 0 && (!state.live || state.live.routes.length === 0), 'BASELINE_NOT_EMPTY'); };
  const stagedCanary = state => {
    requireThat(state.stage && (!canaryVersion || state.stage.id === canaryVersion) && (!state.live || state.live.routes.length === 0), 'FOREIGN_STAGING'); exactCanary(state.current);
  };
  const liveCanary = state => { requireThat(!state.stage && state.liveMeta && (!canaryVersion || state.liveMeta.id === canaryVersion), 'CANARY_NOT_LIVE'); exactCanary(state.current); };
  const emptyStage = state => { requireThat(state.stage && state.current.routes.length === 0 && state.liveMeta?.id === canaryVersion, 'EMPTY_STAGE_UNPROVEN'); exactCanary(state.live); };
  async function settle(check) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await stable(check); } catch (error) { last = error; record({ event: 'readonly_reconciliation_pending', attempt: attempt + 1 }); }
      if (attempt < 2) await pause(1000);
    }
    throw last;
  }
  async function mutation(method, suffix, body) {
    try { await api(method, suffix, body); }
    catch (error) { record({ event: 'mutation_response_unknown', method, suffix }); throw error; }
  }
  async function probe(host, phase) {
    const began = now();
    try {
      requireThat(now() - started < (phase === 'after' ? 880000 : 600000), 'PROBE_DEADLINE');
      const response = await fetchImpl(new URL(`https://${host}${plan.path}`), { method: 'GET', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(8000), headers: { 'Cache-Control': 'no-cache' } });
      await response.body?.cancel(); const marker = response.headers.get('x-zola-routing-canary') === plan.nonce;
      const row = { host, phase, status: response.status, marker, latencyMs: now() - began }; evidence.probes.push(row); record({ event: 'probe', ...row });
      return phase === 'active' ? response.status === 418 && marker : !marker && response.status !== 418;
    } catch { const row = { host, phase, status: null, marker: false, code: 'PROBE_FAILED' }; evidence.probes.push(row); record({ event: 'probe', ...row }); return false; }
  }
  async function probeAll(phase) {
    const results = new Array(plan.hosts.length); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, plan.hosts.length) }, async () => { while (cursor < plan.hosts.length) { const index = cursor++; results[index] = await probe(plan.hosts[index], phase); } }));
    return results.every(Boolean);
  }
  try {
    const entry = await observe();
    if (entry.current.routes.length === 1 || entry.stage && entry.live?.routes.length === 1) {
      const data = entry.current.routes.length === 1 ? entry.current : entry.live;
      routeId = exactCanary(data); canaryVersion = data.version.id; recoveredPrior = true; mutationAttempted = true;
      record({ event: 'prior_canary_found', routeId, versionId: canaryVersion }); throw new CanaryError('PRIOR_CANARY_REQUIRES_CLEANUP');
    }
    if (cleanupOnly) { empty(entry); throw new CanaryError('CLEANUP_ALREADY_EMPTY_UNBOUND'); }
    requireThat(entry.history.versions.length === 0, 'EXPERIMENT_REPLAY_OR_EXISTING_HISTORY');
    const freshBaseline = state => { empty(state); requireThat(state.history.versions.length === 0, 'EXPERIMENT_REPLAY_OR_EXISTING_HISTORY'); };
    await stable(freshBaseline);
    requireThat(await probeAll('before'), 'BASELINE_PROBE_FAILED');
    await stable(freshBaseline);
    await mutation('POST', '', expected);
    const staged = await settle(stagedCanary); routeId = exactCanary(staged.current); canaryVersion = staged.stage.id;
    record({ event: 'canary_staged', routeId, versionId: canaryVersion });
    await stable(stagedCanary); await mutation('POST', '/versions', { id: canaryVersion, action: 'promote' });
    await settle(liveCanary); evidence.coveragePass = await probeAll('active');
  } catch (error) { evidence.code = error instanceof CanaryError ? error.message : 'REQUEST_FAILED'; }
  try {
    if (mutationAttempted) {
      // Reconcile observed effects, including lost add/delete/promote ACKs. Never
      // repeat a mutation; only advance cleanup from freshly proven exact state.
      let actual = await settle(state => {
        if (!state.stage && state.current.routes.length === 0) { empty(state); return; }
        const data = state.current.routes.length === 1 ? state.current : state.live;
        requireThat(data, 'CLEANUP_STATE_UNKNOWN'); exactCanary(data);
        requireThat(!canaryVersion || data.version.id === canaryVersion, 'CLEANUP_VERSION_CHANGED');
      });
      if (!actual.stage && actual.current.routes.length === 0) {
        requireThat(canaryVersion, 'CLEANUP_IDENTITY_UNKNOWN');
        // An absent known stage additionally requires its explicit 404 and no
        // history reference. Empty default metadata alone is never sufficient.
        if (canaryVersion) { requireThat(!actual.history.versions.some(item => item.id === canaryVersion), 'CANARY_STILL_RETAINED'); requireThat((await api('GET', '', undefined, canaryVersion)).notFound, 'CANARY_STILL_PRESENT'); }
      } else {
        const data = actual.current.routes.length === 1 ? actual.current : actual.live;
        routeId = exactCanary(data); canaryVersion = data.version.id;
        if (actual.stage && actual.current.routes.length === 1) {
          await stable(stagedCanary);
          try { await mutation('POST', '/versions', { id: canaryVersion, action: 'discard' }); } catch { /* GET-only reconciliation below */ }
          actual = await settle(empty);
          requireThat(!actual.history.versions.some(item => item.id === canaryVersion) && (await api('GET', '', undefined, canaryVersion)).notFound, 'DISCARD_NOT_CONFIRMED');
        } else {
          if (!actual.stage) {
            await stable(liveCanary);
            try { await mutation('DELETE', '', { routeIds: [routeId] }); } catch { /* reconcile, never repeat DELETE */ }
          }
          actual = await settle(emptyStage); const cleanupVersion = actual.stage.id;
          await stable(state => { emptyStage(state); requireThat(state.stage.id === cleanupVersion, 'CLEANUP_VERSION_CHANGED'); });
          try { await mutation('POST', '/versions', { id: cleanupVersion, action: 'promote' }); } catch { /* reconcile, never repeat promotion */ }
          await settle(state => { empty(state); requireThat(state.liveMeta?.id === cleanupVersion, 'CLEANUP_NOT_LIVE'); });
        }
      }
      evidence.restored = await probeAll('after');
    }
  } catch (error) { evidence.cleanupCode = error instanceof CanaryError ? error.message : 'CLEANUP_REQUEST_FAILED'; }
  evidence.status = cleanupOnly && evidence.restored ? 'CANARY_RESTORED' : recoveredPrior && evidence.restored ? 'RECOVERED_PRIOR_CANARY' : evidence.coveragePass && evidence.restored && !evidence.code ? 'CANARY_COVERAGE_PASS' : 'INCOMPLETE';
  record({ event: 'complete', ...evidence }); return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    requireThat(process.env.ZOLA_CANARY_EXPECTED_SHA === sha && process.env.GITHUB_SHA === sha && process.env.GITHUB_REF === 'refs/heads/release/zola-production-live', 'HEAD_MISMATCH');
    requireThat(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() === '', 'DIRTY_TREE');
    const plan = prepareCanary({ inventory: JSON.parse(readFileSync('zola-vercel-protection-inventory.json', 'utf8')), sha, nonce: process.env.ZOLA_CANARY_NONCE });
    mkdirSync('zola-routing-canary-evidence', { mode: 0o700 });
    writeFileSync('zola-routing-canary-evidence/plan.json', `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    requireThat(['run-exclusive-reviewed-canary', 'cleanup-exclusive-reviewed-canary'].includes(process.env.ZOLA_CANARY_ACTION), 'MUTATION_NOT_AUTHORIZED');
    const journal = openSync('zola-routing-canary-evidence/journal.jsonl', 'wx', 0o600);
    try {
      for (const directory of ['zola-routing-canary-evidence', '.']) {
        const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { fsyncSync(fd); } finally { closeSync(fd); }
      }
      const result = await runCanary({ plan, cleanupOnly: process.env.ZOLA_CANARY_ACTION === 'cleanup-exclusive-reviewed-canary', token: process.env.VERCEL_TOKEN, record: (event) => { writeFileSync(journal, `${JSON.stringify(event)}\n`); fsyncSync(journal); } });
      writeFileSync('zola-routing-canary-evidence/result.json', `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ status: result.status, restored: result.restored, applicationDenialProven: false }));
      if (!['CANARY_COVERAGE_PASS', 'CANARY_RESTORED'].includes(result.status)) process.exitCode = 1;
    } finally { closeSync(journal); }
  } catch (error) { console.error(JSON.stringify({ status: 'INCOMPLETE', code: error instanceof CanaryError ? error.message : 'INPUT_OR_IO_FAILED' })); process.exitCode = 1; }
}
