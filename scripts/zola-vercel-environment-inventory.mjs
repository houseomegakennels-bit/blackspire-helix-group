import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DIRECT_DATABASE_ENV_KEYS } from '../packages/shared/security.js';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const API_ORIGIN = 'https://api.vercel.com';
const MAX_BYTES = 1024 * 1024;
const MAX_PAGES = 100;
const MAX_ROWS = 10000;
const VALID_TARGETS = new Set(['production', 'preview', 'development']);
const CANONICAL_DATABASE_KEYS = new Set([
  ...DIRECT_DATABASE_ENV_KEYS,
  // Provider/framework aliases that are not accepted by the host runtime but
  // still represent direct database authority if they appear in Vercel.
  'DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_USERNAME', 'DATABASE_PASSWORD',
  'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DATABASE', 'POSTGRES_USER', 'POSTGRES_USERNAME', 'POSTGRES_PASSWORD',
  'SUPABASE_DB_USERNAME', 'SUPABASE_DATABASE_URI', 'SUPABASE_DATABASE_HOST', 'SUPABASE_DATABASE_PORT',
  'SUPABASE_DATABASE_NAME', 'SUPABASE_DATABASE_USER', 'SUPABASE_DATABASE_USERNAME', 'SUPABASE_DATABASE_PASSWORD',
  'BUYER_WRITER_DATABASE_URI', 'BUYER_WRITER_DATABASE_HOST', 'BUYER_WRITER_DATABASE_PORT',
  'BUYER_WRITER_DATABASE_NAME', 'BUYER_WRITER_DATABASE_USER', 'BUYER_WRITER_DATABASE_USERNAME',
  'BUYER_WRITER_DATABASE_PASSWORD', 'BUYER_WRITER_DB_USERNAME',
].map((key) => key.toUpperCase()));

class InventoryError extends Error {
  constructor(code) { super(code); }
}

const fail = (code) => { throw new InventoryError(code); };
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Public framework prefixes do not make a direct database credential safe. A
// suffix match also catches project-specific aliases such as ZOLA_DATABASE_URL.
export function isProhibitedFrontendDatabaseKey(value) {
  if (typeof value !== 'string') return false;
  const key = value.toUpperCase();
  if (CANONICAL_DATABASE_KEYS.has(key)) return true;
  return [...CANONICAL_DATABASE_KEYS].some((candidate) => key.endsWith(`_${candidate}`));
}

function normalizeTargets(value) {
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.length === 0 || values.length > VALID_TARGETS.size ||
      values.some((target) => typeof target !== 'string' || !VALID_TARGETS.has(target))) fail('INVALID_ENV_TARGET');
  const targets = [...new Set(values)].sort();
  if (targets.length !== values.length) fail('DUPLICATE_ENV_TARGET');
  return targets;
}

function sanitizeRow(row) {
  if (!plainObject(row) || typeof row.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(row.key)) {
    fail('INVALID_ENV_ROW');
  }
  if (row.decrypted !== undefined && row.decrypted !== false) fail('DECRYPTED_VALUE_RETURNED');
  const targets = normalizeTargets(row.target);
  if (row.gitBranch !== undefined && typeof row.gitBranch !== 'string') fail('INVALID_GIT_BRANCH_SCOPE');
  if (row.customEnvironmentIds !== undefined &&
      (!Array.isArray(row.customEnvironmentIds) || row.customEnvironmentIds.length > 10000 ||
       row.customEnvironmentIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)))) {
    fail('INVALID_CUSTOM_ENVIRONMENT_SCOPE');
  }
  return Object.freeze({
    key: row.key,
    targets,
    gitBranchScoped: typeof row.gitBranch === 'string',
    customEnvironmentCount: row.customEnvironmentIds?.length ?? 0,
  });
}

function pageRows(data) {
  if (Array.isArray(data)) return { rows: data, next: null };
  if (!plainObject(data) || !Array.isArray(data.envs)) fail('INVALID_ENV_SCHEMA');
  if (data.pagination === undefined) return { rows: data.envs, next: null };
  if (!plainObject(data.pagination)) fail('INVALID_ENV_PAGINATION');
  const next = data.pagination.next;
  if (next !== null && next !== undefined && !['string', 'number'].includes(typeof next)) fail('INVALID_ENV_PAGINATION');
  return { rows: data.envs, next: next ?? null };
}

async function boundedJson(response) {
  if (!response.ok) fail(`HTTP_${response.status}`);
  let bytes = 0;
  const chunks = [];
  if (!response.body) fail('EMPTY_RESPONSE');
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_BYTES) fail('RESPONSE_LIMIT');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('INVALID_JSON'); }
}

// Fixed project/team, GET-only, and explicitly non-decrypting. Vercel may
// include opaque value fields in the list response; they are never copied,
// compared, logged, returned, or written to evidence.
export async function inventoryFrontendEnvironment({
  token,
  fetchImpl = fetch,
  now = () => performance.now(),
  deadlineMs = 120000,
} = {}) {
  const evidence = {
    schema: 1,
    status: 'INCOMPLETE',
    projectId: PROJECT,
    teamId: TEAM,
    readOnly: true,
    decryptRequested: false,
    paginationComplete: false,
    entries: [],
    prohibitedKeys: [],
    prohibitedKeyCount: null,
  };
  if (typeof token !== 'string' || token.length < 16) return { ...evidence, code: 'CREDENTIAL_REQUIRED' };
  const started = now();
  let requests = 0;
  async function get(path, parameters = {}) {
    if (now() - started >= deadlineMs || ++requests > MAX_PAGES + 1) fail('INVENTORY_LIMIT');
    const url = new URL(path, API_ORIGIN);
    url.searchParams.set('teamId', TEAM);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    const remaining = deadlineMs - (now() - started);
    if (remaining <= 0) fail('INVENTORY_LIMIT');
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(Math.max(1, Math.min(15000, remaining))),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    return boundedJson(response);
  }
  try {
    const project = await get(`/v9/projects/${PROJECT}`);
    if (!plainObject(project) || project.id !== PROJECT || project.accountId !== TEAM) fail('PROJECT_MISMATCH');
    const rows = [];
    const seenCursors = new Set();
    const seenIds = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await get(`/v10/projects/${PROJECT}/env`, {
        decrypt: 'false',
        ...(cursor === null ? {} : { until: cursor }),
      });
      const parsed = pageRows(data);
      for (const row of parsed.rows) {
        if (plainObject(row) && row.id !== undefined) {
          if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || seenIds.has(row.id)) fail('INVALID_OR_DUPLICATE_ENV_ID');
          seenIds.add(row.id);
        }
        rows.push(sanitizeRow(row));
        if (rows.length > MAX_ROWS) fail('ENV_ROW_LIMIT');
      }
      if (parsed.next === null) {
        evidence.paginationComplete = true;
        break;
      }
      const serialized = String(parsed.next);
      if (parsed.rows.length === 0 || seenCursors.has(serialized)) fail('INVALID_ENV_PAGINATION');
      seenCursors.add(serialized);
      cursor = serialized;
    }
    if (!evidence.paginationComplete) fail('ENV_PAGE_LIMIT');
    evidence.entries = rows.sort((a, b) => a.key.localeCompare(b.key) || a.targets.join(',').localeCompare(b.targets.join(',')));
    evidence.prohibitedKeys = [...new Set(rows.filter((row) => isProhibitedFrontendDatabaseKey(row.key)).map((row) => row.key))].sort();
    evidence.prohibitedKeyCount = evidence.prohibitedKeys.length;
    evidence.requests = requests;
    evidence.status = evidence.prohibitedKeyCount === 0 ? 'ISOLATED' : 'PROHIBITED_DATABASE_KEYS_PRESENT';
    return evidence;
  } catch (error) {
    return { ...evidence, requests, code: error instanceof InventoryError ? error.message : 'REQUEST_FAILED' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.GITHUB_REPOSITORY !== 'houseomegakennels-bit/blackspire-helix-group' ||
      process.env.GITHUB_REF !== 'refs/heads/release/zola-production-live' ||
      !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')) {
    console.error('APPROVED_CI_CONTEXT_REQUIRED');
    process.exitCode = 1;
  } else {
    const result = await inventoryFrontendEnvironment({ token: process.env.VERCEL_TOKEN });
    result.headSha = process.env.GITHUB_SHA;
    writeFileSync('zola-vercel-environment-inventory.json', `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, prohibitedKeyCount: result.prohibitedKeyCount,
      paginationComplete: result.paginationComplete, requests: result.requests }));
    process.exitCode = result.status === 'ISOLATED' ? 0 : 1;
  }
}
