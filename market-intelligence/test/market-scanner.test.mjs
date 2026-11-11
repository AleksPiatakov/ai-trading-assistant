import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTradeReadiness } from '../market-scanner.mjs';
import { compareWatchCandidates } from '../market-scanner.mjs';

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

test('never creates a plan until every trend, momentum, cost, liquidity and price gate passes', () => {
  const now = Date.UTC(2026, 10, 11, 12);
  const aligned = tf => Array.from({ length: 80 }, (_, index) => {
    const c = index < 60 ? 100 + index * .7 : 142 + (index - 60) * .45;
    return { t: now - (80 - index) * ({ 15: 900_000, 60: 3_600_000, 240: 14_400_000, D: 86_400_000 }[tf]), o: c - .2, h: c + .7, l: c - .7, c, v: index === 79 ? 150 : 100 };
  });
  const series = Object.fromEntries(['15', '60', '240', 'D'].map(tf => [tf, aligned(tf)]));
  // A contradictory daily trend is enough to prohibit a finished plan even
  // when price, liquidity and the 1h/4h setup otherwise look attractive.
  series.D = candles(-.1, now);
  const result = assessTradeReadiness('TESTUSDT', series, now, { turnover24h: 20_000_000, lastPrice: series['60'].at(-1).c });
  assert.equal(result.plan, null);
  assert.equal(result.status, 'watch');
  assert.ok(result.blocking.some(item => item.includes('Денний тренд')));
  assert.ok(result.diagnostics.failed.includes('daily'));
});

test('ranks market confirmation ahead of hypothetical reward and raw turnover', () => {
  const candidates = [
    { symbol: 'HIGH_RR', state: 'watch', readinessPassed: 3, turnover24h: 999_000_000, marketQuality: { trendChecks: 1, passed: 2 }, tradeFeasibility: { priceAligned: true, liquidityOk: true, validLevels: true, netRR: 9 } },
    { symbol: 'CONFIRMED', state: 'watch', readinessPassed: 5, turnover24h: 20_000_000, marketQuality: { trendChecks: 4, passed: 5 }, tradeFeasibility: { priceAligned: true, liquidityOk: true, validLevels: true, netRR: 1.6 } }
  ];
  assert.deepEqual(candidates.sort(compareWatchCandidates).map(item => item.symbol), ['CONFIRMED', 'HIGH_RR']);
});
