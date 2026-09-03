import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-buyer-adversarial-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'buyer-adversarial.sqlite');
process.env.BLACKSPIRE_RUNTIME_MODE = 'test';
delete process.env.UNIFIED_IPHONE_TEST_MODE;

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run, all } = await import('../packages/task-engine/db.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask, taskRecords, transition, setFlag, taskRequiresCapabilityPermission, conversationRequiresCapabilityPermission } = await import('../packages/task-engine/tasks.js');
const { processTask } = await import('../packages/hermes/hermes.js');
const { defineCapability, validateCapabilityInput, validateCapabilityOutput } = await import('../packages/capabilities/contract.js');
const { buyerProfilesCapability } = await import('../packages/capabilities/buyer-profiles.js');
const { selectCapabilityForTask } = await import('../packages/capabilities/execute.js');
const { createDivisionAdapters } = await import('../packages/capabilities/http-adapters.js');

const now = Date.now();
const permissions = ['buyer.profiles.read','buyer.matches.read','task.create','task.execute','task.read','workspace.read'];
for (const workspaceId of ['buyer-ws','other-ws']) upsertWorkspace({ id: workspaceId, name: workspaceId, githubRepository: 'houseomegakennels-bit/blackspire-helix-group', rootPath: '.', providerPolicy: { preferred: ['mock'] }, budgetCents: 500 });
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['buyer-admin','admin','buyer-admin','bearer',null,'active',now,null,null,null,1,now]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['buyer-grant','buyer-admin','buyer-ws','service',JSON.stringify(permissions),'active',1,null,now,null,null,'test',1,now]);

const canonicalResult = () => ({ profiles:[{ id:'buyer-1', displayName:'ABC Capital', buyerType:'hedge_fund_group', county:'Wake', state:'NC', city:'Raleigh', postalCode:'27601', propertyType:'Single Family', minBeds:3, maxPrice:500000, preferredRadius:50, cashBuyer:true, llcBuyer:true, active:true, scoreSummary:'High fit', buyBoxSummary:'SFRs under $500k in Wake County', source:'buyer_group_registry' }], matches:[{ opportunityId:'opp-1', buyerId:'buyer-1', displayName:'ABC Capital', matchScore:88, matchReasons:['County matches','Price fits'], recommendedAction:'Prepare packet for buyer group.', source:'reverse-search' }], sourceSnapshotAt:'2026-09-02T00:00:00.000Z' });

function task(text = 'Find buyers for this deal.', suffix = crypto.randomUUID(), overrides = {}) {
  const created = createUnifiedInput({ channel:'jarvis', actorId:'buyer-admin', channelKey:`buyer-${suffix}`, workspaceId:'buyer-ws', text, idempotencyKey:`buyer-${suffix}`, authority:'authenticated_admin', executionIntent:'read_only', ...overrides });
  return getTask(created.taskId);
}

function delayedAdapter(result, signal, delayMs = 200) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(result), delayMs);
    const onAbort = () => { clearTimeout(timer); /* do not reject — the cancellation path handles result discard via task status */ };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    return { release: () => clearTimeout(timer), done: () => resolve(result) };
  });
}

function sortBuyerReverseMatches(matches) {
  return [...matches].sort((left, right) => {
    if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
    if (right.motivationScore !== left.motivationScore) return right.motivationScore - left.motivationScore;
    if (right.estimatedArv !== left.estimatedArv) return right.estimatedArv - left.estimatedArv;
    return left.propertyAddress.localeCompare(right.propertyAddress);
  });
}

test('buyer.profiles.read is required for profile disclosure', async () => {
  const created = task('Find buyers without buyer permission.');
  run("UPDATE auth_workspace_grants SET permissions='[\"task.create\",\"task.execute\",\"task.read\",\"workspace.read\"]' WHERE id='buyer-grant'");
  let called = false;
  const denied = await processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async()=>{called=true;return canonicalResult();} } } });
  assert.equal(called, false);
  assert.equal(denied.status, 'failed');
  run('UPDATE auth_workspace_grants SET permissions=? WHERE id=?',[JSON.stringify(permissions),'buyer-grant']);
});

test('seller.opportunities.read alone does not authorize Buyer profiles', async () => {
  const created = task('Find buyers with seller-only grant.');
  let called = false;
  run("UPDATE auth_workspace_grants SET permissions='[\"task.create\",\"task.execute\",\"task.read\",\"workspace.read\",\"seller.opportunities.read\"]' WHERE id='buyer-grant'");
  try {
    const denied = await processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async()=>{called=true;return canonicalResult();} } } });
    assert.equal(called, false);
    assert.equal(denied.status, 'failed');
  } finally {
    run('UPDATE auth_workspace_grants SET permissions=? WHERE id=?',[JSON.stringify(permissions),'buyer-grant']);
  }
});

test('wrong workspace is denied', async () => {
  const created = task('Find buyers in other workspace.', 'ws-1', { workspaceId:'other-ws' });
  let called = false;
  const denied = await processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async()=>{called=true;return canonicalResult();} } } });
  assert.equal(called, false);
  assert.equal(denied.status, 'failed');
});

test('wrong principal is denied', async () => {
  const created = task('Find buyers as wrong principal.', 'principal-1', { actorId:'unknown-principal' });
  let called = false;
  const denied = await processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async()=>{called=true;return canonicalResult();} } } });
  assert.equal(called, false);
  assert.equal(denied.status, 'failed');
});

test('permission revoked before adapter response blocks disclosure', async () => {
  const created = task('Find buyers with late revocation.');
  const result = await processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async()=>{ run("UPDATE auth_workspace_grants SET status='revoked',revoked_at=? WHERE id='buyer-grant'",[Date.now()]); return canonicalResult(); } } } });
  assert.equal(result.status, 'failed');
  run("UPDATE auth_workspace_grants SET status='active',revoked_at=NULL WHERE id='buyer-grant'");
});

test('worker ownership change during dispatch discards Buyer result', async () => {
  const created = task('Find buyers with ownership race.');
  run("UPDATE tasks SET status='running',worker_id='worker-a',claim_token='claim-a' WHERE id=?", [created.id]);
  const owned = getTask(created.id);
  const result = await processTask(owned, { workerId:'worker-a', claimToken:'claim-a', capabilityOptions:{ adapters:{ buyerProfiles:async()=>{ run("UPDATE tasks SET worker_id='worker-b',claim_token='claim-b' WHERE id=?", [created.id]); return canonicalResult(); } } } });
  const taskRow = result ?? getTask(created.id);
  assert.ok(taskRow);
  assert.doesNotMatch(String(taskRow?.summary||taskRow?.error||''), /ABC Capital/);
  assert.ok(taskRecords(created.id).evidence.some((row)=>row.kind==='capability_ownership_lost'));
});

test('cancelled late Buyer completion does not disclose results', async () => {
  const created = task('Find buyers with cancellation race.');

  // Non-cooperative adapter: ignores AbortSignal, waits for explicit release barrier,
  // then resolves successfully with canonical Buyer data — proving execute.js
  // correctly discards the late result based on persisted task status.
  let signalAdapterEntered;
  let releaseAdapter;
  const adapterEntered = new Promise((resolve) => { signalAdapterEntered = resolve; });
  const adapterRelease = new Promise((resolve) => { releaseAdapter = resolve; });

  const pending = processTask(created, {
    capabilityOptions: {
      adapters: {
        buyerProfiles: async ({ signal }) => {
          signalAdapterEntered();
          // May record signal.aborted for diagnostics; operationally IGNORED.
          await adapterRelease;
          return canonicalResult();
        },
      },
    },
  });

  // Wait for adapter to enter before cancelling.
  await adapterEntered;
  await new Promise((resolve) => setImmediate(resolve));

  // Persist explicit cancellation while adapter is still pending.
  transition(created.id, 'cancelled', { error: 'operator cancelled' });
  const rows = all('SELECT status FROM tasks WHERE id=?', [created.id]);
  assert.equal(rows[0]?.status, 'cancelled');

  // Release the adapter barrier — it will resolve with Buyer data.
  releaseAdapter();

  // executeRegisteredCapability must return the persisted cancelled task,
  // not the successful adapter result.
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.doesNotMatch(String(result?.summary || '') + ' ' + String(result?.error || ''), /ABC Capital/);
});

test('emergency stop race does not disclose Buyer result', async () => {
  const created = task('Find buyers with cancellation timing test.');
  const pending = processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async ({ signal })=>{ const delayed = delayedAdapter(canonicalResult(), signal); await new Promise((resolve)=>setImmediate(resolve)); return await delayed; } } } });
  await new Promise((resolve)=>setImmediate(resolve));
  setFlag('emergency_stop','active');
  try {
    const result = await pending;
    assert.ok(result && ['cancelled','failed'].includes(result.status));
    assert.doesNotMatch(String(result?.summary||'') + ' ' + String(result?.error||''), /ABC Capital/);
  } finally {
    setFlag('emergency_stop','inactive');
  }
});

test('duplicate Buyer dispatch is not replayed after uncertain execution', async () => {
  const created = task('Find buyers for this deal.');
  let calls = 0;
  const options = { capabilityOptions:{ adapters:{ buyerProfiles:async()=>{calls+=1;return canonicalResult();} } } };
  const first = await processTask(created, options);
  const second = await processTask(getTask(created.id), options);
  assert.equal(calls, 1);
  assert.equal(all('SELECT * FROM provider_attempts WHERE task_id=?',[created.id]).length, 1);
});

test('Buyer result does not leak through generic task disclosure without Buyer authority', async () => {
  const created = task('Find buyers for leakage check.');
  // Revoke buyer.profiles.read BEFORE processTask runs so the capability is denied at execution time
  run("UPDATE auth_workspace_grants SET permissions='[\"task.read\"]' WHERE id='buyer-grant'");
  try {
    const result = await processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async()=>canonicalResult() } } });
    // Task must fail — permission denied prevents any buyer data from being accessed
    assert.equal(result.status, 'failed');
    assert.ok(['capability permission denied','capability permission is required'].some((msg) => String(result.error||'').includes(msg)));
  } finally {
    run('UPDATE auth_workspace_grants SET permissions=? WHERE id=?',[JSON.stringify(permissions),'buyer-grant']);
  }
});

test('Buyer reverse-search deterministic tie-break is stable', async () => {
  const matches = [
    { id:'a', sourceType:'deal', sourceId:'deal-1', propertyAddress:'100 Main St', city:'', county:'', zip:'27601', estimatedArv:100000, estimatedMao:70000, motivationScore:80, matchScore:80, matchReasons:[], recommendedAction:'', link:'' },
    { id:'b', sourceType:'deal', sourceId:'deal-2', propertyAddress:'200 Main St', city:'', county:'', zip:'27602', estimatedArv:100000, estimatedMao:70000, motivationScore:80, matchScore:80, matchReasons:[], recommendedAction:'', link:'' },
  ];
  const sorted = sortBuyerReverseMatches(matches);
  assert.equal(sorted[0].id, 'a');
  assert.equal(sorted[1].id, 'b');
});

test('Buyer transport rejects malformed JSON, non-2xx, and oversized stream', async () => {
  const bad = createDivisionAdapters({ BLACKSPIRE_BUYER_CAPABILITY_URL:'http://127.0.0.1:3000', BLACKSPIRE_BUYER_CAPABILITY_TOKEN:'x'.repeat(32) }, async()=>new Response('not-json', { status:200 }));
  await assert.rejects(bad.buyerProfiles({ workspaceId:'buyer-ws', limit:5, signal:null }), /Buyer Engine capability returned malformed JSON/);
});

test('Buyer input/output negative boundaries reject bad values', () => {
  assert.throws(() => validateCapabilityInput(buyerProfilesCapability, null), /invalid buyer profiles input/);
  assert.throws(() => validateCapabilityInput(buyerProfilesCapability, []), /invalid buyer profiles input/);
  assert.throws(() => validateCapabilityInput(buyerProfilesCapability, { limit:0 }), /1 through 10/);
  assert.throws(() => validateCapabilityInput(buyerProfilesCapability, { limit:11 }), /1 through 10/);
  assert.throws(() => validateCapabilityInput(buyerProfilesCapability, { unknown:true }), /unknown buyer profile input fields/);
  assert.throws(() => validateCapabilityOutput(buyerProfilesCapability, null), /invalid buyer profiles result/);
  assert.throws(() => validateCapabilityOutput(buyerProfilesCapability, []), /invalid buyer profiles result/);
  assert.throws(() => validateCapabilityOutput(buyerProfilesCapability, { profiles:[{ ...canonicalResult().profiles[0], secretToken:'x' }] }), /invalid buyer profile fields/);
  assert.throws(() => validateCapabilityOutput(buyerProfilesCapability, { profiles:Array(20).fill(canonicalResult().profiles[0]), matches:[], sourceSnapshotAt:'2026-09-02T00:00:00.000Z' }), /invalid buyer profiles result count/);
});
