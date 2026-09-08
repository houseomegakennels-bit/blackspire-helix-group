// Production collector primitives. No ambient configuration, network or database
// access on import. The CLI supplies the concrete privileged host implementation.
import { createHash } from 'node:crypto';
import { blackspireCapabilityRegistry } from '../capabilities/index.js';
import { validateCapabilityOutput } from '../capabilities/contract.js';
import { decodeObservedResponse, observationForResult } from '../capabilities/read-observation.js';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const refuse = code => { const error = new Error(code); error.code = code; throw error; };
export function readCases(dealId) {
  if (!/^DE-\d{4}$/.test(dealId ?? '')) refuse('INVALID_DEAL');
  return [
    ['seller.opportunities.search', 'seller-opportunities', 'Show seller opportunities'],
    ['buyer.profiles.search', 'buyer-profiles', 'Find buyer profiles'],
    ['buyer.matches.search', 'buyer-profiles', `Find buyer matches for deal ${dealId}`],
    ['deal.records.search', 'deal-records', 'Show active deals'],
    ['deal.analysis.get', 'deal-analysis', `Show underwriting for deal ${dealId}`],
    ['nexus.enrichment.status', 'nexus-enrichment', `Show Nexus status for ${dealId}`],
  ].map(([capability, route, text]) => ({ capability, route: `/api/internal/capabilities/${route}`, text,
    permissions: [...blackspireCapabilityRegistry.get(capability).requiredPermissions] }));
}
export function validateCollectorConfig(value) {
  const keys = ['version','releaseSha','frontendOrigin','workspace','principal','deniedPrincipal','dealId','apiPid','workerPid','port','databasePath','credentialPath','journalDirectory','runId'];
  if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value,k)) || value.version !== 1 ||
      !sha(value.releaseSha) || ![value.workspace,value.principal,value.deniedPrincipal,value.runId].every(id) || value.principal === value.deniedPrincipal ||
      !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      ![value.apiPid,value.workerPid].every(n => Number.isInteger(n) && n > 1) || value.apiPid === value.workerPid ||
      ![value.databasePath,value.credentialPath,value.journalDirectory].every(p => typeof p === 'string' && p.startsWith('/') && !p.includes('\0'))) refuse('INVALID_CONFIGURATION');
  let origin; try { origin = new URL(value.frontendOrigin); } catch { refuse('INVALID_FRONTEND_ORIGIN'); }
  if (origin.protocol !== 'https:' || origin.origin !== value.frontendOrigin || origin.username || origin.password) refuse('INVALID_FRONTEND_ORIGIN');
  readCases(value.dealId);
  return Object.freeze({ ...value });
}
export function validateTaskBinding(task, config, entry, key) {
  if (!task || !id(task.id) || task.workspace_id !== config.workspace || task.actor_id !== config.principal ||
      task.source_channel !== 'jarvis' || task.authority_class !== 'authenticated_admin' || task.execution_intent !== 'read_only' ||
      task.idempotency_key !== `unified:jarvis:${key}` || task.request !== entry.text) refuse('TASK_BINDING_MISMATCH');
  return task;
}
export function verifyCollectedTask({ task, attempts }, config, entry, key, generation) {
  validateTaskBinding(task, config, entry, key);
  if (task.status !== 'completed' || attempts.length !== 1) refuse('TASK_NOT_SINGLE_COMPLETION');
  const attempt = attempts[0];
  if (attempt.task_id !== task.id || attempt.provider !== 'blackspire-capability' || attempt.mode !== entry.capability || attempt.status !== 'completed') refuse('RECEIPT_MISMATCH');
  let request, response, evidence;
  try { request = JSON.parse(attempt.request_packet); response = JSON.parse(attempt.response_packet); evidence = JSON.parse(task.evidence); } catch { refuse('RECEIPT_INVALID_JSON'); }
  if (request.workspaceId !== config.workspace || request.principalId !== config.principal || request.workerId !== generation.workerId || task.worker_id !== generation.workerId ||
      typeof task.claim_token !== 'string' || !task.claim_token || request.claimDigest !== digest(task.claim_token) ||
      !/^[a-f0-9]{64}$/.test(request.claimDigest ?? '') || evidence.capabilityId !== entry.capability || evidence.readOnly !== true ||
      !Array.isArray(evidence.changedFiles) || evidence.changedFiles.length || !Number.isInteger(evidence.resultCount) || evidence.resultCount < 0 || evidence.resultCount > 5) refuse('RECEIPT_AUTHORITY_MISMATCH');
  const result = validateCapabilityOutput(blackspireCapabilityRegistry.get(entry.capability), response.result);
  const collection = { 'seller.opportunities.search': 'opportunities', 'buyer.profiles.search': 'profiles', 'buyer.matches.search': 'matches', 'deal.records.search': 'deals' }[entry.capability];
  const actualCount = collection ? result[collection].length : entry.capability === 'deal.analysis.get' ? (result.found === false ? 0 : result.dealId ? 1 : 0) : (result.ownerName || result.propertyAddress ? 1 : 0);
  if (actualCount !== evidence.resultCount || actualCount > 5) refuse('RESULT_COUNT_MISMATCH');
  const { route, ...header } = evidence.readObservation ?? {};
  if (route !== entry.route || header.releaseSha !== config.releaseSha) refuse('FRONTEND_PAIRING_MISMATCH');
  const decoded = decodeObservedResponse(JSON.stringify(result), new Response(null, { headers: { 'x-zola-read-observation': JSON.stringify(header) } }), route);
  const observed = observationForResult(decoded);
  if (!observed) refuse('MISSING_OBSERVATION');
  return { capability: entry.capability, route, frontendSha: observed.releaseSha, runtimeSha: config.releaseSha,
    workspace: config.workspace, principal: config.principal, permissions: entry.permissions, permission: 'PASS: authority-fenced receipt',
    transport: observed.transport, requests: observed.requests, responseBytes: observed.responseBytes, boundedResultCount: evidence.resultCount,
    resultDigest: digest(result), latencyMs: observed.latencyMs, observedForbiddenAttempts: observed.forbiddenAttempts,
    observedScope: observed.scope, taskId: task.id, receiptId: attempt.id,
    // Exact row deltas and process-wide egress cannot be inferred from this header.
    mutationDelta: 'UNVERIFIED: observer covers supplied read client only', paidProviderCalls: entry.capability === 'nexus.enrichment.status' ? 0 : 'UNVERIFIED: process-wide egress unavailable',
    paidProviderScope: entry.capability === 'nexus.enrichment.status' ? 'This dispatch only: exact-SHA reviewed Nexus route and findStoredContact have only supplied read-client I/O; not process-wide activity' : undefined,
    enrichmentMutations: 'UNVERIFIED: authoritative database delta unavailable',
    nexusStoredContact: entry.capability === 'nexus.enrichment.status' ? (result.source === null ? 'ABSENT' : 'PRESENT') : undefined };
}

// Store.append MUST fsync intent before returning. No caller-supplied PASS flags.
// A recorded intent is never admitted again, including a crash before the POST.
export async function collectSixReads(config, host, store) {
  const binding = digest(config);
  const existing = store.events();
  if (existing.length && (existing[0].type !== 'run' || existing[0].binding !== binding)) refuse('JOURNAL_CONFIG_MISMATCH');
  if (!existing.length) store.append({ type: 'run', binding, releaseSha: config.releaseSha });
  const generation = await host.generation();
  const sameGeneration = async () => { if (JSON.stringify(await host.generation()) !== JSON.stringify(generation)) refuse('GENERATION_CHANGED'); };
  await host.deniedIdentity(); // Requires a real authenticated, differently bound principal.
  const results = [];
  for (const [index, entry] of readCases(config.dealId).entries()) {
    await sameGeneration();
    const key = `zola-six:${config.runId}:${index}`;
    const intents = store.events().filter(e => e.type === 'intent' && e.index === index);
    if (intents.length > 1 || (intents.length && intents[0].requestDigest !== digest({ key, text: entry.text, binding }))) refuse('JOURNAL_INTENT_MISMATCH');
    let record = host.lookup(key);
    if (!intents.length && record) refuse('UNJOURNALED_EXISTING_TASK');
    if (!intents.length) {
      store.append({ type: 'intent', index, key, requestDigest: digest({ key, text: entry.text, binding }), generation });
      // Any thrown network/HTTP/JSON error leaves the intent durable. Reruns
      // reconcile the exact SQLite key; absence after uncertain POST is UNKNOWN.
      try {
        const admitted = await host.admit({ channel: 'jarvis', workspaceId: config.workspace, text: entry.text, idempotencyKey: key, executionIntent: 'read_only' });
        if (!id(admitted.taskId)) refuse('ADMISSION_RESPONSE_INVALID');
        store.append({ type: 'admitted', index, taskId: admitted.taskId });
      } catch { store.append({ type: 'admission_unknown', index }); }
      record = host.lookup(key);
    }
    if (!record) refuse('ADMISSION_UNKNOWN_NO_RETRY');
    validateTaskBinding(record.task, config, entry, key);
    const originalGeneration = intents[0]?.generation ?? generation;
    if (JSON.stringify(originalGeneration) !== JSON.stringify(generation)) refuse('JOURNALED_GENERATION_CHANGED');
    const admittedIds = store.events().filter(e => e.type === 'admitted' && e.index === index).map(e => e.taskId);
    if (admittedIds.some(taskId => taskId !== record.task.id)) refuse('ADMISSION_TASK_ID_MISMATCH');
    for (let poll = 0; poll < 60 && ['queued','running','planning'].includes(record.task.status); poll++) {
      await host.pause(); await sameGeneration(); record = host.lookup(key);
      if (!record) refuse('TASK_DISAPPEARED'); validateTaskBinding(record.task, config, entry, key);
    }
    const row = verifyCollectedTask(record, config, entry, key, generation);
    await host.disclosure(record.task, config.deniedPrincipal);
    await sameGeneration();
    row.crossOwnerDenial = 'PASS: distinct authenticated principal denied this exact task';
    row.apiGeneration = generation.apiGeneration; row.workerGeneration = generation.workerGeneration;
    results.push(row);
    store.append({ type: 'collected', index, taskId: record.task.id, evidenceDigest: digest(row) });
  }
  await sameGeneration();
  const report = { version: 1, releaseSha: config.releaseSha, collectedAt: new Date().toISOString(),
    status: 'COLLECTED_NOT_RELEASE_ACCEPTED', livePass: false, productionCollector: true, results,
    remainingGates: ['Authoritative division mutation delta', 'Process-wide paid-provider/egress observation', 'Supabase row-owner denial (Command task denial is a separate boundary)'],
    intentionalCommandWrites: 'Six durable read tasks, dispatch receipts, permission/audit records; never claim zero SQLite writes' };
  store.append({ type: 'report', digest: digest(report), status: report.status });
  return report;
}
