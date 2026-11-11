import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTradeReadiness } from '../market-scanner.mjs';

const candles = (step, now) => Array.from({ length: 80 }, (_, index) => { const c = 100 + index * step; return { t: now - (80 - index) * 3_600_000, o: c - step, h: c + 1, l: c - 1, c, v: 100 }; });

test('reports concrete blockers when a dataset cannot produce a plan', () => {
  const now = Date.now(); const series = Object.fromEntries(['15', '60', '240', 'D'].map(tf => [tf, candles(-.1, now)]));
  const result = assessTradeReadiness('TESTUSDT', series, now, { turnover24h: 20_000_000, lastPrice: 95 });
  assert.equal(result.plan, null); assert.equal(result.status, 'watch'); assert.ok(result.blocking.length > 0); assert.ok(result.diagnostics.failed.length > 0);
});

test('refuses incomplete candle history', () => {
  const result = assessTradeReadiness('TESTUSDT', { 15: [], 60: [], 240: [], D: [] }, Date.now(), {});
  assert.equal(result.status, 'insufficient'); assert.match(result.blocking[0], /Недостатньо/);
});
