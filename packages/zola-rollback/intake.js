// Rehearsal compatibility boundary ONLY. Never mounted by API/worker launchers.
// The caller must verify the recovery artifact and provide its isolated runtime.
// This module does not attest host egress, immutable frontend URLs or live ACLs.
import { timingSafeEqual, createHash } from 'node:crypto';

export const RECOVERY_SHA = '2c0b600c268faa0571f08322e16d7f81f37789be';
export const RECOVERY_ARTIFACT = '0028052a7d08b1e7e73b8ce8cd441f90d10f16b288e10d10416891b5598f58bd';
export const INTAKE_PATH = '/rehearsal/zola/secure-intake';
export const RETIRED_PATHS = Object.freeze([
  '/api/tasks', '/api/unified-input', '/api/search-jobs', '/api/search-jobs/job/trigger',
  '/api/deal-engine/launch-buyer-search', '/webhook/buyer-engine', '/webhook-test/buyer-engine',
  '/api/nexus/trace', '/api/internal/buyer-writer',
]);
const capabilities = Object.freeze({
  'seller.opportunities.search': ['seller.opportunities.read', 'Show seller opportunities'],
  'buyer.profiles.search': ['buyer.profiles.read', 'Find buyer profiles'],
  'buyer.matches.search': ['buyer.matches.read', 'Find buyer matches for deal'],
  'deal.records.search': ['deal.records.read', 'Show active deals'],
  'deal.analysis.get': ['deal.analysis.read', 'Show underwriting for deal'],
  'nexus.enrichment.status': ['nexus.enrichment.read', 'Show Nexus status for'],
});
const needsDeal = new Set(['buyer.matches.search', 'deal.analysis.get', 'nexus.enrichment.status']);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const deny = () => Object.freeze({ status: 404, error: 'not found' });

export function createRehearsalIntake({ recoverySha, artifactSha256, token, principalId, workspaceId,
  apiGeneration, workerGeneration, resolvePrincipal, requirePermission, currentGenerations, admit }) {
  if (recoverySha !== RECOVERY_SHA || artifactSha256 !== RECOVERY_ARTIFACT ||
      typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(token) ||
      ![principalId, workspaceId, apiGeneration, workerGeneration].every(identifier) ||
      ![resolvePrincipal, requirePermission, currentGenerations, admit].every((fn) => typeof fn === 'function')) {
    throw new Error('INVALID_REHEARSAL_INTAKE_CONFIGURATION');
  }
  const expected = Buffer.from(`Bearer ${token}`);
  // Admission is synchronous: no suspension between final authority/fence read
  // and durable enqueue. Actual dispatcher must independently reauthorize/fence.
  return function handle({ method, rawPath, authorization, contentType, bodyBytes } = {}) {
    if (method !== 'POST' || rawPath !== INTAKE_PATH || contentType !== 'application/json' ||
        typeof authorization !== 'string' || Buffer.byteLength(authorization) !== expected.length ||
        !timingSafeEqual(Buffer.from(authorization), expected)) return deny();
    if (!Buffer.isBuffer(bodyBytes) || bodyBytes.length === 0 || bodyBytes.length > 2048) return deny();
    let body;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes);
      body = JSON.parse(text);
      // Reject duplicate keys, ambiguous spellings and noncanonical encodings.
      if (JSON.stringify(body) !== text) return deny();
    } catch { return deny(); }
    if (!body || Array.isArray(body) || typeof body !== 'object' ||
        Object.keys(body).some((key) => !['version', 'workspaceId', 'principalId', 'capabilityId', 'apiGeneration', 'workerGeneration', 'requestId', 'dealId'].includes(key)) ||
        body.version !== 1 || body.workspaceId !== workspaceId || body.principalId !== principalId ||
        body.apiGeneration !== apiGeneration || body.workerGeneration !== workerGeneration ||
        !uuid(body.requestId) || typeof body.capabilityId !== 'string' || !Object.hasOwn(capabilities, body.capabilityId)) return deny();
    if (needsDeal.has(body.capabilityId) ? !(typeof body.dealId === 'string' && /^DE-\d{4}$/.test(body.dealId)) : body.dealId !== undefined) return deny();
    const [permission, objective] = capabilities[body.capabilityId];
    function authorized() {
      const generations = currentGenerations();
      if (generations?.apiGeneration !== apiGeneration || generations?.workerGeneration !== workerGeneration) return false;
      const principal = resolvePrincipal(principalId);
      return principal?.principalId === principalId &&
        ['task.create', 'task.execute', 'task.read', permission].every((p) => requirePermission(principal, workspaceId, p)?.allowed === true);
    }
    try {
      if (!authorized()) return deny();
      // Never let recovery's globally keyed replay lookup consume caller keys.
      const binding = JSON.stringify([RECOVERY_SHA, workspaceId, principalId, apiGeneration, workerGeneration, body.capabilityId, body.dealId ?? null, body.requestId]);
      const key = `rollback:${createHash('sha256').update(binding).digest('hex')}`;
      const input = Object.freeze({ channel: 'jarvis', actorId: principalId, channelKey: key, workspaceId,
        text: `${objective}${needsDeal.has(body.capabilityId) ? ` ${body.dealId}` : ''}`,
        idempotencyKey: key, authority: 'authenticated_admin', executionIntent: 'read_only' });
      if (!authorized()) return deny();
      const result = admit(input);
      // Trusted runtime is required; never serialize errors or arbitrary results.
      if (result?.then || typeof result?.taskId !== 'string' || !/^task_[A-Za-z0-9_-]{1,128}$/.test(result.taskId) || result.error) {
        return Object.freeze({ status: 503, error: 'admission outcome unknown' });
      }
      return Object.freeze({ status: 202, taskId: result.taskId, duplicate: result.duplicate === true });
    } catch { return Object.freeze({ status: 503, error: 'admission outcome unknown' }); }
  };
}
