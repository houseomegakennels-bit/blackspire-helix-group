import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PROJECT = 'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou';
const TEAM = 'team_CaRyRaulJaFnCLSfTdyRYNIW';
const BRANCH = 'release/zola-production-live';
const WORKSPACE = 'blackspire-command';
const KEYS = ['BLACKSPIRE_CAPABILITY_TOKEN', 'BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID'];
const MAX_BYTES = 1024 * 1024;
class AuditError extends Error {}

// Official API schemas: vercel/sdk src/funcs/projectsFilterProjectEnvs.ts and
// projectsGetProjectEnv.ts. List encrypted metadata; decrypt only these two keys.
async function requestJson(path, token, fetchImpl, { method = 'GET', body } = {}) {
  const url = new URL(path, 'https://api.vercel.com');
  url.searchParams.set('teamId', TEAM);
  const response = await fetchImpl(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if ([401, 403].includes(response.status)) throw new AuditError('ACCESS REQUIRED');
  if (!response.ok) throw new AuditError('API REQUEST FAILED');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_BYTES) throw new AuditError('RESPONSE LIMIT EXCEEDED');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AuditError('INVALID API RESPONSE'); }
}

function equal(value, expected) {
  if (typeof value !== 'string') return null;
  const left = Buffer.from(value.trim());
  const right = Buffer.from(expected.trim());
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function auditReceiver({ vercelToken, capabilityToken, fetchImpl = fetch }) {
  if (!vercelToken || !capabilityToken || Buffer.byteLength(capabilityToken.trim()) < 32) {
    return { status: 'CREDENTIAL REQUIRED' };
  }
  try {
    const list = await requestJson(`/v10/projects/${PROJECT}/env?decrypt=false`, vercelToken, fetchImpl);
    if (!Array.isArray(list.envs) || list.pagination?.next) throw new AuditError('INCOMPLETE ENV METADATA');
    const selected = list.envs.filter((row) => KEYS.includes(row.key));
    if (selected.length > 32) throw new AuditError('ENV RECORD LIMIT EXCEEDED');
    const records = [];
    for (const row of selected) {
      if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id)) throw new AuditError('INVALID ENV METADATA');
      const target = Array.isArray(row.target) ? row.target : [row.target];
      if (!target.length || target.some((item) => !['production', 'preview', 'development'].includes(item)) ||
          (row.gitBranch != null && (typeof row.gitBranch !== 'string' || row.gitBranch.length > 256))) {
        throw new AuditError('INVALID ENV METADATA');
      }
      // Other branches are metadata-only and never decrypted.
      const relevant = row.gitBranch == null || row.gitBranch === BRANCH;
      let matches = null;
      if (relevant && row.type !== 'sensitive') {
        const detail = await requestJson(`/v1/projects/${PROJECT}/env/${encodeURIComponent(row.id)}`, vercelToken, fetchImpl);
        matches = equal(detail.value, row.key === KEYS[0] ? capabilityToken : WORKSPACE);
      }
      records.push({ key: row.key, target, gitBranch: row.gitBranch ?? null, present: true, matches });
    }
    const scopes = ['production', 'preview', BRANCH].map((scope) => {
      const keys = KEYS.map((key) => {
        const candidates = records.filter((row) => row.key === key && row.target.includes(scope === 'production' ? 'production' : 'preview'));
        const override = scope === BRANCH ? candidates.filter((row) => row.gitBranch === BRANCH) : [];
        const effective = override.length ? override : candidates.filter((row) => row.gitBranch === null);
        return { key, present: effective.length > 0, matches: effective.length === 1 ? effective[0].matches : null,
          status: effective.length === 0 ? 'MISSING' : effective.length > 1 ? 'AMBIGUOUS' : effective[0].matches === null ? 'ACCESS REQUIRED' : effective[0].matches ? 'READY' : 'MISMATCHED' };
      });
      return { scope, keys };
    });
    return { status: scopes.filter((scope) => scope.scope === 'production' || scope.scope === BRANCH).every((scope) => scope.keys.every((key) => key.status === 'READY')) ? 'READY' : 'ACTION REQUIRED', records, scopes };
  } catch (error) {
    return { status: error instanceof AuditError ? error.message : 'REQUEST FAILED' };
  }
}

// Explicit activation operation: never replace an existing value or expand a scope.
// A failed/uncertain POST stops here. A later operator run first re-reads all state,
// so it can preserve successful desired rows without replaying an uncertain write.
export async function provisionMissingReceiver(options) {
  const before = await auditReceiver(options);
  if (!before.scopes) return before;
  const required = before.scopes.filter(({ scope }) => scope !== 'preview');
  if (required.some(({ keys }) => keys.some(({ status }) => !['READY', 'MISSING'].includes(status)))) {
    return { status: 'EXISTING CONFIGURATION CONFLICT' };
  }
  let created = 0;
  try {
    for (const { scope, keys } of required) {
      for (const { key, status } of keys) {
        if (status === 'READY') continue;
        const result = await requestJson(`/v10/projects/${PROJECT}/env`, options.vercelToken, options.fetchImpl ?? fetch, {
          method: 'POST',
          body: { key, value: key === KEYS[0] ? options.capabilityToken.trim() : WORKSPACE,
            type: key === KEYS[0] ? 'encrypted' : 'plain',
            target: [scope === 'production' ? 'production' : 'preview'],
            ...(scope === BRANCH ? { gitBranch: BRANCH } : {}) },
        });
        if (!Array.isArray(result.failed) || result.failed.length) throw new AuditError('CREATE NOT CONFIRMED');
        const entries = Array.isArray(result.created) ? result.created : [result.created];
        const record = entries[0];
        if (entries.length !== 1 || !record || typeof record.id !== 'string' ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(record.id) || record.key !== key ||
            !Array.isArray(record.target) || record.target.length !== 1 ||
            record.target[0] !== (scope === 'production' ? 'production' : 'preview') ||
            (record.gitBranch ?? null) !== (scope === BRANCH ? BRANCH : null)) {
          throw new AuditError('CREATE NOT CONFIRMED');
        }
        created += 1;
      }
    }
    return { ...(await auditReceiver(options)), created };
  } catch (error) {
    return { status: error instanceof AuditError ? error.message : 'REQUEST FAILED', created,
      nextAction: 'RE-AUDIT BEFORE ANY RETRY; NO DEPLOYMENT' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.env.ZOLA_RECEIVER_ACTION ?? 'audit';
  const options = { vercelToken: process.env.VERCEL_TOKEN, capabilityToken: process.env.ZOLA_CAPABILITY_TOKEN };
  const report = action === 'provision-missing' ? await provisionMissingReceiver(options)
    : action === 'audit' ? await auditReceiver(options) : { status: 'INVALID ACTION' };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== 'READY') process.exitCode = 1;
}
