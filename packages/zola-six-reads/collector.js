// Production collector primitives. No ambient configuration, network or database
// access on import. The CLI supplies the concrete privileged host implementation.
import { createHash } from 'node:crypto';
import { blackspireCapabilityRegistry } from '../capabilities/index.js';
import { validateCapabilityOutput } from '../capabilities/contract.js';
import { compareDivisionSnapshots, validateDivisionSnapshot, validateOwnerWitness } from './database-observer.js';
import { decodeObservedResponse, observationForResult } from '../capabilities/read-observation.js';
import { persistedReceiverAuthorityBindingDigest, receiverRequest } from '../capabilities/receiver-authority-contract.js';

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
  if ([2,3,4,5].includes(value?.version)) keys.push('observerDatabaseConfigPath');
  if ([4,5].includes(value?.version)) keys.push('denialReceiptPath');
  if (value?.version === 5) keys.push('releaseRunId');
  if ([4,5].includes(value?.version) && (typeof value.denialReceiptPath !== 'string' || !value.denialReceiptPath.startsWith('/') || value.denialReceiptPath.includes('\0'))) refuse('INVALID_CONFIGURATION');
  if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value,k)) || ![1,2,3,4,5].includes(value.version) || ([2,3,4,5].includes(value.version) && (typeof value.observerDatabaseConfigPath !== 'string' || !value.observerDatabaseConfigPath.startsWith('/') || value.observerDatabaseConfigPath.includes('\0'))) ||
      !sha(value.releaseSha) || ![value.workspace,value.principal,value.deniedPrincipal,value.runId].every(id) || value.principal === value.deniedPrincipal ||
      !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      ![value.apiPid,value.workerPid].every(n => Number.isInteger(n) && n > 1) || value.apiPid === value.workerPid ||
      ![value.databasePath,value.credentialPath,value.journalDirectory].every(p => typeof p === 'string' && p.startsWith('/') && !p.includes('\0'))) refuse('INVALID_CONFIGURATION');
  if(value.version===5&&!id(value.releaseRunId))refuse('INVALID_CONFIGURATION');
  let origin; try { origin = new URL(value.frontendOrigin); } catch { refuse('INVALID_FRONTEND_ORIGIN'); }
  if (origin.protocol !== 'https:' || origin.origin !== value.frontendOrigin || origin.username || origin.password) refuse('INVALID_FRONTEND_ORIGIN');
  readCases(value.dealId);
  return Object.freeze({ ...value });
}
export function requireProductionCollectorConfig(config) {
  if (config?.version !== 5) refuse('PRODUCTION_RECEIVER_AUTHORITY_REQUIRED');
  return config;
}
export function requireProductionCollectorReport(report) {
  if (report?.livePass !== true || report?.status!=='PASS_LIVE_ACCEPTANCE'||report?.receiverAuthorityPass !== true || !Array.isArray(report.results) || report.results.length !== 6 ||
      report.results.some(row => row?.authorityVersion !== 1 || !/^[a-f0-9]{64}$/.test(row?.receiverAuthorityDigest ?? ''))) {
    refuse('PRODUCTION_RECEIVER_AUTHORITY_FAILED');
  }
  return report;
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
  const { route, receiverAuthorityDigest, ...header } = evidence.readObservation ?? {};
  if (route !== entry.route || header.releaseSha !== config.releaseSha) refuse('FRONTEND_PAIRING_MISMATCH');
  let authorityEvidence;
  if(config.version===5){
    const authority=request.receiverAuthority,canonical=receiverRequest(entry.capability,config.workspace,request.input);
    let bindingDigest;try{bindingDigest=persistedReceiverAuthorityBindingDigest(authority);}catch{refuse('RECEIPT_AUTHORITY_MISMATCH');}
    if(authority.releaseSha!==config.releaseSha||authority.releaseRunId!==config.releaseRunId||authority.apiGeneration!==generation.apiGeneration
      ||authority.workerGeneration!==generation.workerGeneration||authority.workspaceId!==config.workspace||authority.principalId!==config.principal
      ||authority.capabilityId!==entry.capability||authority.permission!==entry.permissions[0]||authority.taskId!==task.id||authority.attemptId!==attempt.id
      ||authority.workerId!==generation.workerId||authority.claimDigest!==request.claimDigest||authority.method!==canonical.method
      ||authority.path!==canonical.path||authority.bodySha256!==canonical.bodySha256||receiverAuthorityDigest!==bindingDigest)refuse('RECEIPT_AUTHORITY_MISMATCH');
    authorityEvidence={authorityVersion:1,releaseRunId:authority.releaseRunId,receiverAuthorityDigest:bindingDigest};
  }
  const decoded = decodeObservedResponse(JSON.stringify(result), new Response(null, { headers: { 'x-zola-read-observation': JSON.stringify(header),
    ...(receiverAuthorityDigest?{'x-blackspire-authority-binding':receiverAuthorityDigest}:{}) } }), route,config.version===5?receiverAuthorityDigest:null);
  const observed = observationForResult(decoded);
  if (!observed) refuse('MISSING_OBSERVATION');
  return { capability: entry.capability, route, frontendSha: observed.releaseSha, runtimeSha: config.releaseSha,
    workspace: config.workspace, principal: config.principal, permissions: entry.permissions, permission: 'PASS: authority-fenced receipt',
    transport: observed.transport, requests: observed.requests, responseBytes: observed.responseBytes, boundedResultCount: evidence.resultCount,
    resultDigest: digest(result), latencyMs: observed.latencyMs, observedForbiddenAttempts: observed.forbiddenAttempts,
    observedScope: observed.scope, taskId: task.id, receiptId: attempt.id,...(authorityEvidence??{}),
    // Exact row deltas and process-wide egress cannot be inferred from this header.
    mutationDelta: 'UNVERIFIED: observer covers supplied read client only', paidProviderCalls: entry.capability === 'nexus.enrichment.status' ? 0 : 'UNVERIFIED: process-wide egress unavailable',
    paidProviderScope: entry.capability === 'nexus.enrichment.status' ? 'This dispatch only: exact-SHA reviewed Nexus route and findStoredContact have only supplied read-client I/O; not process-wide activity' : undefined,
    enrichmentMutations: 'UNVERIFIED: authoritative database delta unavailable',
    nexusStoredContact: entry.capability === 'nexus.enrichment.status' ? (result.source === null ? 'ABSENT' : 'PRESENT') : undefined };
}

// Store.append MUST fsync intent before returning. No caller-supplied PASS flags.
// A recorded intent is never admitted again, including a crash before the POST.
export async function collectAdmissionDenial(config,host,store,generation){
  const binding=digest(config),key=`zola-denial:${config.runId}`;
  const sameGeneration=async()=>{if(JSON.stringify(await host.generation())!==JSON.stringify(generation))refuse('GENERATION_CHANGED');};
  const rows=store.events().filter(e=>['denial_intent','denial_confirmed'].includes(e.type));
  const body={channel:'jarvis',workspaceId:config.workspace,text:readCases(config.dealId)[0].text,idempotencyKey:key,executionIntent:'read_only'};
  const expected={binding,key,requestDigest:digest(body),generation};
  const validateSnapshot=value=>{
    if(!value||Object.keys(value).sort().join(',')!=='databaseIdentity,tables'||
      !value.databaseIdentity||Object.keys(value.databaseIdentity).sort().join(',')!=='device,inode'||
      ![value.databaseIdentity.device,value.databaseIdentity.inode].every(n=>Number.isSafeInteger(n)&&n>=0)||
      !Array.isArray(value.tables)||value.tables.length!==4)refuse('DENIAL_SNAPSHOT_INVALID');
    for(const [i,name] of ['tasks','unified_inputs','provider_attempts','provider_usage'].entries()){
      const row=value.tables[i];
      if(!row||Object.keys(row).sort().join(',')!=='digest,name,rows'||row.name!==name||
        !Number.isSafeInteger(row.rows)||row.rows<0||row.rows>100000||!/^[a-f0-9]{64}$/.test(row.digest??''))refuse('DENIAL_SNAPSHOT_INVALID');
    }
    return value;
  };
  const matches=row=>Object.keys(row).sort().join(',')==='binding,generation,key,requestDigest,type'&&
    ['binding','key','requestDigest','generation'].every(k=>JSON.stringify(row[k])===JSON.stringify(expected[k]));
  if(rows.length){
    if(rows.length!==2||rows[0].type!=='denial_intent'||!matches(rows[0])||rows[1].type!=='denial_confirmed'||
      Object.keys(rows[1]).sort().join(',')!=='binding,generation,key,requestDigest,snapshotDigest,type'||
      !matches(Object.fromEntries(Object.entries(rows[1]).filter(([k])=>k!=='snapshotDigest')))||!/^[a-f0-9]{64}$/.test(rows[1].snapshotDigest??''))refuse('DENIAL_UNKNOWN_NO_RETRY');
    await host.deniedIdentity();
    // The retained denial is historical, but the principal must still have no
    // grants now. Intended reads legitimately changed these tables since then.
    if(typeof host.denialSnapshot!=='function')refuse('ADMISSION_DENIAL_OBSERVER_UNAVAILABLE');
    validateSnapshot(host.denialSnapshot());await sameGeneration();
    return{status:'AUTHENTICATED_ADMISSION_DENIED',reused:true,snapshotDigest:rows[1].snapshotDigest};
  }
  if(store.events().some(e=>e.type==='intent'))refuse('DENIAL_EVIDENCE_MISSING');
  if(typeof host.denialSnapshot!=='function'||typeof host.denyAdmission!=='function')refuse('ADMISSION_DENIAL_OBSERVER_UNAVAILABLE');
  await host.deniedIdentity();await sameGeneration();
  const before=validateSnapshot(host.denialSnapshot());
  store.append({type:'denial_intent',...expected});
  try{
    const result=await host.denyAdmission(body);
    if(result?.authorityDenied!==true||result.status!==404)refuse('AUTHENTICATED_ADMISSION_DENIAL_FAILED');
    const after=validateSnapshot(host.denialSnapshot());
    if(digest(before)!==digest(after))refuse('DENIAL_COMMAND_MUTATION');
    await sameGeneration();
    const snapshotDigest=digest(before);store.append({type:'denial_confirmed',...expected,snapshotDigest});
    return{status:'AUTHENTICATED_ADMISSION_DENIED',reused:false,snapshotDigest};
  }catch{refuse('DENIAL_UNKNOWN_NO_RETRY');}
}

export async function collectSixReads(config, host, store) {
  const binding = digest(config);
  const existing = store.events();
  if (existing.length && (existing[0].type !== 'run' || existing[0].binding !== binding)) refuse('JOURNAL_CONFIG_MISMATCH');
  // An after query closes this interval. Replaying it as a freshly collected
  // report would misrepresent old observations; retain the historical journal.
  if ([3,4,5].includes(config.version) && existing.some(e => e.type === 'database_query_intent' && e.binding?.phase === 'after')) refuse('CONNECTED_OBSERVER_INTERVAL_CLOSED');
  if (!existing.length) store.append({ type: 'run', binding, releaseSha: config.releaseSha });
  const generation = await host.generation();
  const acceptance=config.version===5&&typeof host.acceptance==='function'?await host.acceptance(generation):null;
  const sameGeneration = async () => { if (JSON.stringify(await host.generation()) !== JSON.stringify(generation)) refuse('GENERATION_CHANGED'); };
  await host.deniedIdentity(); // Requires a real authenticated, differently bound principal.
  const databaseEvents = store.events();
  const beforeEvents = databaseEvents.filter(e => e.type === 'database_before');
  if (beforeEvents.length > 1) refuse('DATABASE_OBSERVATION_DUPLICATE');
  const validateDatabaseEnvelope = value => {
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'owner,snapshot') refuse('DATABASE_OBSERVATION_ENVELOPE');
  };
  let databaseBefore;
  if ([2,3,4,5].includes(config.version)) {
    if (typeof host.observeDatabase !== 'function') refuse('DATABASE_OBSERVER_UNAVAILABLE');
    if (!beforeEvents.length) {
      if (store.events().some(e => e.type === 'intent')) refuse('DATABASE_OBSERVATION_MISSING_BEFORE_ADMISSION');
      databaseBefore = await host.observeDatabase('before', { generation, store });
      validateDatabaseEnvelope(databaseBefore);
      validateDivisionSnapshot(databaseBefore.snapshot, config, 'before');
      validateOwnerWitness(databaseBefore.owner, config, 'before');
      store.append({ type: 'database_before', observation: databaseBefore, generation });
    } else {
      if (JSON.stringify(beforeEvents[0].generation) !== JSON.stringify(generation)) refuse('DATABASE_OBSERVATION_GENERATION_CHANGED');
      const firstIntent = databaseEvents.findIndex(e => e.type === 'intent');
      if (firstIntent >= 0 && databaseEvents.findIndex(e => e.type === 'database_before') > firstIntent) refuse('DATABASE_OBSERVATION_AFTER_ADMISSION');
      databaseBefore = beforeEvents[0].observation;
      if ([3,4,5].includes(config.version) && digest(await host.observeDatabase('before', { generation, store })) !== digest(databaseBefore)) refuse('CONNECTED_OBSERVER_BASELINE_MISMATCH');
      validateDatabaseEnvelope(databaseBefore);
      validateDivisionSnapshot(databaseBefore.snapshot, config, 'before');
      validateOwnerWitness(databaseBefore.owner, config, 'before');
    }
    await sameGeneration();
  }
  const admissionDenial=await collectAdmissionDenial(config,host,store,generation);
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
  let databaseEvidence;
  if ([2,3,4,5].includes(config.version)) {
    const after = await host.observeDatabase('after', { generation, store });
    validateDatabaseEnvelope(after);
    validateOwnerWitness(after.owner, config, 'after');
    if (after.owner.witness !== databaseBefore.owner.witness) refuse('DATABASE_OWNER_WITNESS_CHANGED');
    databaseEvidence = { ...compareDivisionSnapshots(databaseBefore.snapshot, after.snapshot, config),
      ownerDenial: 'PASS: actual authenticated PostgreSQL role, existing real owner sees exact job and distinct real user cannot',
      ownerScope: 'SearchJob database policy only; browser authentication and other application authorization remain distinct boundaries' };
    store.append({ type: 'database_after', observation: after, evidence: databaseEvidence });
    await sameGeneration();
    for (const row of results) {
      row.mutationDelta = 0; row.mutationScope = databaseEvidence.scope;
      if (row.capability === 'nexus.enrichment.status') row.enrichmentMutations = '0 net persisted row/tuple-version delta across observation interval; attempted mutations unverified';
    }
  }
  const livePass=Boolean(config.version===5&&acceptance&&databaseEvidence&&results.length===6&&results.every(row=>row.authorityVersion===1&&row.mutationDelta===0)
    &&results.find(row=>row.capability==='nexus.enrichment.status')?.paidProviderCalls===0);
  const report = { version: 1, releaseSha: config.releaseSha, collectedAt: new Date().toISOString(),
    status: livePass?'PASS_LIVE_ACCEPTANCE':'COLLECTED_NOT_RELEASE_ACCEPTED', livePass, productionCollector: true, results, admissionDenial:{...admissionDenial,scope:'Authenticated no-grant Command principal; valid CSRF; task admission denied; unchanged persisted tasks, inputs, provider attempts and usage. Audit/session activity and transient/provider-wide effects are not covered.'}, ...(databaseEvidence ? { databaseEvidence } : {}),
    ...(acceptance?{heldAcceptance:acceptance}:{}),
    remainingGates: livePass?[]:databaseEvidence ? ['HELD acceptance authority binding', 'Other capability/application owner boundaries (database witness covers SearchJob only)'] : ['Authoritative division mutation delta', 'HELD acceptance authority binding', 'Supabase row-owner denial (Command task denial is a separate boundary)'],
    intentionalCommandWrites: 'Six durable read tasks, dispatch receipts, permission/audit records; never claim zero SQLite writes',
    ...(config.version===5?{receiverAuthorityPass:results.every(row=>row.authorityVersion===1)}:{}) };
  store.append({ type: 'report', digest: digest(report), status: report.status });
  return report;
}
