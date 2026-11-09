import assert from 'node:assert/strict';
import { createMarketScanner } from '../../scripts/market-scanner.mjs';
const calls=[];
const mockCandles=()=>Array.from({length:220},(_,i)=>{
 const v=100+i*.001;
 return {t:Date.UTC(2026,0,1)+i*60000,o:v-.01,h:v+.02,l:v-.03,c:v,v:500};
});
const scanner=createMarketScanner({
 getInstruments:async()=>['BTCUSDT','ETHUSDT','FAKEUSDT'],
 getKlines:async(symbol,tf)=>{calls.push({symbol,tf});return {symbol,tf,candles:mockCandles()}}
});
await scanner.refresh();
const result=scanner.getSnapshot();
assert.equal(result.status,'ready');
assert.equal(result.total,2);
assert.equal(result.completed,2);
assert.equal(result.ordersEnabled,false);
assert.equal(result.mode,'local-background');
assert.deepEqual([...new Set(calls.map(x=>x.symbol))],['BTCUSDT','ETHUSDT']);
assert.deepEqual([...new Set(calls.map(x=>x.tf))],['15','60','240','D']);
assert.equal(calls.length,8);
assert.equal(result.errors.length,0);
assert.ok(Array.isArray(result.opportunities));
assert.ok(Array.isArray(result.attention),'Watchlist missing');
assert.ok(result.attention.every(x=>x.passed>=2&&x.total===5),'Incorrect observation criteria');
assert.ok(result.attention.every(x=>typeof x.reason==='string'&&Array.isArray(x.waitFor)),'Missing watchlist explanations');

scanner.stop();
console.log('Scanner mock test: success');
