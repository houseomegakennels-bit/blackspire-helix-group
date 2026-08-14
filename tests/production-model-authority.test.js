import test from 'node:test';
import assert from 'node:assert/strict';

process.env.BLACKSPIRE_RUNTIME_MODE ||= 'mock';

const { selectProvider, executeProviderRequest, callOpenAI, callAnthropic } = await import('../packages/providers/providers.js');

// The server decides the production model in Hermes (BLACKSPIRE_PRODUCTION_MODEL).
// These tests pin the rest of that authority chain: the model must survive
// provider selection and must be the model actually sent to the provider, so a
// worker-local OPENAI_MODEL/ANTHROPIC_MODEL default can never quietly replace it.

function withEnv(values, fn) {
  const prior = {};
  for (const [key, value] of Object.entries(values)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return fn(); } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

async function captureOutboundBody(fn) {
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => ({ output_text: '{"artifacts":[],"summary":"ok"}', content: [{ text: '{"artifacts":[],"summary":"ok"}' }] }) };
  };
  try { await fn(); } finally { globalThis.fetch = realFetch; }
  return captured;
}

test('provider selection preserves the server-chosen model for every real provider', () => {
  withEnv({ BLACKSPIRE_RUNTIME_MODE: 'mock', BLACKSPIRE_PROVIDER_MODE: undefined, HERMES_TEST_PROVIDER: undefined, OPENAI_API_KEY: 'test-openai', ANTHROPIC_API_KEY: 'test-anthropic' }, () => {
    const policy = { preferred: ['openai', 'anthropic', 'manual'] };
    assert.equal(selectProvider(policy, { requested: 'openai', model: 'server-openai-model' }).model, 'server-openai-model');
    assert.equal(selectProvider(policy, { requested: 'anthropic', model: 'server-anthropic-model' }).model, 'server-anthropic-model');
  });
});

test('the server-chosen model is the model actually sent to OpenAI', async () => {
  const body = await withEnv({ OPENAI_API_KEY: 'test-openai', OPENAI_MODEL: 'worker-local-default' }, () => captureOutboundBody(
    () => executeProviderRequest({ selected: { provider: 'openai', mode: 'api', model: 'server-authoritative-model' }, packet: { request: 'x' } }),
  ));
  assert.equal(body.model, 'server-authoritative-model');
});

test('the server-chosen model is the model actually sent to Anthropic', async () => {
  const body = await withEnv({ ANTHROPIC_API_KEY: 'test-anthropic', ANTHROPIC_MODEL: 'worker-local-default' }, () => captureOutboundBody(
    () => executeProviderRequest({ selected: { provider: 'anthropic', mode: 'api', model: 'server-authoritative-model' }, packet: { request: 'x' } }),
  ));
  assert.equal(body.model, 'server-authoritative-model');
});

test('without a server model the configured worker default still applies', async () => {
  const body = await withEnv({ OPENAI_API_KEY: 'test-openai', OPENAI_MODEL: 'worker-local-default' }, () => captureOutboundBody(
    () => executeProviderRequest({ selected: { provider: 'openai', mode: 'api', model: null }, packet: { request: 'x' } }),
  ));
  assert.equal(body.model, 'worker-local-default');
});

test('the executed model is reported back on the provider result', async () => {
  let result;
  await withEnv({ OPENAI_API_KEY: 'test-openai', OPENAI_MODEL: 'worker-local-default' }, () => captureOutboundBody(
    async () => { result = await executeProviderRequest({ selected: { provider: 'openai', mode: 'api', model: 'server-authoritative-model' }, packet: { request: 'x' } }); },
  ));
  assert.equal(result.model, 'server-authoritative-model');
  assert.equal(result.usage.model, 'server-authoritative-model');
});

test('callOpenAI and callAnthropic still refuse to run unconfigured', async () => {
  await withEnv({ OPENAI_API_KEY: undefined }, async () => {
    assert.equal((await callOpenAI({ prompt: 'x' })).ok, false);
  });
  await withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
    assert.equal((await callAnthropic({ prompt: 'x' })).ok, false);
  });
});
