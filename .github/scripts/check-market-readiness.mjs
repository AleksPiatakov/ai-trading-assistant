import assert from 'node:assert/strict';
import {assessTradeReadiness,evaluateTradeSetup,compareWatchCandidates} from '../../scripts/market-scanner.mjs';
const now=Date.UTC(2026,10,10,12);
const length={'15':900000,'60':3600000,'240':14400000,D:86400000};
const flat=Object.fromEntries(Object.entries(length).map(([tf,ms])=>[
 tf,Array.from({length:220},(_,i)=>({t:now-(220-i)*ms,o:100,h:100.2,l:99.8,c:100,v:100}))
]));
const missing=assessTradeReadiness('BTCUSDT',{},now);
assert.equal(missing.status,'insufficient');
assert.ok(missing.blocking.some(t=>t.includes('Недостатньо')));
assert.equal(missing.plan,null);
const candidate=assessTradeReadiness('BTCUSDT',flat,now,{turnover24h:20000000,lastPrice:100});
assert.ok(['watch','near'].includes(candidate.status));
assert.equal(candidate.plan,null);
assert.ok(candidate.blocking.length>0,'Do not invent a ready entry on flat candles');
assert.ok(Number.isFinite(candidate.checksPassed));
assert.equal(candidate.checksTotal,6);
assert.equal(evaluateTradeSetup('BTCUSDT',flat,now),null);
assert.notEqual(candidate.status,'ready');
assert.equal(candidate.tradeFeasibility.assumptions.spreadMeasured,false);
assert.equal(candidate.tradeFeasibility.assumptions.fundingIncluded,false);
assert.equal(candidate.marketQuality.total,5);
assert.equal(candidate.tradeFeasibility.liquidityOk,true);
assert.equal(candidate.tradeFeasibility.priceAligned,true);
const noLiquidity=assessTradeReadiness('BTCUSDT',flat,now);
assert.equal(noLiquidity.tradeFeasibility.liquidityOk,false);
assert.equal(noLiquidity.plan,null,'No reported liquidity must not generate a tradable plan');
assert.equal(noLiquidity.status,'watch');
assert.ok(noLiquidity.blocking.some(x=>x.includes('обігу')));
const lowLiquidity=assessTradeReadiness('BTCUSDT',flat,now,{turnover24h:1000,lastPrice:100});
assert.equal(lowLiquidity.tradeFeasibility.liquidityOk,false);
assert.notEqual(lowLiquidity.status,'near');
assert.ok(lowLiquidity.blocking.some(x=>x.includes('ліквідність')));
assert.ok(candidate.status!=='ready'||candidate.plan!==null);
assert.ok(!candidate.scenario||candidate.scenario.status==='hypothetical');
const moved=assessTradeReadiness('BTCUSDT',flat,now,{turnover24h:20000000,lastPrice:140});
assert.equal(moved.tradeFeasibility.priceAligned,false);
assert.equal(moved.status,'watch');
assert.equal(moved.plan,null);
assert.ok(moved.blocking.some(x=>x.includes('відійшла')));
const absent=assessTradeReadiness('BTCUSDT',flat,now,{turnover24h:20000000});
assert.equal(absent.tradeFeasibility.priceAligned,false);
assert.equal(absent.plan,null);
const ranking=[
 {symbol:'SOXLUSDT',state:'watch',marketQuality:{trendChecks:2,passed:3},readinessPassed:3,
  tradeFeasibility:{status:'conditional',validLevels:true,netRR:5.41},turnover24h:50000000},
 {symbol:'BTCUSDT',state:'watch',marketQuality:{trendChecks:4,passed:4},readinessPassed:5,
  tradeFeasibility:{status:'blocked',validLevels:true,netRR:0.02},turnover24h:1000000000},
 {symbol:'KORUUSDT',state:'watch',marketQuality:{trendChecks:2,passed:2},readinessPassed:3,
  tradeFeasibility:{status:'conditional',validLevels:true,netRR:3.98},turnover24h:35000000}
];
ranking.sort(compareWatchCandidates);
assert.deepEqual(ranking.map(x=>x.symbol),['BTCUSDT','SOXLUSDT','KORUUSDT'],
 'Hypothetical reward ratio must never outrank confirmed 1h/4h market direction');
const close={symbol:'ETHUSDT',state:'near',marketQuality:{trendChecks:4,passed:5},readinessPassed:5,
 tradeFeasibility:{status:'conditional',validLevels:true},turnover24h:45000000};
assert.equal([ranking[0],close].sort(compareWatchCandidates)[0].symbol,'ETHUSDT',
 'Verified near-candidate must be visible before watch-only items');
console.log('Candidate readiness: two-stage validation, liquidity gate, cost disclosure and no fictitious entries pass');
