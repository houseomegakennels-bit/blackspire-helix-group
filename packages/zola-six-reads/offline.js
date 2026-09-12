// Offline contract rehearsal only. No deployment, credentials, sockets, API/worker
// startup, or production acceptance. VM is a loader for trusted repository source,
// not a security boundary. The process wrapper supplies the wall-clock deadline.
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { timingSafeEqual, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { blackspireCapabilityRegistry } from '../capabilities/index.js';
import { createDivisionAdapters } from '../capabilities/http-adapters.js';
import { validateCapabilityInput, validateCapabilityOutput } from '../capabilities/contract.js';

const frontend = new URL('../../frontend/src/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, frontend), 'utf8');
const clean = (source) => stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\s*$/gm, '').replace(/\bexport /g, ''));
function load(name, source, dependencies) {
  return vm.runInNewContext(`${clean(source)}\n${name}`, { ...dependencies }, { timeout: 1000, codeGeneration: { strings: false, wasm: false } });
}
function helper(file, name, end, dependencies) {
  const source = read(`lib/${file}-engine-server.ts`);
  const start = source.indexOf(`export async function ${name}(`);
  const stop = source.indexOf(end, start);
  assert.ok(start >= 0 && stop > start, 'helper source boundary missing');
  return load(name, source.slice(start, stop), dependencies);
}

export const cases = Object.freeze([
  ['seller.opportunities.search', 'seller-opportunities', { limit: 5 }, 'opportunities'],
  ['buyer.profiles.search', 'buyer-profiles', { limit: 5 }, 'profiles'],
  ['buyer.matches.search', 'buyer-profiles', { opportunityId: 'DE-0001', limit: 5 }, 'matches'],
  ['deal.records.search', 'deal-records', { limit: 5 }, 'deals'],
  ['deal.analysis.get', 'deal-analysis', { dealId: 'DE-0001' }, null],
  ['nexus.enrichment.status', 'nexus-enrichment', { dealId: 'DE-0001' }, null],
].map(([id, route, input, collection]) => Object.freeze({ id, route: `/api/internal/capabilities/${route}`, input: Object.freeze(input), collection })));

function syntheticReceiverRequest(capabilityId,workspaceId,input){
  const entry=cases.find((item)=>item.id===capabilityId),body={workspaceId};
  if(capabilityId==='seller.opportunities.search'||capabilityId==='deal.records.search')body.limit=input.limit;
  else if(capabilityId==='deal.analysis.get')body.dealId=input.dealId;
  else if(capabilityId==='nexus.enrichment.status'){for(const key of ['ownerName','propertyAddress','sellerLeadId','dealId'])if(input[key])body[key]=input[key];}
  else{Object.assign(body,input);if(capabilityId==='buyer.matches.search')body.matchesOnly=true;}
  const bodyBytes=JSON.stringify(body);return {method:'POST',path:entry.route,bodyBytes,bodySha256:createHash('sha256').update(bodyBytes).digest('hex')};
}
function syntheticBindingDigest(envelope){const {proof,...claims}=envelope,proofDigest=createHash('sha256').update(proof).digest('hex');return createHash('sha256').update(JSON.stringify({...claims,proofDigest})).digest('hex');}

export function createOfflineFixture({ databaseError = false, errorTable = null, configured = true, releaseSha = "a".repeat(40) } = {}) {
  const events = [];
  const token = 'synthetic-capability-fixture-value-00001';
  const workspace = 'six-read-fixture';
  const env = Object.freeze({ BLACKSPIRE_CAPABILITY_TOKEN: token, BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID: workspace,
    SUPABASE_URL: 'https://offline.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-offline-placeholder' });
  const lead = { id: 'DE-0001', propertyAddress: '1 Fixture Street', county: 'Forsyth', status: 'New', motivationScore: 90,
    mao: '$1', assignmentFee: '$1', exitStrategy: 'Review', nextAction: 'Review' };
  const rows = {
    seller_leads: [{ id: 'seller-1', propertyId: 'property-1', propertyAddress: '1 Fixture Street', county: 'Forsyth', status: 'New', score: 90, category: 'Review', reasons: [], sourceName: 'seller_leads/properties' }],
    BuyerProfile: [{ id: 'buyer-1', buyer_name: 'Synthetic buyer', county: 'Forsyth', state: 'NC', is_cash_buyer: true, purchase_count: 3, score: 80 }],
    buyer_group_registry: [],
    deal_leads: [{ ...lead, motivation_score: 90, deal_analysis: { maximum_allowable_offer: 150000, assignment_fee_target: 10000 }, buyer_matches: { exit_strategy: 'Assignment' }, property_address: lead.propertyAddress, county: 'Forsyth', seller_lead_id: 'seller-1', owner_name: 'Synthetic owner' }],
    deal_analysis: [{ lead_id: 'DE-0001', estimated_arv: 230000, repair_estimate: 20000, seller_asking_price: 170000, maximum_allowable_offer: 150000, assignment_fee_target: 10000 }],
    nexus_contacts: [{ id: 'contact-1', seller_lead_id: 'seller-1', owner_name: 'Synthetic owner', property_address: lead.propertyAddress, primary_phone: null, contact_confidence_score: 80, status: 'Stored', provider: 'fixture', updated_at: '2026-09-07T00:00:00.000Z' }],
  };
  const reject = (kind) => { events.push({ kind }); throw new Error('offline forbidden operation'); };
  const db = new Proxy({ from(table) {
    assert.ok(Object.hasOwn(rows, table), 'unknown fixture relation');
    let countOnly = false; let limit = null; const filters = [];
    const query = new Proxy({
      select(_columns, options) { countOnly = options?.head === true; return query; },
      order() { return query; }, limit(value) { limit = value; return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      ilike() { return query; }, contains() { return query; },
      maybeSingle() { return result(true); },
      then(resolve, rejectPromise) { return result(false).then(resolve, rejectPromise); },
    }, { get(target, key) { if (key in target) return target[key]; return reject('database_mutation_attempt'); } });
    async function result(single) {
      events.push({ kind: 'database_read', table, limit, countOnly });
      const matches = rows[table].filter((row) => filters.every(([key, value]) => row[key] === value));
      const data = matches.slice(0, limit ?? matches.length);
      return { data: single ? data[0] ?? null : data, count: countOnly ? matches.length : null, error: (databaseError || errorTable === table) ? { message: 'synthetic query failure' } : null };
    }
    return query;
  } }, { get(target, key) { if (key in target) return target[key]; return reject(key === 'storage' ? 'storage_attempt' : 'database_mutation_attempt'); } });
  // Real closed production query client over synthetic REST; no permissive
  // respond stub, so caught errors and missing finalization cannot be hidden.
  const makeReadScope = load('createCapabilityReadScope', read('lib/capability-read-client.ts'), {
    URL, URLSearchParams, performance, AbortController, AbortSignal, TextDecoder, Response, Uint8Array,
  });
  const rest = async (url, options) => {
    assert.equal(url.origin, 'https://abcdefghijklmnopqrst.supabase.co');
    assert.ok(['GET', 'HEAD'].includes(options.method)); assert.equal(options.redirect, 'error');
    const table = url.pathname.split('/').at(-1);
    let q = db.from(table).select(url.searchParams.get('select'), options.method === 'HEAD' ? { head: true } : undefined);
    for (const [key, value] of url.searchParams) {
      if (key === 'limit') q = q.limit(Number(value));
      else if (value.startsWith('eq.')) q = q.eq(key, value.slice(3) === 'true' ? true : value.slice(3));
    }
    const result = await q;
    if (result.error) return Response.json({ error: 'synthetic failure' }, { status: 503 });
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-range': `*/${result.count}` } });
    return Response.json(result.data);
  };
  const dependencies = {
    NextResponse: { json: (body, options) => Response.json(body, options) },
    process: Object.freeze({ env }), Buffer, timingSafeEqual,
    readBoundedRequestBody: async (request) => { const value=await request.text();if(Buffer.byteLength(value)>32768)throw new Error('oversize');return value; },
    productionCapabilityReadScope: (receiverAuthorityDigest) => { if (!configured) throw new Error("fixture unavailable"); return makeReadScope({ origin: "https://abcdefghijklmnopqrst.supabase.co", key: "synthetic-read-key", releaseSha, receiverAuthorityDigest, fetchImpl: rest }); },
    createClient: () => db, getSupabaseAdmin: () => configured ? db : null,
    getEnvState: () => ({ enabled: configured }),
    fetch: () => reject('external_network_attempt'),
    SELLER_LEAD_BASE_SELECT: read('lib/seller-engine-server.ts').match(/const SELLER_LEAD_BASE_SELECT =\s*"([^"]+)"/)[1], mapSellerLead: (row) => row,
    normalizeCountyName: (value) => value.toLowerCase(),
    resolveBuyerCounty: () => ({ core: 'forsyth', display: 'Forsyth' }),
    resolvePropertyTypeBucket: () => 'residential', scoreBuyerProfile: () => ({ score: 80, reasons: ['Fixture'] }),
    classifyBuyerType: () => 'cash_buyer', mapBuyerGroupRow: (row) => row,
    isMissingRelationError: () => false, isMissingDealTableError: () => false,
    seedBuyerGroupRows: () => reject('database_mutation_attempt'), ensureBuyerGroupRegistrySeeded: () => reject('database_mutation_attempt'),
    listSellerLeads: () => reject('fallback_attempt'), toDealLeadFromSellerHandoff: () => reject('fallback_attempt'), toLead: (row) => row,

  };
  const dealSource = read('lib/deal-engine-server.ts');
  const pureSource = dealSource.slice(dealSource.indexOf('function asNumber('), dealSource.indexOf('function buildMetrics('))
    + dealSource.slice(dealSource.indexOf('function buildUnderwritingSnapshot('), dealSource.indexOf('function buildDealAutomationWorkflow('));
  Object.assign(dependencies, load('({ toLead, buildUnderwritingSnapshot })', pureSource, dependencies));
  dependencies.getDealEngineAnalysisForCapability = helper('deal', 'getDealEngineAnalysisForCapability', '\nexport async function getDealEngineDealDetail', dependencies);
  dependencies.authorizeInternalCapability = async (request,bodyBytes,workspaceId,capabilityId) => {
    try {
      if(workspaceId!==workspace||request.headers.get('authorization')!==`Bearer ${token}`)return null;
      const envelope=JSON.parse(Buffer.from(request.headers.get('x-blackspire-receiver-authority')||'','base64url').toString('utf8'));
      if(envelope.workspaceId!==workspace||envelope.capabilityId!==capabilityId||envelope.path!==new URL(request.url).pathname||
        envelope.bodySha256!==createHash('sha256').update(bodyBytes).digest('hex'))return null;
      return {bindingDigest:syntheticBindingDigest(envelope)};
    } catch { return null; }
  };
  for (const [file, name, end] of [
    ['seller', 'listSellerLeadsForCapability', '\nexport async function getSellerLeadDetail'],
    ['buyer', 'listBuyerProfilesForCapability', '\nfunction classifyBuyerType'],
    ['buyer', 'listBuyerGroupRegistry', '\nexport async function importBuyerGroupRegistryCsv'],
    ['deal', 'listDealEngineLeads', '\nexport async function listDealEngineSellerSignals'],
  ]) dependencies[name] = helper(file, name, end, dependencies);
  dependencies.matchBuyersForProperty = helper('buyer', 'matchBuyersForProperty', '\nconst getCachedCountyCapabilities', dependencies);
  const routes = new Map(cases.map(({ route }) => [route, load('POST', read(`app${route}/route.ts`), dependencies)]));
  const transport = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://offline.invalid');
    assert.equal(options.method, 'POST');
    const handler = routes.get(new URL(url).pathname);
    assert.ok(handler, 'unexpected route');
    events.push({ kind: 'route_dispatch', route: new URL(url).pathname });
    return handler(new Request(url, options));
  };
  const adapterEnv = {};
  for (const name of ['SELLER', 'BUYER', 'DEAL', 'NEXUS']) {
    adapterEnv[`BLACKSPIRE_${name}_CAPABILITY_URL`] = 'https://offline.invalid';
    adapterEnv[`BLACKSPIRE_${name}_CAPABILITY_TOKEN`] = token;
  }
  const adapters=createDivisionAdapters(adapterEnv,transport);
  const authorityFor=(entry,input=entry.input)=>{
    const request=syntheticReceiverRequest(entry.id,workspace,input),issuedAt=Date.now();
    const permission=blackspireCapabilityRegistry.get(entry.id).requiredPermissions[0];
    const envelope={version:1,releaseSha,releaseRunId:'11111111-1111-4111-8111-111111111111',apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32),
      workspaceId:workspace,principalId:'synthetic-principal',principalSecurityVersion:1,grantId:'synthetic-grant',grantVersion:1,grantSecurityVersion:1,
      capabilityId:entry.id,permission,taskId:'synthetic-task',attemptId:'synthetic-attempt',workerId:'synthetic-worker',claimDigest:'d'.repeat(64),
      method:request.method,path:request.path,bodySha256:request.bodySha256,issuedAt,expiresAt:issuedAt+15000,proof:'e'.repeat(43)};
    return {envelope,request};
  };
  const syntheticAdapters=Object.freeze(Object.fromEntries(Object.entries(adapters).map(([name,adapter])=>[name,(input)=>{
    const id=name==='sellerOpportunities'?'seller.opportunities.search':name==='dealRecords'?'deal.records.search':name==='dealAnalysis'?'deal.analysis.get':
      name==='nexusEnrichment'?'nexus.enrichment.status':input.matchesOnly===true?'buyer.matches.search':'buyer.profiles.search';
    const entry=cases.find((item)=>item.id===id),requestInput={...input};delete requestInput.workspaceId;delete requestInput.signal;
    const authority=authorityFor(entry,requestInput);return adapter({...input,receiverAuthority:authority.envelope,receiverRequest:authority.request});
  }])));
  return { events, db, transport, workspace, token, adapters, syntheticAdapters, authorityFor };
}

export async function runOffline() {
  const fixture = createOfflineFixture(); const evidence = [];
  for (const entry of cases) {
    const capability = blackspireCapabilityRegistry.get(entry.id);
    const before = fixture.events.length;
    const validatedInput=validateCapabilityInput(capability,entry.input),authority=fixture.authorityFor(entry,validatedInput);
    const boundAdapters=Object.freeze(Object.fromEntries(Object.entries(fixture.adapters).map(([name,adapter])=>[name,(input)=>adapter({...input,receiverAuthority:authority.envelope,receiverRequest:authority.request})])));
    const result = validateCapabilityOutput(capability, await capability.execute({ adapters: boundAdapters, workspace: { id: fixture.workspace }, signal: AbortSignal.timeout(2000) }, validatedInput));
    const count = entry.collection ? result[entry.collection].length : 1;
    assert.ok(count > 0 && count <= 5, 'missing or excessive synthetic witness');
    if (entry.id === 'deal.analysis.get') { assert.equal(result.found, true); assert.equal(result.maximumAllowableOffer, 150000); }
    if (entry.id === 'nexus.enrichment.status') assert.equal(result.source, 'nexus_contacts');
    const successEvents = fixture.events.slice(before);
    for (const [workspace, token] of [['foreign-workspace', fixture.token], [fixture.workspace, 'invalid-credential']]) {
      const beforeDenial = fixture.events.length;
      const response = await fixture.transport(`https://offline.invalid${entry.route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ ...entry.input, workspaceId: workspace }) });
      assert.equal(response.status, 404);
      assert.equal(fixture.events.slice(beforeDenial).filter((event) => event.kind !== 'route_dispatch').length, 0);
    }
    assert.equal(successEvents.filter((event) => /attempt$/.test(event.kind)).length, 0);
    if (entry.id === 'buyer.matches.search') assert.ok(successEvents.some((event) => event.table === 'BuyerProfile' && event.limit === 200));
    evidence.push({ capability: entry.id, route: entry.route, workspace: fixture.workspace, principal: 'synthetic scoped service',
      permission: capability.requiredPermissions, transport: 'in-process actual HTTP adapter and route', boundedResultCount: count,
      crossWorkspaceDenial: 'PASS', invalidCredentialDenial: 'PASS', crossOwnerDenial: 'UNVERIFIED: requires command authority and owner/job witnesses',
      observedFixtureMutationAttempts: 0, mutationDelta: 0, status: 'PASS_OFFLINE_CONTRACT' });
  }
  return { schema: 1, scope: 'offline route contract with synthetic dependencies', productionReady: false,
    routeSourceDigest: createHash('sha256').update(cases.map((entry) => read(`app${entry.route}/route.ts`)).join('\n')).digest('hex'),
    paidProviderCalls: 0, enrichmentWrites: 0, evidence,
    limitations: ['No API/worker lifecycle exercised; durable dispatch is covered separately by authority evidence', 'No live credentials, owner/job isolation witnesses, database observer, or frontend deployment identity',
      'Database fixture observes only supplied dependency calls; not a production mutation observer',
      'No production supervisor, lock, reconciliation, generation fence or cleanup acceptance'] };
}
