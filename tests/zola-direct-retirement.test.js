import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

function load(relative, symbols, context = {}) {
  const source = fs.readFileSync(new URL(`../frontend/src/${relative}`, import.meta.url), 'utf8')
    .replace(/^import[^;]+;\s*/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(`${stripTypeScriptTypes(source)}\n({${symbols}})`, context);
}
const json = (body, options = {}) => ({ body, status: options.status ?? 200 });
function modeGuard(mode) {
  return load('lib/buyer-scoped-dispatch.ts', 'scopedBuyerWriterEnabled', {
    Error,
    process: { env: mode === undefined ? {} : { BUYER_WRITER_MODE: mode } },
  }).scopedBuyerWriterEnabled;
}

test('Buyer dispatch accepts only explicit scoped mode; missing mode never enables legacy transport', () => {
  for (const mode of [undefined, '', 'legacy', 'SCOPED', ' scoped', 'scoped ', 'false']) {
    assert.throws(modeGuard(mode), /scoped dispatch failed/);
  }
  assert.equal(modeGuard('scoped')(), true);
});

test('closed Buyer mode denies all three POSTs before body, activity, database or dispatch', async () => {
  for (const mode of [undefined, '', 'legacy']) {
    for (const route of ['search-jobs/route.ts', 'search-jobs/[id]/trigger/route.ts', 'deal-engine/launch-buyer-search/route.ts']) {
      const effects = [];
      const unexpected = label => () => { effects.push(label); throw new Error('unexpected work'); };
      const { POST } = load(`app/api/${route}`, 'POST', {
        performance, Error, NextResponse: { json },
        scopedBuyerWriterEnabled: modeGuard(mode),
        guardSignedInApi: async () => null,
        guardAdminApiContext: async () => ({ operatorId: 'owner', role: 'admin' }),
        guardBetaAction: unexpected('beta_activity'),
        captureBuyerDispatchAuthority: unexpected('capture'),
        createSearchJob: unexpected('insert'), getSearchJobById: unexpected('read'),
        triggerBuyerEngineWorkflow: unexpected('dispatch'), launchBuyerSearchFromDeal: unexpected('launch'),
        after: unexpected('after'), getBuyerEngineEnvStatus: () => ({}),
      });
      const result = await POST({ json: unexpected('body') }, { get params() { return unexpected('params')(); } });
      assert.equal(result.status, 500, `${route} ${mode}`);
      assert.match(result.body.error, /scoped dispatch failed/);
      assert.deepEqual(effects, []);
    }
  }
});

test('anonymous Buyer creation retains authentication denial before configuration and beta activity', async () => {
  const denial = { status: 401 };
  const { POST } = load('app/api/search-jobs/route.ts', 'POST', {
    performance, guardSignedInApi: async () => denial,
    scopedBuyerWriterEnabled: () => { assert.fail('mode must follow authentication'); },
  });
  assert.equal(await POST({}), denial);
});

test('retired Nexus trace denies anonymous and authenticated callers without consuming input or provider work', async () => {
  for (const authenticated of [false, true]) {
    let calls = 0;
    const forbidden = () => { calls++; throw new Error('provider must never run'); };
    const { POST } = load('app/api/nexus/trace/route.ts', 'POST', {
      NextResponse: { json }, guardAdminApi: async () => authenticated ? null : { status: 401 },
      getNexusSnapshot: forbidden, runNexusSkipTrace: forbidden, fetch: forbidden,
    });
    assert.equal((await POST({ json: forbidden })).status, authenticated ? 410 : 401);
    assert.equal(calls, 0);
  }
});
