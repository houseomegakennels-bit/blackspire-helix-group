import test from 'node:test';
import assert from 'node:assert/strict';

process.env.BLACKSPIRE_DB_PATH = ':memory:';
const { telegramRequest, sendTelegramMessage } = await import('../apps/telegram/bot.js');

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('Telegram ok:false is a transport failure even with HTTP 200', async () => {
  await assert.rejects(
    telegramRequest('sendMessage', 'fixture', {
      maxAttempts: 1,
      fetchImpl: async () => response({ ok: false, error_code: 400, description: 'chat not found' }),
    }),
    /Telegram sendMessage failed: chat not found/,
  );
});

test('Telegram retries bounded transient failures and honors retry_after', async () => {
  let calls = 0;
  const waits = [];
  const result = await telegramRequest('sendMessage', 'fixture', {
    maxAttempts: 3,
    wait: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ ok: false, error_code: 429, description: 'rate limited', parameters: { retry_after: 2 } }, 429);
      if (calls === 2) throw new TypeError('temporary network failure');
      return response({ ok: true, result: { message_id: 7 } });
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 500]);
  assert.equal(result.result.message_id, 7);
});

test('Telegram does not retry permanent API failures', async () => {
  let calls = 0;
  await assert.rejects(telegramRequest('sendMessage', 'fixture', {
    maxAttempts: 3,
    fetchImpl: async () => { calls += 1; return response({ ok: false, error_code: 403, description: 'forbidden' }, 403); },
  }), /forbidden/);
  assert.equal(calls, 1);
});

test('Telegram requests install a bounded abort signal', async () => {
  let signal;
  await telegramRequest('getUpdates', 'fixture', {
    timeoutMs: 25,
    maxAttempts: 1,
    fetchImpl: async (_url, init) => { signal = init.signal; return response({ ok: true, result: [] }); },
  });
  assert.ok(signal instanceof AbortSignal);
});

test('chunked messages are delivered serially and preserve order', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = async (_url, init) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    bodies.push(JSON.parse(init.body).text);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return response({ ok: true, result: { message_id: bodies.length } });
  };
  try {
    await sendTelegramMessage('fixture', 1, `${'a'.repeat(3900)}${'b'.repeat(10)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(maxActive, 1);
  assert.deepEqual(bodies, ['a'.repeat(3900), 'b'.repeat(10)]);
});
