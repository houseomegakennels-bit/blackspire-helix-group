import { readFileSync, writeFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
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
export async function runCanary({ plan, token, fetchImpl = fetch, record, now = () => Date.now(), cleanupOnly = false }) {
  requireThat(typeof token === 'string' && token.length >= 16 && typeof record === 'function', 'MISSING_PROTECTED_INPUT');
  requireThat(plan?.projectId === PROJECT && plan.teamId === TEAM, 'PLAN_PROJECT');
  requireThat(/^[a-f0-9]{32}$/.test(plan.nonce) && plan.path === `/zola-routing-canary-${plan.nonce}` && Array.isArray(plan.hosts) && plan.hosts.length <= 2000 && plan.hosts.length > 0 && plan.hosts.every(hostname), 'INVALID_PLAN');
  const expected = { route: { name: `ZOLA routing canary ${plan.nonce}`, enabled: true, srcSyntax: 'regex', route: { src: `^${plan.path}$`, status: 418, headers: { 'x-zola-routing-canary': plan.nonce, 'cache-control': 'no-store' } } }, position: { placement: 'start' } };
  requireThat(JSON.stringify(plan.add) === JSON.stringify(expected), 'PLAN_SCOPE_MISMATCH');
  const evidence = { schema: 1, sha: plan.sha, path: plan.path, status: 'INCOMPLETE', restored: false, applicationDenialProven: false, probes: [] };
  const started = now();
  let routeId, stagedVersion, mutationAttempted = false, recoveredPrior = false;
  async function api(method, suffix = '', body) {
    requireThat(now() - started < 900000, 'DEADLINE');
    const url = new URL(`/v1/projects/${PROJECT}/routes${suffix}`, 'https://api.vercel.com'); url.searchParams.set('teamId', TEAM);
    if (method !== 'GET') { mutationAttempted = true; record({ event: 'mutation_intent', method, suffix, body }); }
    const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    requireThat(response.ok, `MANAGEMENT_HTTP_${response.status}`);
    let bytes = 0; const chunks = [];
    for await (const chunk of response.body) { bytes += chunk.byteLength; requireThat(bytes <= 1048576, 'MANAGEMENT_RESPONSE_LIMIT'); chunks.push(Buffer.from(chunk)); }
    let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CanaryError('MANAGEMENT_JSON'); }
    if (method !== 'GET') record({ event: 'mutation_response', method, suffix, versionId: identifier(data.version?.id) ? data.version.id : null });
    return data;
  }
  const version = (data, kind) => { requireThat(identifier(data.version?.id) && data.version[kind] === true, 'VERSION_SCHEMA'); return data.version.id; };
  async function state(phase, versionId) {
    const data = await api('GET');
    requireThat(Array.isArray(data.routes) && data.pagination == null, 'ROUTING_SCHEMA');
    if (phase === 'empty') requireThat(data.routes.length === 0 && (data.version === null || (data.version?.isLive === true && data.version?.isStaging === false)), 'BASELINE_NOT_EMPTY');
    else {
      requireThat(data.routes.length === 1 && data.version?.id === versionId, 'ROUTING_DRIFT');
      const row = data.routes[0];
      requireThat(row.id === routeId && row.enabled === true && row.name === expected.route.name && canonical(row.route) === canonical(expected.route.route), 'CANARY_DRIFT');
    }
    return data;
  }
  async function probe(host, phase) {
    const began = now();
    try {
      requireThat(now() - started < (phase === 'after' ? 880000 : 600000), 'PROBE_DEADLINE');
      const response = await fetchImpl(new URL(`https://${host}${plan.path}`), { method: 'GET', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(8000), headers: { 'Cache-Control': 'no-cache' } });
      await response.body?.cancel();
      const marker = response.headers.get('x-zola-routing-canary') === plan.nonce;
      const row = { host, phase, status: response.status, marker, latencyMs: now() - began };
      evidence.probes.push(row); record({ event: 'probe', ...row });
      return phase === 'active' ? response.status === 418 && marker : !marker && response.status !== 418;
    } catch { const row = { host, phase, status: null, marker: false, code: 'PROBE_FAILED' }; evidence.probes.push(row); record({ event: 'probe', ...row }); return false; }
  }
  async function noForeignStaging(expectedStage) {
    const data = await api('GET', '/versions');
    requireThat(Array.isArray(data.versions) && data.pagination == null && data.versions.length <= 10000, 'HISTORY_SCHEMA');
    const stages = data.versions.filter((row) => row.isStaging === true);
    requireThat(stages.length === (expectedStage ? 1 : 0) && stages.every((row) => row.id === expectedStage), 'EXISTING_STAGING');
  }
  async function probeAll(phase) {
    const results = new Array(plan.hosts.length); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(8, plan.hosts.length) }, async () => {
      while (cursor < plan.hosts.length) { const index = cursor++; results[index] = await probe(plan.hosts[index], phase); }
    }));
    return results.every(Boolean);
  }
  try {
    if (cleanupOnly) { mutationAttempted = true; throw new CanaryError('CLEANUP_ONLY'); }
    const entry = await api('GET');
    if (entry.routes?.length === 1 && identifier(entry.routes[0].id) && identifier(entry.version?.id) && entry.routes[0].enabled === true && entry.routes[0].name === expected.route.name && canonical(entry.routes[0].route) === canonical(expected.route.route)) {
      routeId = entry.routes[0].id; stagedVersion = entry.version.id; mutationAttempted = true; recoveredPrior = true;
      record({ event: 'prior_canary_found', routeId, versionId: stagedVersion });
      throw new CanaryError('PRIOR_CANARY_REQUIRES_CLEANUP');
    }
    const baseline = await state('empty');
    await noForeignStaging();
    record({ event: 'baseline', routes: [], versionId: baseline.version?.id ?? null });
    // A baseline 404 is only collision evidence. It never counts as containment.
    requireThat(await probeAll('before'), 'BASELINE_PROBE_FAILED');
    const current = await state('empty');
    requireThat(current.version?.id === baseline.version?.id, 'BASELINE_VERSION_DRIFT');
    await noForeignStaging();
    const added = await api('POST', '', expected);
    requireThat(identifier(added.route?.id), 'ROUTE_ID_SCHEMA'); routeId = added.route.id;
    stagedVersion = version(added, 'isStaging'); record({ event: 'canary_staged', routeId, versionId: stagedVersion });
    await state('canary', stagedVersion);
    await noForeignStaging(stagedVersion);
    await api('POST', '/versions', { id: stagedVersion, action: 'promote' });
    const live = await state('canary', stagedVersion); requireThat(live.version.isLive === true, 'NOT_LIVE');
    evidence.coveragePass = await probeAll('active');
  } catch (error) { evidence.code = error instanceof CanaryError ? error.message : 'REQUEST_FAILED'; }
  // This is a best-effort safe cleanup, never an overwrite of someone else's work.
  try {
    if (mutationAttempted) {
      // Reconcile both lost add and lost promote without repeating either request.
      const actual = await api('GET');
      requireThat(actual.routes?.length === 1 && identifier(actual.routes[0].id) && identifier(actual.version?.id), 'CLEANUP_STATE_UNKNOWN');
      requireThat(routeId == null || routeId === actual.routes[0].id, 'CLEANUP_ROUTE_CHANGED');
      requireThat(stagedVersion == null || stagedVersion === actual.version.id, 'CLEANUP_VERSION_CHANGED');
      routeId = actual.routes[0].id; stagedVersion = actual.version.id;
      const current = await state('canary', stagedVersion);
      const live = current.version.isLive === true && current.version.isStaging === false;
      const staged = current.version.isStaging === true && current.version.isLive !== true;
      requireThat(live || staged, 'CLEANUP_STATE_UNKNOWN');
      await noForeignStaging(staged ? stagedVersion : undefined);
      if (staged) await api('POST', '/versions', { id: stagedVersion, action: 'discard' });
      else {
        const removed = await api('DELETE', '', { routeIds: [routeId] });
        const cleanupVersion = version(removed, 'isStaging');
        const empty = await api('GET'); requireThat(empty.routes?.length === 0 && empty.version?.id === cleanupVersion, 'CLEANUP_DRIFT');
        await noForeignStaging(cleanupVersion);
        await api('POST', '/versions', { id: cleanupVersion, action: 'promote' });
      }
      await state('empty');
      evidence.restored = await probeAll('after');
    }
  } catch (error) { evidence.cleanupCode = error instanceof CanaryError ? error.message : 'CLEANUP_REQUEST_FAILED'; }
  evidence.status = recoveredPrior && evidence.restored ? 'RECOVERED_PRIOR_CANARY' : cleanupOnly && evidence.restored ? 'CANARY_RESTORED' : evidence.coveragePass && evidence.restored && !evidence.code ? 'CANARY_COVERAGE_PASS' : 'INCOMPLETE';
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
      const result = await runCanary({ plan, cleanupOnly: process.env.ZOLA_CANARY_ACTION === 'cleanup-exclusive-reviewed-canary', token: process.env.VERCEL_TOKEN, record: (event) => { writeSync(journal, `${JSON.stringify(event)}\n`); fsyncSync(journal); } });
      writeFileSync('zola-routing-canary-evidence/result.json', `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ status: result.status, restored: result.restored, applicationDenialProven: false }));
      if (!['CANARY_COVERAGE_PASS', 'CANARY_RESTORED'].includes(result.status)) process.exitCode = 1;
    } finally { closeSync(journal); }
  } catch (error) { console.error(JSON.stringify({ status: 'INCOMPLETE', code: error instanceof CanaryError ? error.message : 'INPUT_OR_IO_FAILED' })); process.exitCode = 1; }
}
