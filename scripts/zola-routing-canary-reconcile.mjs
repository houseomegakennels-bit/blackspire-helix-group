import { mkdirSync, openSync, constants, fsyncSync, closeSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const VERSION = '2a1d0b0b-e755-4438-899e-0327dd69621e';
const NONCE = '64f900b8de032db89be7d8a682070094';
const EXPECTED = { src: `^/zola-routing-canary-${NONCE}$`, status: 418,
  headers: { 'x-zola-routing-canary': NONCE, 'cache-control': 'no-store' } };
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => createHash('sha256').update(canonical(value) ?? 'undefined').digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
class ReconcileError extends Error {}
const check = (condition, code) => { if (!condition) throw new ReconcileError(code); };

// This rescue operation is pinned to the sole unpromoted canary from CI
// 34190899875 attempt 2. Only GET and one exact version DISCARD are possible.
export async function reconcileKnownCanary({ token, discard = false, fetchImpl = fetch, record }) {
  check(typeof token === 'string' && token.length >= 16 && typeof record === 'function', 'PROTECTED_INPUT_REQUIRED');
  const result = { schema: 1, versionId: VERSION, status: 'INCOMPLETE', routingPublished: false, discardAttempted: false, applicationDenialProven: false };
  let requests = 0;
  async function api(suffix = '', versionId, method = 'GET') {
    check(++requests <= 12, 'REQUEST_LIMIT');
    const url = new URL(`/v1/projects/${PROJECT}/routes${suffix}`, 'https://api.vercel.com');
    url.searchParams.set('teamId', TEAM); if (versionId) url.searchParams.set('versionId', versionId);
    check(method === 'GET' || (discard && method === 'POST' && suffix === '/versions' && !versionId), 'MUTATION_SCOPE');
    const body = method === 'POST' ? { id: VERSION, action: 'discard' } : undefined;
    if (body) { result.discardAttempted = true; record({ event: 'discard_intent', body }); }
    const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (method === 'GET' && versionId === VERSION && response.status === 404) { await response.body?.cancel(); return { notFound: true, status: 404 }; }
    check(response.ok, `HTTP_${response.status}`);
    if (body) { await response.body?.cancel(); record({ event: 'discard_response_received', status: response.status }); return null; }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.byteLength; check(bytes <= 1048576, 'RESPONSE_LIMIT'); chunks.push(Buffer.from(chunk)); }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ReconcileError('INVALID_JSON'); }
    return value;
  }
  const metadata = version => ({ id: id(version?.id) ? version.id : null,
    isLive: typeof version?.isLive === 'boolean' ? version.isLive : null,
    isStaging: typeof version?.isStaging === 'boolean' ? version.isStaging : null,
    ruleCount: Number.isSafeInteger(version?.ruleCount) ? version.ruleCount : null });
  function diagnostic(live, history, staged) {
    const rows = Array.isArray(staged?.routes) ? staged.routes : [];
    return { event: 'routing_observation', live: { routeCount: Array.isArray(live?.routes) ? live.routes.length : null, version: metadata(live?.version), nullVersion: live?.version === null },
      versions: Array.isArray(history?.versions) ? history.versions.map(metadata) : null,
      staged: { notFound: staged?.notFound === true, version: metadata(staged?.version), routeCount: Array.isArray(staged?.routes) ? staged.routes.length : null,
        rows: rows.map(row => ({ id: id(row?.id) ? row.id : null, enabled: typeof row?.enabled === 'boolean' ? row.enabled : null,
          nameMatches: row?.name === `ZOLA routing canary ${NONCE}`, exactRoute: canonical(row?.route) === canonical(EXPECTED), routeSha256: digest(row?.route), expectedSha256: digest(EXPECTED),
          sourceMatches: row?.route?.src === EXPECTED.src, status418: row?.route?.status === 418,
          headersMatch: canonical(row?.route?.headers) === canonical(EXPECTED.headers),
          knownExtraFields: ['dest','destination','caseSensitive','has','missing','transforms','methods','respectOriginCacheControl'].filter(key => row?.route && Object.hasOwn(row.route, key)),
          unknownRouteKeyCount: row?.route && typeof row.route === 'object' ? Object.keys(row.route).filter(key => !['src','status','headers','dest','destination','caseSensitive','has','missing','transforms','methods','respectOriginCacheControl'].includes(key)).length : null })) } };
  }
  async function observe() {
    const live = await api(); const history = await api('/versions'); const staged = await api('', VERSION);
    const safe = diagnostic(live, history, staged); record(safe);
    return { live, history, staged };
  }
  function verify({ live, history, staged }) {
    check(live?.version === null && Array.isArray(live.routes) && live.routes.length === 0 && live.pagination == null, 'LIVE_NOT_EMPTY');
    check(Array.isArray(history?.versions) && history.pagination == null && history.versions.length <= 10000, 'HISTORY_SCHEMA');
    const matches = history.versions.filter(row => row.id === VERSION);
    check(matches.length === 1 && matches[0].isStaging === true && matches[0].isLive === false, 'STAGED_IDENTITY_UNPROVEN');
    check(history.versions.every(row => row.id === VERSION || (row.isStaging === false && row.isLive === false)), 'FOREIGN_ROUTING_STATE');
    check(staged?.version?.id === VERSION && Array.isArray(staged.routes) && staged.routes.length === 1 && staged.pagination == null, 'VERSION_CONTENT_MISMATCH');
    check(staged.version.isLive !== true && staged.version.isStaging !== false, 'CONTRADICTORY_VERSION_STATE');
    const row = staged.routes[0];
    check(id(row.id) && row.enabled === true && row.name === `ZOLA routing canary ${NONCE}` && canonical(row.route) === canonical(EXPECTED), 'CANARY_BYTES_MISMATCH');
  }
  function absent({ live, history, staged }) {
    return live?.version === null && Array.isArray(live.routes) && live.routes.length === 0 && live.pagination == null
      && Array.isArray(history?.versions) && history.pagination == null && history.versions.length <= 10000
      && history.versions.every(row => id(row.id) && row.id !== VERSION)
      && staged?.notFound === true && staged.status === 404;
  }
  try {
    const first = await observe();
    if (absent(first)) { result.status = 'KNOWN_STAGE_ABSENT'; record({ event: 'stage_absence_verified', liveRuleCount: 0, liveVersion: null, stageAbsent: true }); return result; }
    verify(first);
    if (!discard) { result.status = 'KNOWN_STAGE_VERIFIED'; return result; }
    const second = await observe(); verify(second);
    check(canonical(first) === canonical(second), 'ROUTING_DRIFT');
    try { await api('/versions', undefined, 'POST'); }
    catch { result.discardResponseUnknown = true; record({ event: 'discard_response_unknown' }); }
    const after = await observe();
    check(absent(after), 'DISCARD_NOT_CONFIRMED');
    record({ event: 'discard_verified', liveRuleCount: 0, liveVersion: null, stageAbsent: true });
    result.status = 'KNOWN_STAGE_DISCARDED';
  } catch (error) { result.code = error instanceof ReconcileError ? error.message : 'REQUEST_FAILED'; }
  finally { record({ event: 'complete', ...result }); }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    check(process.env.ZOLA_CANARY_EXPECTED_SHA === sha && process.env.GITHUB_SHA === sha && process.env.GITHUB_REF === 'refs/heads/release/zola-production-live', 'HEAD_MISMATCH');
    check(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() === '', 'DIRTY_TREE');
    check(['inspect-known-stage','discard-known-stage'].includes(process.env.ZOLA_CANARY_RECONCILE_ACTION), 'ACTION_REQUIRED');
    mkdirSync('zola-routing-reconcile-evidence', { mode: 0o700 });
    const fd = openSync('zola-routing-reconcile-evidence/journal.jsonl', 'wx', 0o600);
    try {
      // Persist both new directory entries before any management operation.
      for (const directory of ['zola-routing-reconcile-evidence', '.']) {
        const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      }
      const result = await reconcileKnownCanary({ token: process.env.VERCEL_TOKEN, discard: process.env.ZOLA_CANARY_RECONCILE_ACTION === 'discard-known-stage', record: event => { writeFileSync(fd, `${JSON.stringify(event)}\n`); fsyncSync(fd); } });
      writeFileSync('zola-routing-reconcile-evidence/result.json', `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify(result)); if (result.status === 'INCOMPLETE') process.exitCode = 1;
    } finally { closeSync(fd); }
  } catch (error) { console.error(JSON.stringify({ status: 'INCOMPLETE', code: error instanceof ReconcileError ? error.message : 'INPUT_OR_IO_FAILED' })); process.exitCode = 1; }
}
