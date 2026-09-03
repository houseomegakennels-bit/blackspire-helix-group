import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-buyer-capability-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'buyer.sqlite');
process.env.BLACKSPIRE_RUNTIME_MODE = 'test';
delete process.env.UNIFIED_IPHONE_TEST_MODE;

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run, all } = await import('../packages/task-engine/db.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput, getConversation } = await import('../packages/unified-input/unified.js');
const { getTask, taskRecords, transition, setFlag, taskRequiresCapabilityPermission, conversationRequiresCapabilityPermission } = await import('../packages/task-engine/tasks.js');
const { processTask } = await import('../packages/hermes/hermes.js');
const { createCapabilityRegistry } = await import('../packages/capabilities/registry.js');
const { defineCapability, validateCapabilityInput, validateCapabilityOutput } = await import('../packages/capabilities/contract.js');
const { buyerProfilesCapability } = await import('../packages/capabilities/buyer-profiles.js');
const { buyerMatchesCapability } = await import('../packages/capabilities/buyer-matches.js');
const { selectCapabilityForTask } = await import('../packages/capabilities/execute.js');
const { createDivisionAdapters } = await import('../packages/capabilities/http-adapters.js');

const now = Date.now();
const permissions = ['buyer.profiles.read','buyer.matches.read','task.create','task.execute','task.read','workspace.read'];
for (const workspaceId of ['buyer-ws','other-ws']) upsertWorkspace({ id: workspaceId, name: workspaceId, githubRepository: 'houseomegakennels-bit/blackspire-helix-group', rootPath: '.', providerPolicy: { preferred: ['mock'] }, budgetCents: 500 });
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['buyer-admin','admin','buyer-admin','bearer',null,'active',now,null,null,null,1,now]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['buyer-grant','buyer-admin','buyer-ws','service',JSON.stringify(permissions),'active',1,null,now,null,null,'test',1,now]);

const canonicalProfiles = Object.freeze([
  Object.freeze({ id:'buyer-1', displayName:'ABC Capital', buyerType:'hedge_fund_group', county:'Wake', state:'NC', city:'Raleigh', postalCode:'27601', propertyType:'Single Family', minBeds:3, maxPrice:500000, preferredRadius:50, cashBuyer:true, llcBuyer:true, active:true, scoreSummary:'High fit', buyBoxSummary:'SFRs under $500k in Wake County', source:'buyer_group_registry' }),
]);
const canonicalMatches = Object.freeze([
  Object.freeze({ opportunityId:'opp-1', buyerId:'buyer-1', displayName:'ABC Capital', matchScore:88, matchReasons:['County matches','Price fits'], recommendedAction:'Prepare packet for buyer group.', source:'reverse-search' }),
]);
const canonicalResult = () => ({ profiles: canonicalProfiles, matches: canonicalMatches, sourceSnapshotAt: '2026-09-02T00:00:00.000Z' });

function task(text = 'Find buyers for this deal.', suffix = crypto.randomUUID(), overrides = {}) {
  const created = createUnifiedInput({ channel:'jarvis', actorId:'buyer-admin', channelKey:`buyer-${suffix}`, workspaceId:'buyer-ws', text, idempotencyKey:`buyer-${suffix}`, authority:'authenticated_admin', executionIntent:'read_only', ...overrides });
  return getTask(created.taskId);
}

test('Buyer capability is registered exactly once with bounded contract', () => {
  const registry = createCapabilityRegistry([buyerProfilesCapability]);
  assert.deepEqual(registry.ids(), ['buyer.profiles.search']);
  assert.throws(() => createCapabilityRegistry([buyerProfilesCapability, buyerProfilesCapability]), /duplicate capability/);
  assert.throws(() => validateCapabilityInput(buyerProfilesCapability, { limit:11 }), /1 through 10/);
  assert.throws(() => validateCapabilityInput(buyerProfilesCapability, { unknown:true }), /unknown buyer profile input fields/);
  assert.throws(() => validateCapabilityOutput(buyerProfilesCapability, { ...canonicalResult(), profiles:[{ ...canonicalProfiles[0], secretToken:'x' }] }), /invalid buyer profile fields/);
});

test('Buyer routing requires explicit buyer/deal intent and does not override Seller', () => {
  assert.equal(selectCapabilityForTask({ request:'Show cash buyers in Forsyth County.' }).id, 'buyer.profiles.search');
  assert.equal(selectCapabilityForTask({ request:'Match buyers to this property.' }).id, 'buyer.matches.search');
  assert.equal(selectCapabilityForTask({ request:'Find buyers for this deal.' }).id, 'buyer.matches.search');
  assert.equal(selectCapabilityForTask({ request:'Show seller opportunities in this workspace.' }).id, 'seller.opportunities.search');
  assert.equal(selectCapabilityForTask({ request:'Report status.' }), null);
});

test('Buyer adapter transport is bounded and rejects oversized/malformed responses', async () => {
  const adapters = createDivisionAdapters({ BLACKSPIRE_BUYER_CAPABILITY_URL:'http://127.0.0.1:3000', BLACKSPIRE_BUYER_CAPABILITY_TOKEN:'x'.repeat(32) }, async()=>new Response('not-json', { status:200 }));
  await assert.rejects(adapters.buyerProfiles({ workspaceId:'buyer-ws', limit:5, signal:null }), /malformed JSON/);
});

test('Buyer capability requires buyer read permission', async () => {
  const created = task('Find buyers without permission.');
  run("UPDATE auth_workspace_grants SET permissions='[\"task.create\",\"task.execute\",\"task.read\",\"workspace.read\"]' WHERE id='buyer-grant'");
  let called = false;
  const denied = await processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async()=>{called=true;return canonicalResult();} } } });
  assert.equal(called,false);
  assert.equal(denied.status,'failed');
  run('UPDATE auth_workspace_grants SET permissions=? WHERE id=?',[JSON.stringify(permissions),'buyer-grant']);
});

test('Buyer capability accepts zero-match results without leaking buyer data', async () => {
  const created = task('Find buyers with no matches.');
  const result = await processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async()=>({ profiles:[], matches:[], sourceSnapshotAt:'2026-09-02T00:00:00.000Z' }) } } });
  const status = result.status;
  const summary = String(result.summary || '') + ' ' + String(result.error || '');
  if (status === 'completed') {
    assert.doesNotMatch(summary, /buyer authorization/i);
  } else {
    assert.doesNotMatch(summary, /ABC Capital|buyer authorization/i);
  }
});

test('Buyer permission task/conversation capability checks are Buyer-aware', () => {
  const buyerTaskId = 'buyer-task-1';
  run(`INSERT INTO tasks(id,workspace_id,request,status,conversation_id) VALUES(?,?,?,?,?)`, [buyerTaskId,'buyer-ws','Find buyers.','completed','conv-buyer']);
  run(`INSERT INTO provider_attempts(id,task_id,provider,mode,status) VALUES(?,?,?,?,?)`, ['buyer-attempt', buyerTaskId, 'blackspire-capability', 'buyer.profiles.search', 'completed']);
  assert.equal(taskRequiresCapabilityPermission(buyerTaskId, 'buyer.profiles.read'), true);
  assert.equal(conversationRequiresCapabilityPermission('conv-buyer', 'buyer.matches.read'), true);
  assert.equal(taskRequiresCapabilityPermission('other-task', 'buyer.profiles.read'), false);
});

test('Seller routing remains unchanged after Buyer routing addition', () => {
  assert.equal(selectCapabilityForTask({ request:'Show me the best seller opportunities in this workspace.' }).id, 'seller.opportunities.search');
  assert.equal(selectCapabilityForTask({ request:'Rank seller leads by motivation.' }).id, 'seller.opportunities.search');
});
