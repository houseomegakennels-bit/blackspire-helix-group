import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const MAX_BYTES = 4 * 1024 * 1024;
class InventoryError extends Error {
  constructor(code, diagnostic) { super(code); this.diagnostic = diagnostic; }
}
// Fixed keys and types only. Unknown keys/values may themselves be credentials.
export function routingSchemaDiagnostic(data) {
  const type = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const object = data !== null && typeof data === 'object' && !Array.isArray(data);
  const has = (key) => object && Object.hasOwn(data, key);
  const version = object ? data.version : undefined;
  return { topLevelType: type(data), routesPresent: has('routes'),
    routesType: type(object ? data.routes : undefined),
    routesCount: Array.isArray(data?.routes) ? data.routes.length : null,
    versionPresent: has('version'), versionType: type(version),
    versionIdPresent: version !== null && typeof version === 'object' && Object.hasOwn(version, 'id'),
    ruleCountType: type(version?.ruleCount),
    ruleCount: Number.isSafeInteger(version?.ruleCount) && version.ruleCount >= 0 && version.ruleCount <= 10000 ? version.ruleCount : null,
    paginationPresent: has('pagination'), limitPresent: has('limit') };
}
const fail = (code) => { throw new InventoryError(code); };
const identifier = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : fail('INVALID_IDENTIFIER');
const host = (v) => typeof v === 'string' && /^(?=.{1,253}$)[a-zA-Z0-9.-]+$/.test(v) ? v : fail('INVALID_HOST');
const protection = (row) => ({
  ssoProtectionConfigured: row.ssoProtection == null ? null : Boolean(row.ssoProtection),
  passwordProtectionConfigured: row.passwordProtection == null ? null : Boolean(row.passwordProtection),
  trustedIpsConfigured: row.trustedIps == null ? null : Boolean(row.trustedIps),
  automationBypassConfigured: row.protectionBypass == null ? null : Object.keys(row.protectionBypass).length > 0,
});

// GET only, fixed API origin/project/team. No env or decrypted-secret endpoints.
// Raw responses, rule values, bypass IPs, comments, and API errors never leave memory.
export async function inventoryProtection({ token, fetchImpl = fetch, now = () => performance.now(), deadlineMs = 720000 }) {
  const evidence = { schema: 1, status: 'INCOMPLETE', projectId: PROJECT, teamId: TEAM,
    readOnly: true, denialProven: false, deployments: [], domains: [], aliases: [], observations: [] };
  const started = now();
  let requests = 0;
  async function get(path, parameters = {}) {
    if (now() - started >= deadlineMs || ++requests > 2000) fail('INVENTORY_LIMIT');
    const url = new URL(path, 'https://api.vercel.com');
    url.searchParams.set('teamId', TEAM);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadlineMs - (now() - started)))),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!response.ok) fail(`HTTP_${response.status}`);
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BYTES) fail('RESPONSE_LIMIT');
      chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail('INVALID_JSON'); }
  }
  async function paged(path, key, parameters = {}, bypass = false) {
    const result = [];
    let cursor;
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const data = await get(path, { ...parameters, limit: 100, ...(cursor == null ? {} : { [bypass ? 'offset' : 'until']: cursor }) });
      if (!Array.isArray(data[key])) fail('INVALID_PAGE');
      result.push(...data[key]);
      if (result.length > 10000) fail('INVENTORY_LIMIT');
      const next = bypass ? data.pagination?.id : data.pagination?.next;
      if (next == null) return result;
      if (!['string', 'number'].includes(typeof next) || seen.has(String(next)) || data[key].length === 0) fail('INVALID_PAGINATION');
      seen.add(String(next)); cursor = next;
    }
    fail('PAGE_LIMIT');
  }
  async function observe(name, run) {
    try { const value = await run(); evidence.observations.push({ name, status: 'COMPLETE', value }); }
    catch (error) { evidence.observations.push({ name, status: 'INCOMPLETE', code: error instanceof InventoryError ? error.message : 'REQUEST_FAILED',
      ...(error instanceof InventoryError && error.diagnostic ? { diagnostic: error.diagnostic } : {}) }); }
  }
  if (typeof token !== 'string' || token.length < 16) return { ...evidence, code: 'CREDENTIAL_REQUIRED' };
  await observe('project', async () => {
    const project = await get(`/v9/projects/${PROJECT}`);
    if (project.id !== PROJECT || project.accountId !== TEAM) fail('PROJECT_MISMATCH');
    return { ...protection(project), updatedAt: Number.isFinite(project.updatedAt) ? project.updatedAt : null };
  });
  await observe('deployments', async () => {
    const rows = await paged('/v6/deployments', 'deployments', { projectId: PROJECT });
    const seen = new Set();
    for (const row of rows) {
      const id = identifier(row.uid ?? row.id);
      if (seen.has(id)) fail('DUPLICATE_DEPLOYMENT');
      seen.add(id);
      const detail = await get(`/v13/deployments/${id}`);
      if (detail.id !== id || (detail.projectId ?? detail.project?.id) !== PROJECT) fail('DEPLOYMENT_MISMATCH');
      evidence.deployments.push({ id, url: host(detail.url),
        sha: /^[a-f0-9]{40}$/.test(detail.meta?.githubCommitSha ?? '') ? detail.meta.githubCommitSha : null,
        state: ['READY', 'ERROR', 'CANCELED', 'BUILDING', 'QUEUED', 'INITIALIZING'].includes(detail.readyState) ? detail.readyState : 'UNKNOWN',
        target: ['production', 'preview'].includes(detail.target) ? detail.target : null,
        aliases: Array.isArray(detail.alias) ? detail.alias.map(host) : [], ...protection(detail),
        routeCount: Array.isArray(detail.routes) ? detail.routes.length : null });
    }
    return { count: evidence.deployments.length, paginationComplete: true };
  });
  await observe('domains', async () => {
    const rows = await paged(`/v9/projects/${PROJECT}/domains`, 'domains');
    evidence.domains = rows.map((row) => ({ name: host(row.name), verified: row.verified === true }));
    return { count: rows.length, paginationComplete: true };
  });
  await observe('aliases', async () => {
    const rows = await paged('/v4/aliases', 'aliases', { projectId: PROJECT });
    if (rows.some((row) => row.projectId !== PROJECT)) fail('ALIAS_PROJECT_MISMATCH');
    evidence.aliases = rows.map((row) => ({ alias: host(row.alias), deploymentId: row.deploymentId == null ? null : identifier(row.deploymentId) }));
    return { count: rows.length, paginationComplete: true };
  });
  // Official SDK projectRoutesGetRoutes: unfiltered endpoint returns the full
  // route array and version, with no cursor/limit request parameters. Never infer
  // live coverage from a staged/default response; preserve explicit isLive only.
  await observe('projectRouting', async () => {
    const data = await get(`/v1/projects/${PROJECT}/routes`);
    if (!data || !Array.isArray(data.routes) || data.routes.length > 10000 || !data.version ||
        data.pagination != null || (data.version.ruleCount != null && data.version.ruleCount !== data.routes.length)) throw new InventoryError('INCOMPLETE_ROUTING_SCHEMA', routingSchemaDiagnostic(data));
    const intake = ['/api/search-jobs', '/api/search-jobs/:id/trigger', '/api/deal-engine/launch-buyer-search'];
    const conditions = (rows) => {
      if (rows == null) return [];
      if (!Array.isArray(rows) || rows.length > 128) fail('INVALID_ROUTING_CONDITIONS');
      return rows.map((condition) => ({
        type: ['host', 'header', 'cookie', 'query'].includes(condition.type) ? condition.type : 'UNKNOWN',
        operators: typeof condition.value === 'object' && condition.value !== null
          ? Object.keys(condition.value).filter((key) => ['eq', 'neq', 'inc', 'ninc', 'pre', 'suf', 're', 'gt', 'gte', 'lt', 'lte'].includes(key))
          : [condition.value == null ? 'exists' : 'eq'],
        valuesRedacted: true,
      }));
    };
    return { fullUnfilteredArray: true, versionId: identifier(data.version.id),
      isLive: typeof data.version.isLive === 'boolean' ? data.version.isLive : null,
      isStaging: typeof data.version.isStaging === 'boolean' ? data.version.isStaging : null,
      count: data.routes.length, maxRoutes: Number.isSafeInteger(data.limit?.maxRoutes) ? data.limit.maxRoutes : null,
      rules: data.routes.map((row, index) => {
        if (!row.route || typeof row.route.src !== 'string') fail('INVALID_ROUTING_RULE');
        const route = row.route;
        const source = row.rawSrc ?? route.src;
        const destination = route.dest ?? route.destination;
        let destinationClass = destination == null ? 'none' : 'redacted';
        if (typeof destination === 'string') {
          if (destination.startsWith('/') && !destination.startsWith('//')) destinationClass = 'internal';
          else { try { const url = new URL(destination); destinationClass = url.protocol === 'https:' && url.hostname === 'jarvis.blackspirehelix.com' ? 'canonical_gateway' : 'external_other'; } catch { /* Unknown remains redacted. */ } }
        }
        return { index, enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
          routeType: ['rewrite', 'redirect', 'set_status', 'transform'].includes(row.routeType) ? row.routeType : 'UNKNOWN',
          srcSyntax: ['equals', 'path-to-regexp', 'regex'].includes(row.srcSyntax) ? row.srcSyntax : 'UNKNOWN',
          recognizedIntakePath: intake.includes(source) ? source : null, sourceRedacted: !intake.includes(source),
          destinationClass, status: Number.isInteger(route.status) && route.status >= 100 && route.status <= 599 ? route.status : null,
          methods: Array.isArray(route.methods) ? route.methods.map((method) => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method) ? method : 'UNKNOWN') : null,
          has: conditions(route.has), missing: conditions(route.missing),
          transformCount: Array.isArray(route.transforms) ? route.transforms.length : 0,
          privateValueReviewRequired: true };
      }), denialProven: false };
  });
  await observe('firewall', async () => {
    const config = await get('/v1/security/firewall/config/active', { projectId: PROJECT });
    if (!Array.isArray(config.rules)) fail('INVALID_FIREWALL_CONFIG');
    return { enabled: typeof config.firewallEnabled === 'boolean' ? config.firewallEnabled : null,
      version: Number.isSafeInteger(config.version) ? config.version : null,
      rules: config.rules.map((rule, index) => ({ index,
        active: typeof rule.active === 'boolean' ? rule.active : null,
        action: ['deny', 'bypass', 'challenge', 'log', 'redirect', 'rate_limit'].includes(rule.action?.mitigate?.action ?? rule.action) ? (rule.action?.mitigate?.action ?? rule.action) : 'UNKNOWN',
        // Predicate values may contain credentials. They are intentionally excluded.
        conditionGroupCount: Array.isArray(rule.conditionGroup) ? rule.conditionGroup.length : null,
        conditionsRequirePrivateReview: true })), denialProven: false };
  });
  await observe('systemBypass', async () => {
    const rows = await paged('/v1/security/firewall/bypass', 'result', { projectId: PROJECT }, true);
    return { count: rows.length, paginationComplete: true, requiresPrivateReview: rows.length > 0 };
  });
  evidence.requests = requests;
  evidence.status = evidence.observations.every((row) => row.status === 'COMPLETE') ? 'INVENTORY_COMPLETE' : 'INCOMPLETE';
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.GITHUB_REPOSITORY !== 'houseomegakennels-bit/blackspire-helix-group' ||
      process.env.GITHUB_REF !== 'refs/heads/release/zola-production-live' || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')) {
    console.error('APPROVED_CI_CONTEXT_REQUIRED'); process.exitCode = 1;
  } else {
    const result = await inventoryProtection({ token: process.env.VERCEL_TOKEN });
    result.headSha = process.env.GITHUB_SHA;
    writeFileSync('zola-vercel-protection-inventory.json', `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, requests: result.requests, denialProven: false }));
    process.exitCode = result.status === 'INVENTORY_COMPLETE' ? 0 : 1;
  }
}
