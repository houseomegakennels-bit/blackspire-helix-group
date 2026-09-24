import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-buyer-cancel-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'buyer-cancel.sqlite');
process.env.BLACKSPIRE_RUNTIME_MODE = 'test';
delete process.env.UNIFIED_IPHONE_TEST_MODE;

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run, all } = await import('../packages/task-engine/db.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask, transition, setFlag, taskRecords } = await import('../packages/task-engine/tasks.js');
const { processTask } = await import('../packages/hermes/hermes.js');

const permissions = ['buyer.profiles.read','buyer.matches.read','task.create','task.execute','task.read','workspace.read'];
upsertWorkspace({ id: 'buyer-ws', name: 'buyer-ws', githubRepository: 'houseomegakennels-bit/blackspire-helix-group', rootPath: '.', providerPolicy: { preferred: ['mock'] }, budgetCents: 500 });
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['buyer-admin','admin','buyer-admin','bearer',null,'active',Date.now(),null,null,null,1,Date.now()]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['buyer-grant','buyer-admin','buyer-ws','service',JSON.stringify(permissions),'active',1,null,Date.now(),null,null,'test',1,Date.now()]);

function task(text, overrides = {}) {
  const created = createUnifiedInput({ channel:'jarvis', actorId:'buyer-admin', channelKey:`cancel-${crypto.randomUUID()}`, workspaceId:'buyer-ws', text, idempotencyKey:`cancel-${crypto.randomUUID()}`, authority:'authenticated_admin', executionIntent:'read_only', ...overrides });
  return getTask(created.taskId);
}

const buyerResult = {
  profiles: [{ id:'buyer-1', displayName:'ABC Capital', buyerType:'cash buyer', county:'Wake', state:'NC', city:null, postalCode:null, propertyType:null, minBeds:null, maxPrice:null, preferredRadius:null, cashBuyer:true, llcBuyer:true, active:true, scoreSummary:null, buyBoxSummary:null, source:'BuyerProfile' }],
  matches: [], sourceSnapshotAt:'2026-09-02T00:00:00.000Z',
};

function pendingAdapter(cooperative) {
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  let signal;
  const abort = () => response.reject(new Error('aborted'));
  return {
    started: started.promise,
    response: response.promise,
    buyerProfiles({ signal: suppliedSignal }) {
      signal = suppliedSignal;
      if (cooperative) signal.addEventListener('abort', abort, { once: true });
      started.resolve();
      // Return synchronously: no suspension gap may leave a rejectable response unobserved.
      return response.promise;
    },
    release() {
      signal?.removeEventListener('abort', abort);
      response.resolve(buyerResult);
    },
    aborted: () => signal?.aborted,
  };
}

function assertNoDisclosure(taskId, emergency) {
  const persisted = getTask(taskId);
  assert.equal(persisted.status, 'cancelled');
  assert.equal(persisted.summary, '');
  assert.doesNotMatch(JSON.stringify(taskRecords(taskId)), /ABC Capital/);
  const attempts = all('SELECT * FROM provider_attempts WHERE task_id=?', [taskId]);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, emergency ? 'completed' : 'outcome_unknown');
  if (emergency) assert.deepEqual(JSON.parse(attempts[0].response_packet), { discarded: true });
  assert.doesNotMatch(JSON.stringify(attempts), /ABC Capital/);
}

for (const emergency of [false, true]) {
  for (const cooperative of emergency ? [false] : [true, false]) {
    test(`${emergency ? 'emergency stop' : 'cancellation'} fences ${cooperative ? 'abort rejection' : 'non-cooperative late Buyer completion'}`, async () => {
      const created = task('Find buyers with cancellation race.');
      const adapter = pendingAdapter(cooperative);
      const pending = processTask(created, { capabilityOptions: { adapters: { buyerProfiles: adapter.buyerProfiles } } });
      await adapter.started;
      try {
        assert.equal(getTask(created.id).status, 'running');
        if (emergency) {
          setFlag('emergency_stop', 'active');
          // The persisted flag is checked when the adapter returns; setFlag itself does not abort.
          adapter.release();
        }
        else transition(created.id, 'cancelled', { error: 'operator cancelled' });
        const result = await pending;
        assert.equal(result.status, 'cancelled');
        assert.equal(adapter.aborted(), true);
        assertNoDisclosure(created.id, emergency);
        if (!cooperative) {
          adapter.release();
          await adapter.response;
          assertNoDisclosure(created.id, emergency);
        }
      } finally {
        adapter.release();
        if (emergency) setFlag('emergency_stop', 'inactive');
      }
    });
  }
}
