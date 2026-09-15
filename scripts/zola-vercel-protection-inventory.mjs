import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const host = (v) => typeof v === 'string' && v.length <= 253 && v.split('.').length > 1 &&
  v.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))
  ? v.toLowerCase() : fail('INVALID_HOST');
const protection = (row) => ({
  ssoProtectionConfigured: row.ssoProtection == null ? null : Boolean(row.ssoProtection),
  passwordProtectionConfigured: row.passwordProtection == null ? null : Boolean(row.passwordProtection),
  trustedIpsConfigured: row.trustedIps == null ? null : Boolean(row.trustedIps),
  automationBypassConfigured: row.protectionBypass == null ? null : Object.keys(row.protectionBypass).length > 0,
});
const firewallMetadata = (config, source) => {
  if (!plainObject(config) || !Array.isArray(config.rules)) fail('INVALID_FIREWALL_CONFIG');
  return { source, configured: true,
    enabled: typeof config.firewallEnabled === 'boolean' ? config.firewallEnabled : null,
    version: Number.isSafeInteger(config.version) ? config.version : null,
    rules: config.rules.map((rule, index) => ({ index,
      active: typeof rule.active === 'boolean' ? rule.active : null,
      action: ['deny', 'bypass', 'challenge', 'log', 'redirect', 'rate_limit'].includes(rule.action?.mitigate?.action ?? rule.action) ? (rule.action?.mitigate?.action ?? rule.action) : 'UNKNOWN',
      // Predicate values may contain credentials. They are intentionally excluded.
      conditionGroupCount: Array.isArray(rule.conditionGroup) ? rule.conditionGroup.length : null,
      conditionsRequirePrivateReview: true })), denialProven: false };
};

// Only reviewed source paths may appear in plaintext. Arbitrary route expressions,
// builder sources, conditions, headers and config can contain secrets. Digests
// identify unresolved expressions without copying those values into evidence.
const REVIEWED_PATHS = new Set([
  '/api/search-jobs', '/api/search-jobs/[id]/trigger', '/api/search-jobs/:id/trigger',
  '/api/deal-engine/launch-buyer-search', '/api/buyer-engine/reverse-search',
  '/api/buyer-profiles', '/api/buyer-matches', '/api/buyer-reports', '/api/buyer-groups',
  '/api/nexus/trace', '/api/internal/capabilities/seller-opportunities',
  '/api/internal/capabilities/buyer-profiles', '/api/internal/capabilities/buyer-matches',
  '/api/internal/capabilities/deal-records', '/api/internal/capabilities/deal-analysis',
  '/api/internal/capabilities/nexus-enrichment', '/api/harvester/buyer-trace',
  '/api/harvester/buyer-match', '/api/harvester/buyer-outreach', '/api/harvester/create-deal',
  '/api/harvester/create-seller-lead', '/api/harvester/intake', '/api/harvester/approve',
  '/api/cron/fetch-opportunities', '/api/cron/send-alerts',
]);
const digest = value => createHash('sha256').update(value).digest('hex');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function pathDescriptor(value, vocabulary = REVIEWED_PATHS) {
  if (typeof value !== 'string' || !value.length || value.length > 8192) fail('INVALID_DEPLOYMENT_PATH');
  return { recognizedPath: vocabulary.has(value) ? value : null,
    expressionSha256: digest(value), redacted: !vocabulary.has(value) };
}

// SDK getdeploymentresponsebody1.ts and getdeploymentgitsourcedeploymentsresponse200type.ts:
// routes is nullable; builds contains builder declarations, NOT deployed output.
// Even complete metadata capture cannot certify build provenance or path authority.
export function deploymentPathMetadata(detail) {
  const validDetail = plainObject(detail);
  if (!validDetail) detail = {};
  const result = { status: 'INCOMPLETE', sourceSha: /^[a-f0-9]{40}$/.test(detail.meta?.githubCommitSha ?? '')
    ? detail.meta.githubCommitSha : null, sourceShaEvidence: 'deployment_metadata_only', routes: [], builds: [], gaps: [],
    buildOutputVerified: false, authorityProven: false, denialProven: false };
  try {
    if (!validDetail) result.gaps.push('INVALID_DEPLOYMENT_PATH_METADATA');
    if (!result.sourceSha) result.gaps.push('SOURCE_SHA_MISSING');
    if (detail.gitSource?.sha != null && detail.gitSource.sha !== result.sourceSha) result.gaps.push('SOURCE_SHA_METADATA_CONFLICT');
    if (!Array.isArray(detail.routes) || !detail.routes.length) result.gaps.push('ROUTE_METADATA_UNAVAILABLE');
    else {
      if (detail.routes.length > 2048) fail('DEPLOYMENT_ROUTE_LIMIT');
      result.routes = detail.routes.map((row, index) => {
        if (!plainObject(row)) fail('INVALID_DEPLOYMENT_ROUTE');
        const source = row.src ?? row.source;
        const handle = row.handle == null ? null : ['error', 'filesystem', 'hit', 'miss', 'resource', 'rewrite'].includes(row.handle)
          ? row.handle : fail('INVALID_DEPLOYMENT_HANDLE');
        if (source == null && handle == null) fail('INVALID_DEPLOYMENT_ROUTE');
        const descriptor = source == null ? null : pathDescriptor(source);
        if (descriptor?.redacted) result.gaps.push('UNREVIEWED_ROUTE_EXPRESSION');
        const methods = row.methods == null ? null : Array.isArray(row.methods) && row.methods.length <= 16 &&
          row.methods.every(method => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'].includes(method))
          ? row.methods : fail('INVALID_DEPLOYMENT_METHODS');
        for (const key of ['has', 'missing', 'transforms']) {
          if (row[key] != null && (!Array.isArray(row[key]) || row[key].length > 128)) fail('INVALID_DEPLOYMENT_CONDITIONS');
        }
        const delegated = row.middlewarePath != null || row.middleware != null || plainObject(row.destination);
        if (delegated || handle) result.gaps.push('DELEGATED_ROUTE_REQUIRES_BUILD_OUTPUT');
        return { index, source: descriptor, handle, methods,
          destinationPresent: row.dest != null || row.destination != null,
          conditionCount: (row.has?.length ?? 0) + (row.missing?.length ?? 0),
          transformCount: row.transforms?.length ?? 0, delegated,
          privateValuesRedacted: true };
      });
    }
    if (!Array.isArray(detail.builds) || !detail.builds.length) result.gaps.push('BUILD_METADATA_UNAVAILABLE');
    else {
      if (detail.builds.length > 256) fail('DEPLOYMENT_BUILD_LIMIT');
      result.builds = detail.builds.map((row, index) => {
        if (!plainObject(row) || typeof row.use !== 'string' || !row.use.length || row.use.length > 1024) fail('INVALID_DEPLOYMENT_BUILD');
        const builder = ['@vercel/next', '@vercel/node', '@vercel/static-build', '@vercel/static'].includes(row.use) ? row.use : null;
        const source = row.src == null ? null : pathDescriptor(row.src, new Set(['package.json', 'frontend/package.json']));
        if (builder === null || source?.redacted || source === null) result.gaps.push('UNREVIEWED_BUILD_DECLARATION');
        return { index, builder, builderSha256: digest(row.use), source, configRedacted: true };
      });
    }
    result.status = result.gaps.length ? 'INCOMPLETE' : 'METADATA_CAPTURED';
  } catch (error) {
    result.gaps.push(error instanceof InventoryError ? error.message : 'INVALID_DEPLOYMENT_PATH_METADATA');
  }
  result.gaps.push('BUILD_OUTPUT_AUTHORITY_UNVERIFIED');
  result.gaps = [...new Set(result.gaps)];
  return result;
}

// GET only, fixed API origin/project/team. No env or decrypted-secret endpoints.
// Raw responses, rule values, bypass IPs, comments, and API errors never leave memory.
export async function inventoryProtection({ token, fetchImpl = fetch, now = () => performance.now(), deadlineMs = 720000 }) {
  const evidence = { schema: 1, status: 'INCOMPLETE', projectId: PROJECT, teamId: TEAM,
    readOnly: true, denialProven: false, deployments: [], domains: [], aliases: [], aliasTargetDeployments: [], observations: [] };
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
  async function verifyAbsentAlias(alias, deploymentId) {
    if (now() - started >= deadlineMs || ++requests > 2000) fail('INVENTORY_LIMIT');
    const url = new URL(`https://${alias}/zola-absent-alias-${digest(deploymentId).slice(0, 32)}`);
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit',
      signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadlineMs - (now() - started)))),
      headers: { Accept: 'text/plain' } });
    await response.body?.cancel();
    if (response.status !== 410) fail(`ALIAS_HTTP_${response.status}`);
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
  async function deploymentDetail(id) {
    const detail = await get(`/v13/deployments/${id}`);
    if (detail.id !== id || (detail.projectId ?? detail.project?.id) !== PROJECT) fail('DEPLOYMENT_MISMATCH');
    return { id, url: host(detail.url),
      sha: /^[a-f0-9]{40}$/.test(detail.meta?.githubCommitSha ?? '') ? detail.meta.githubCommitSha : null,
      state: ['READY', 'ERROR', 'CANCELED', 'BUILDING', 'QUEUED', 'INITIALIZING'].includes(detail.readyState) ? detail.readyState : 'UNKNOWN',
      target: ['production', 'preview'].includes(detail.target) ? detail.target : null,
      aliases: Array.isArray(detail.alias) ? detail.alias.map(host) : [], ...protection(detail),
      routeCount: Array.isArray(detail.routes) ? detail.routes.length : null,
      pathMetadata: deploymentPathMetadata(detail) };
  }
  await observe('deployments', async () => {
    const rows = await paged('/v6/deployments', 'deployments', { projectId: PROJECT });
    const seen = new Set();
    for (const row of rows) {
      const id = identifier(row.uid ?? row.id);
      if (seen.has(id)) fail('DUPLICATE_DEPLOYMENT');
      seen.add(id);
      evidence.deployments.push(await deploymentDetail(id));
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
    const seen = new Set();
    evidence.aliases = rows.map((row) => {
      const alias = host(row.alias);
      if (seen.has(alias)) fail('DUPLICATE_ALIAS');
      seen.add(alias);
      return { alias, deploymentId: row.deploymentId == null ? null : identifier(row.deploymentId) };
    });
    return { count: rows.length, paginationComplete: true };
  });
  // Project deployment pagination may omit older/deleted alias targets. Follow
  // every distinct missing target through the fixed authenticated metadata API.
  // A provider 404/410 is retained as an explicit absent-resource outcome. It
  // completes inventory classification, but never proves alias denial, path
  // authority, or rollback suitability; release-specific gates must reject an
  // absent protected rollback target.
  await observe('aliasDeploymentClosure', async () => {
    if (['deployments', 'aliases'].some(name =>
      evidence.observations.find(row => row.name === name)?.status !== 'COMPLETE')) fail('ALIAS_CLOSURE_INPUT_INCOMPLETE');
    const known = new Set(evidence.deployments.map(row => row.id));
    const missing = [...new Set(evidence.aliases.map(row => row.deploymentId).filter(id => id !== null && !known.has(id)))];
    for (const id of missing) {
      try {
        const detail = await deploymentDetail(id);
        evidence.deployments.push(detail);
        evidence.aliasTargetDeployments.push({ id, status: 'COMPLETE', denialProven: false });
      } catch (error) {
        const code = error instanceof InventoryError ? error.message : 'REQUEST_FAILED';
        evidence.aliasTargetDeployments.push({ id,
          status: ['HTTP_404', 'HTTP_410'].includes(code) ? 'ABSENT' : 'INCOMPLETE',
          code, denialProven: false });
      }
    }
    for (const target of evidence.aliasTargetDeployments.filter(row => row.status === 'ABSENT')) {
      const aliases = evidence.aliases.filter(row => row.deploymentId === target.id).map(row => row.alias);
      try {
        for (const alias of aliases) await verifyAbsentAlias(alias, target.id);
        target.aliasesChecked = aliases.length;
        target.aliasStatus = 410;
      } catch (error) {
        target.status = 'INCOMPLETE';
        target.code = error instanceof InventoryError ? error.message : 'ALIAS_PROBE_FAILED';
      }
    }
    if (evidence.aliases.some(row => row.deploymentId === null) ||
        evidence.aliasTargetDeployments.some(row => row.status === 'INCOMPLETE')) fail('ALIAS_TARGETS_UNRESOLVED');
    return { referencedTargets: new Set(evidence.aliases.map(row => row.deploymentId)).size,
      additionalDeployments: evidence.aliasTargetDeployments.filter(row => row.status === 'COMPLETE').length,
      absentDeployments: evidence.aliasTargetDeployments.filter(row => row.status === 'ABSENT').length,
      referentialClosure: evidence.aliasTargetDeployments.every(row => row.status === 'COMPLETE'),
      absentAliasHostsVerifiedGone: evidence.aliasTargetDeployments.filter(row => row.status === 'ABSENT')
        .reduce((count, row) => count + row.aliasesChecked, 0),
      denialProven: false };
  });
  // Bound read-only comparison of the one observed application-level coverage
  // gap with its covered sibling alias. Never emit arbitrary route/header values.
  await observe('coverageGapAliases', async () => {
    const names = ['frontend-c06ce2-routes-houseomegakennels-4825s-projects.vercel.app', 'frontend-tau-woad-73.vercel.app'];
    const result = [];
    for (const name of names) {
      const listed = evidence.aliases.find(row => row.alias === name);
      if (!listed) fail('COVERAGE_ALIAS_NOT_IN_INVENTORY');
      const data = await get(`/v4/aliases/${name}`, { projectId: PROJECT });
      if (data.alias !== name || data.projectId !== PROJECT || data.deploymentId !== listed.deploymentId ||
          (data.deployment?.id != null && data.deployment.id !== listed.deploymentId)) fail('COVERAGE_ALIAS_DRIFT');
      result.push({ alias: name, deploymentId: listed.deploymentId,
        redirectConfigured: data.redirect == null ? false : typeof data.redirect === 'string' ? true : null,
        microfrontendsConfigured: data.microfrontends == null ? false : typeof data.microfrontends === 'object' && !Array.isArray(data.microfrontends) ? true : null,
        routesPresent: Object.hasOwn(data, 'routes'), routesCount: Array.isArray(data.routes) ? data.routes.length : null,
        protectionBypassConfigured: data.protectionBypass == null ? null : typeof data.protectionBypass === 'object' && !Array.isArray(data.protectionBypass) ? Object.keys(data.protectionBypass).length > 0 : null,
        updatedAt: Number.isSafeInteger(data.updatedAt) ? data.updatedAt : null,
        createdAt: Number.isSafeInteger(data.createdAt) ? data.createdAt : null,
        denialProven: false });
    }
    return result;
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
  // Official unpaginated version history. Never emit creator, S3 key, comments,
  // rule values, or infer active denial from an empty history.
  await observe('projectRoutingVersions', async () => {
    const data = await get(`/v1/projects/${PROJECT}/routes/versions`);
    if (!data || !Array.isArray(data.versions) || data.versions.length > 10000 || data.pagination != null) fail('INVALID_ROUTING_VERSIONS');
    const seen = new Set();
    const versions = data.versions.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('INVALID_ROUTING_VERSION');
      const id = identifier(row.id);
      if (seen.has(id)) fail('DUPLICATE_ROUTING_VERSION'); seen.add(id);
      return { id, isLive: typeof row.isLive === 'boolean' ? row.isLive : null,
        isStaging: typeof row.isStaging === 'boolean' ? row.isStaging : null,
        ruleCount: Number.isSafeInteger(row.ruleCount) && row.ruleCount >= 0 && row.ruleCount <= 10000 ? row.ruleCount : null };
    });
    return { versions, count: versions.length, denialProven: false };
  });
  await observe('firewall', async () => {
    try {
      return firewallMetadata(await get('/v1/security/firewall/config/active', { projectId: PROJECT }), 'active_version');
    } catch (error) {
      if (!(error instanceof InventoryError) || error.message !== 'HTTP_404') throw error;
      // The supported list endpoint distinguishes an account with no active WAF
      // configuration from an unavailable/unauthorized read. Do not infer that
      // an absent custom config proves request denial or any default behavior.
      const listed = await get('/v1/security/firewall/config', { projectId: PROJECT });
      if (!plainObject(listed) || !Object.hasOwn(listed, 'active') || !Object.hasOwn(listed, 'draft') ||
          !Array.isArray(listed.versions) || !(listed.draft === null || plainObject(listed.draft))) fail('INVALID_FIREWALL_CONFIG_LIST');
      if (listed.active === null) return { source: 'configuration_list', configured: false,
        enabled: null, version: null, rules: [], denialProven: false };
      return firewallMetadata(listed.active, 'configuration_list');
    }
  });
  await observe('systemBypass', async () => {
    const rows = await paged('/v1/security/firewall/bypass', 'result', { projectId: PROJECT }, true);
    return { count: rows.length, paginationComplete: true, requiresPrivateReview: rows.length > 0 };
  });
  // No metadata-only response, including empty arrays or complete pagination,
  // substitutes for deployed build manifests and reviewed runtime path authority.
  evidence.pathAuthority = { status: 'INCOMPLETE', deploymentCount: evidence.deployments.length,
    metadataCapturedCount: evidence.deployments.filter(row => row.pathMetadata.status === 'METADATA_CAPTURED').length,
    unresolvedDeploymentIds: evidence.deployments.filter(row => row.pathMetadata.gaps.length).map(row => row.id),
    unresolvedAliasTargetIds: evidence.aliasTargetDeployments.filter(row => row.status !== 'COMPLETE').map(row => row.id),
    buildOutputVerified: false, authorityProven: false, denialProven: false };
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
