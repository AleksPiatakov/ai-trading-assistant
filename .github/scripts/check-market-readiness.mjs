import assert from 'node:assert/strict';
import {assessTradeReadiness,evaluateTradeSetup} from '../../scripts/market-scanner.mjs';
const now=Date.UTC(2026,10,10,12);
const length={'15':900000,'60':3600000,'240':14400000,D:86400000};
const flat=Object.fromEntries(Object.entries(length).map(([tf,ms])=>[
 tf,Array.from({length:220},(_,i)=>({t:now-(220-i)*ms,o:100,h:100.2,l:99.8,c:100,v:100}))
]));
const missing=assessTradeReadiness('BTCUSDT',{},now);
assert.equal(missing.status,'insufficient');
assert.ok(missing.blocking.some(t=>t.includes('Недостатньо')));
assert.equal(missing.plan,null);
const candidate=assessTradeReadiness('BTCUSDT',flat,now);
assert.ok(['watch','near'].includes(candidate.status));
assert.equal(candidate.plan,null);
assert.ok(candidate.blocking.length>0,'Do not invent a ready entry on flat candles');
assert.ok(Number.isFinite(candidate.checksPassed));
assert.equal(candidate.checksTotal,6);
assert.equal(evaluateTradeSetup('BTCUSDT',flat,now),null);
assert.notEqual(candidate.status,'ready');
console.log('Candidate readiness: completed-bar safeguards, insufficient data and no fictitious trade entries pass');
