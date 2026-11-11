/** Read-only signal assessment. It never sends orders or uses credentials. */
const REQUIRED = ['15', '60', '240', 'D'];
const BAR_MS = { 15: 900_000, 60: 3_600_000, 240: 14_400_000, D: 86_400_000 };
const finite = Number.isFinite;
const ema = (xs, period) => {
  const alpha = 2 / (period + 1); let last = null;
  return xs.map(value => (last = last === null ? value : last + alpha * (value - last)));
};
function rsi(xs) {
  let up = 0; let down = 0;
  for (let i = 1; i <= 14; i += 1) { const change = xs[i] - xs[i - 1]; up += Math.max(0, change); down += Math.max(0, -change); }
  up /= 14; down /= 14;
  for (let i = 15; i < xs.length; i += 1) { const change = xs[i] - xs[i - 1]; up = (up * 13 + Math.max(0, change)) / 14; down = (down * 13 + Math.max(0, -change)) / 14; }
  return down === 0 ? (up === 0 ? 50 : 100) : 100 - 100 / (1 + up / down);
}
function analyze(candles, tf) {
  if (candles.length < 55) return null;
  const close = candles.map(candle => candle.c); const last = candles.at(-1);
  const e20 = ema(close, 20).at(-1); const e50 = ema(close, 50).at(-1); const e200 = candles.length >= 200 ? ema(close, 200).at(-1) : null;
  let direction = last.c > e20 && e20 > e50 ? 'up' : last.c < e20 && e20 < e50 ? 'down' : 'mixed';
  if (e200 && ((direction === 'up' && last.c < e200) || (direction === 'down' && last.c > e200))) direction = 'mixed';
  const fast = ema(close, 12); const slow = ema(close, 26); const histogram = fast.map((value, index) => value - slow[index]);
  const tr = [];
  for (let i = candles.length - 14; i < candles.length; i += 1) tr.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c)));
  const prior = candles.slice(-21, -1); const volumeBaseline = prior.reduce((sum, candle) => sum + candle.v, 0) / 20;
  return { tf, price: last.c, direction, rsi: rsi(close), macd: histogram.at(-1) - ema(histogram, 9).at(-1), atr: tr.reduce((sum, value) => sum + value, 0) / 14,
    support: Math.min(...prior.map(candle => candle.l)), resistance: Math.max(...prior.map(candle => candle.h)), relVolume: volumeBaseline > 0 ? last.v / volumeBaseline : null };
}
function framesFrom(series, asOf) {
  return Object.fromEntries(REQUIRED.map(tf => [tf, analyze((series[tf] || []).filter(candle => candle.t + BAR_MS[tf] <= asOf), tf)]));
}
export function assessTradeReadiness(symbol, series, asOf = Date.now(), options = {}) {
  const frames = framesFrom(series, asOf); const h1 = frames['60']; const h4 = frames['240']; const day = frames.D; const m15 = frames['15'];
  if (!REQUIRED.every(tf => frames[tf]?.price > 0)) return { status: 'insufficient', side: null, plan: null, blocking: ['Недостатньо закритих свічок для чотирьох таймфреймів'], checksPassed: null, checksTotal: 6 };
  const turnover = Number(options.turnover24h); const liquidityOk = finite(turnover) && turnover >= 10_000_000;
  const livePrice = Number(options.lastPrice); const livePriceKnown = finite(livePrice) && livePrice > 0;
  const maxDeviation = Math.max(.002, Math.min(.01, .5 * h1.atr / h1.price));
  const priceAligned = livePriceKnown && Math.abs(livePrice - h1.price) / h1.price <= maxDeviation;
  const directions = Object.values(frames).map(frame => frame.direction);
  const up = directions.filter(direction => direction === 'up').length; const down = directions.filter(direction => direction === 'down').length;
  const attentionSide = up >= down ? 'long' : 'short'; const attentionDirection = attentionSide === 'long' ? 'up' : 'down';
  const observationChecks = [
    ['1год/4год підтверджують напрямок', h1.direction === h4.direction && h1.direction !== 'mixed'],
    ['Щонайменше 3 таймфрейми в одному напрямку', Math.max(up, down) >= 3],
    ['RSI не в крайній зоні', h1.rsi >= 30 && h1.rsi <= 70],
    ['MACD підтверджує напрямок', attentionSide === 'long' ? h1.macd > 0 : h1.macd < 0],
    ['Обсяг не нижче середнього', finite(h1.relVolume) && h1.relVolume >= 1]
  ];
  const attention = { symbol, side: attentionSide, passed: observationChecks.filter(([, ok]) => ok).length, total: 5, frames: 4,
    up, down, mixed: 4 - up - down, rsi: h1.rsi, relativeVolume: h1.relVolume, atrPct: 100 * h1.atr / h1.price,
    checkedAt: new Date(asOf).toISOString(), hasTradePlan: false, timeframes: Object.values(frames).map(frame => ({ tf: frame.tf, direction: frame.direction, price: frame.price, rsi: frame.rsi, macd: frame.macd, relativeVolume: frame.relVolume })),
    waitFor: observationChecks.filter(([, ok]) => !ok).map(([label]) => label).slice(0, 2) };
  const candidates = ['long', 'short'].map(side => {
    const up = side === 'long'; const direction = up ? 'up' : 'down'; const stop = up ? Math.min(h1.support, h1.price - h1.atr) : Math.max(h1.resistance, h1.price + h1.atr); const target = up ? h1.resistance : h1.support;
    const risk = Math.abs(h1.price - stop); const reward = Math.abs(target - h1.price); const geometry = risk > 0 && reward > 0 && (up ? stop < h1.price && target > h1.price : stop > h1.price && target < h1.price);
    const grossRR = geometry ? reward / risk : null; const cost = .00105 * (h1.price + target); const adjustedRisk = geometry ? risk + .00105 * (h1.price + stop) : null; const netRR = geometry ? (reward - cost) / adjustedRisk : null;
    // Each of these is a mandatory gate for a plan.  A mixed daily or 15m
    // frame may be useful for the watch list, but it is not confirmation for
    // a ready trade plan.
    const checks = [
      ['trend', h1.direction === direction && h4.direction === direction, 'Тренди 1 год і 4 год не узгоджені'],
      ['daily', day.direction === direction, 'Денний тренд не підтверджує напрямок'],
      ['short', m15.direction === direction, 'Тренд 15 хв не підтверджує напрямок'],
      ['momentum', up ? h1.rsi >= 42 && h1.rsi <= 67 && h1.macd > 0 : h1.rsi >= 33 && h1.rsi <= 58 && h1.macd < 0, 'RSI або MACD не підтверджують імпульс'],
      ['reward', geometry && grossRR >= 1.5 && netRR >= 1.5, !geometry ? 'TP не на правильному боці входу' : grossRR < 1.5 ? 'R:R нижче 1:1,5' : 'R:R після модельних витрат нижче 1:1,5'],
      ['risk', geometry && risk / h1.price <= .05, 'Stop Loss надто далеко (>5%) або рівні некоректні']
    ].map(([key, ok, label]) => ({ key, ok, label }));
    const failed = checks.filter(check => !check.ok); const trendScore = checks.filter(check => ['trend', 'daily', 'short', 'momentum'].includes(check.key) && check.ok).length;
    const allMandatoryChecksPass = failed.length === 0;
    return { side, stop, target, grossRR, netRR, checks, failed, trendScore, geometry, risk,
      feasible: allMandatoryChecksPass && liquidityOk, allMandatoryChecksPass };
  }).sort((a, b) => b.trendScore - a.trendScore || b.checks.filter(check => check.ok).length - a.checks.filter(check => check.ok).length || (attentionSide === a.side ? -1 : attentionSide === b.side ? 1 : 0));
  const best = candidates[0]; const exact = candidates.find(candidate => candidate.feasible && candidate.checks.find(check => check.key === 'trend').ok);
  const blocking = [...best.failed.map(check => check.label)];
  if (!liquidityOk) blocking.push(finite(turnover) ? 'Низька ліквідність: обіг за 24 год менше 10 млн USDT' : 'Не отримано перевіреного обігу за 24 год');
  if (!priceAligned) blocking.push(livePriceKnown ? 'Ціна відійшла від умовного входу; потрібен повторний розрахунок' : 'Немає актуальної ціни для перевірки входу');
  // Keep the price check outside the candle-based checks: it must be sampled
  // at scan time and fail closed when unavailable or stale.
  const plan = exact && priceAligned ? { symbol, side: exact.side, entry: h1.price, stop: exact.stop, target: exact.target, rr: exact.grossRR, netRR: exact.netRR, confirmations: exact.trendScore, checks: 6, timeframe: '60', scannedAt: new Date(asOf).toISOString(), ordersEnabled: false } : null;
  attention.hasTradePlan = Boolean(plan);
  const marketQuality = { passed: attention.passed, total: 5, trendChecks: best.trendScore, trendTotal: 4, side: plan?.side || best.side };
  const tradeFeasibility = { status: plan ? 'validated' : best.feasible ? 'conditional' : 'blocked', grossRR: best.grossRR, netRR: best.netRR, validLevels: best.geometry, priceAligned, liquidityOk, turnover24h: finite(turnover) ? turnover : null, blocking: plan ? [] : blocking };
  const scenario = best.geometry ? { status: 'hypothetical', side: best.side, entry: h1.price, stop: best.stop, target: best.target, grossRR: best.grossRR, netRR: best.netRR, warning: 'Попередній розрахунок за закритою свічкою. НЕ сигнал і НЕ заявка.' } : null;
  return { status: plan ? 'ready' : 'watch', side: plan?.side || best.side, plan, attention, blocking: plan ? [] : blocking, checksPassed: best.checks.filter(check => check.ok).length, checksTotal: 6, estimatedRR: best.grossRR, netRR: best.netRR, marketQuality, tradeFeasibility, scenario,
    diagnostics: { failed: best.failed.map(check => check.key), priceAligned, liquidityOk, turnover24h: finite(turnover) ? turnover : null } };
}
/**
 * Rank observation candidates by market evidence before hypothetical payoff
 * or raw turnover.  A watch-list position is not an order recommendation.
 */
export function compareWatchCandidates(a, b) {
  return (a.state === 'near' ? 0 : 1) - (b.state === 'near' ? 0 : 1) ||
    (b.marketQuality?.trendChecks ?? -1) - (a.marketQuality?.trendChecks ?? -1) ||
    (b.marketQuality?.passed ?? -1) - (a.marketQuality?.passed ?? -1) ||
    (b.readinessPassed ?? -1) - (a.readinessPassed ?? -1) ||
    Number(b.tradeFeasibility?.priceAligned) - Number(a.tradeFeasibility?.priceAligned) ||
    Number(b.tradeFeasibility?.liquidityOk) - Number(a.tradeFeasibility?.liquidityOk) ||
    Number(b.tradeFeasibility?.validLevels) - Number(a.tradeFeasibility?.validLevels) ||
    (b.turnover24h ?? 0) - (a.turnover24h ?? 0) ||
    String(a.symbol ?? '').localeCompare(String(b.symbol ?? ''));
}
