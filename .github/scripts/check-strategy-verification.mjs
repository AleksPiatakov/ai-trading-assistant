import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {completedCandles,scoreTrades,verifyStrategy} from '../../scripts/strategy-verification.mjs';
import {createPaperLedger} from '../../scripts/paper-ledger.mjs';
import {evaluateTradeSetup} from '../../scripts/market-scanner.mjs';

const t0=Date.UTC(2026,9,15,12,0,0);
const sample=[
 {t:t0-900000,o:100,h:102,l:99,c:101,v:10},
 {t:t0,o:101,h:103,l:100,c:102,v:11},
 {t:t0+900000,o:102,h:105,l:101,c:104,v:12}
];
assert.equal(completedCandles(sample,'15',t0).length,1,'Current 15m candle was improperly treated as closed');
assert.equal(completedCandles(sample,'15',t0+900000).length,2);

let stats=scoreTrades([]);
assert.equal(stats.closed,0);
assert.equal(stats.winRate,null,'Never invent success rates for empty sample');
assert.equal(stats.profitFactor,null);
stats=scoreTrades([{status:'closed',netR:2},{status:'closed',netR:-1},{status:'closed',netR:-1}]);
assert.equal(stats.closed,3);
assert.equal(stats.wins,1);
assert.equal(stats.losses,2);
assert.equal(stats.profitFactor,1);
assert.equal(stats.expectancyR,0);
assert.equal(stats.maxDrawdownR,2);

const make=(count,ms,now)=>Array.from({length:count},(_,i)=>{
 const v=100+0.015*i;
 return {t:now-(count-i)*ms,o:v,h:v+0.3,l:v-0.3,c:v,v:100};
});
const historical={
 '15':make(700,900000,t0),
 '60':make(160,3600000,t0),
 '240':make(240,14400000,t0),
 D:make(255,86400000,t0)
};
const result=verifyStrategy({symbol:'BTCUSDT',series:historical,maxSignals:30});
assert.equal(result.ordersEnabled,false);
assert.equal(result.method,'walk-forward-closed-candles-next-open-stop-first');
assert.ok(result.metrics.closed>=0&&result.trades.length<=30);
assert.ok(result.trades.every(t=>Date.parse(t.entryAt)>=Date.parse(t.signalAt)),
 'Lookahead: trade filled before its signal');
assert.equal(evaluateTradeSetup('BTCUSDT',{},t0),null);

const folder=await mkdtemp(join(tmpdir(),'ata-paper-test-'));
try{
 let current=t0,market={candles:[]};
 const ledger=createPaperLedger({path:join(folder,'paper.json'),now:()=>current,loadCandles:async()=>market});
 const plan={symbol:'BTCUSDT',side:'long',entry:100,stop:95,target:110,priceAsOf:t0-3600000,
  scannedAt:new Date(t0).toISOString()};
 await ledger.refresh({opportunities:[plan]});
 let p=await ledger.report();
 assert.equal(p.totals.waiting,1);
 assert.equal(p.totals.closed,0);
 // The next fully closed 15-minute bar touches BOTH stop and target.
 // Conservative verification must award the stop, never the target.
 market={candles:[{t:t0+900000,o:100,h:112,l:94,c:102,v:100}]};
 current=t0+31*60000;
 await ledger.refresh({opportunities:[plan]});
 p=await ledger.report();
 assert.equal(p.totals.closed,1);
 assert.equal(p.trades[0].reason,'stop');
 assert.equal(p.trades[0].ambiguous,true);
 assert.ok(p.trades[0].netR<-1,'Costs and adverse slippage must be included');
 assert.equal(p.ordersEnabled,false);
 await ledger.refresh({opportunities:[plan]});
 assert.equal((await ledger.report()).totals.closed,1,'Repeated scan created duplicate paper trade');
 const reloaded=createPaperLedger({path:join(folder,'paper.json'),now:()=>current,loadCandles:async()=>market});
 assert.equal((await reloaded.report()).totals.closed,1,'Paper records not persistent');
}finally{await rm(folder,{recursive:true,force:true})}
console.log('Strategy verification, closed-bar safety, paper ledger and cost assumptions: success');
