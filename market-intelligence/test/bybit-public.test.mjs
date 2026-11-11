import test from 'node:test';
import assert from 'node:assert/strict';
import { createBybitPublicClient } from '../bybit-public.mjs';

test('retries a Bybit 429 and respects Retry-After', async () => {
  let calls = 0; const delays = [];
  const client = createBybitPublicClient({ maxAttempts: 3, sleep: async ms => { delays.push(ms); }, fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '1' } }) : new Response(JSON.stringify({ retCode: 0, result: { list: [] } }));
  } });
  assert.deepEqual(await client.call('/v5/market/tickers', { category: 'linear' }), { list: [] });
  assert.equal(calls, 2); assert.deepEqual(delays, [1000]);
});

test('does not retry an invalid Bybit request', async () => {
  let calls = 0; const client = createBybitPublicClient({ sleep: async () => assert.fail('must not sleep'), fetchImpl: async () => { calls += 1; return new Response('', { status: 400 }); } });
  await assert.rejects(() => client.call('/v5/market/kline'), /Bybit HTTP 400/);
  assert.equal(calls, 1);
});
