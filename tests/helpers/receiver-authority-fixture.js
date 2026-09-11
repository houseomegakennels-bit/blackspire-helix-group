import { receiverRequest, validateReceiverAuthority } from '../../packages/capabilities/receiver-authority.js';

const permissions = Object.freeze({
  'seller.opportunities.search': 'seller.opportunities.read',
  'buyer.profiles.search': 'buyer.profiles.read',
  'buyer.matches.search': 'buyer.matches.read',
  'deal.records.search': 'deal.records.read',
  'deal.analysis.get': 'deal.analysis.read',
  'nexus.enrichment.status': 'nexus.enrichment.read',
});

export function transportAuthority(capabilityId, workspaceId, input, { now = Date.now() } = {}) {
  const request = receiverRequest(capabilityId, workspaceId, input);
  const envelope = {
    version: 1,
    releaseSha: 'a'.repeat(40),
    releaseRunId: '11111111-1111-4111-8111-111111111111',
    apiGeneration: 'b'.repeat(32),
    workerGeneration: 'c'.repeat(32),
    workspaceId,
    principalId: 'transport-test-principal',
    principalSecurityVersion: 1,
    grantId: 'transport-test-grant',
    grantVersion: 1,
    grantSecurityVersion: 1,
    capabilityId,
    permission: permissions[capabilityId],
    taskId: 'transport-test-task',
    attemptId: 'transport-test-attempt',
    workerId: 'transport-test-worker',
    claimDigest: 'd'.repeat(64),
    method: request.method,
    path: request.path,
    bodySha256: request.bodySha256,
    issuedAt: now,
    expiresAt: now + 15000,
    proof: 'e'.repeat(43),
  };
  validateReceiverAuthority(envelope, { now: () => now });
  return Object.freeze({ receiverRequest: request, receiverAuthority: Object.freeze(envelope) });
}
