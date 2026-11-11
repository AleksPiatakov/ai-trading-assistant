import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createForwardPaperJournal,summarizePaperTrades} from '../../market-intelligence/forward-paper.mjs';
const HOUR=3600000;
const folder=await mkdtemp(join(tmpdir(),'mi-forward-'));
const t=Date.UTC(2026,10,11,12,30);
let clock=t;
const plan={symbol:'BTCUSDT',side:'long',entry:100,stop:95,target:110,scannedAt:new Date(t).toISOString(),ordersEnabled:false};
const bar=(time,o,h,l,c)=>({t:time,o,h,l,c});
const file=join(folder,'paper.json');
try{
 const journal=createForwardPaperJournal({path:file,now:()=>clock});
 await journal.observe({plans:[plan],candlesBySymbol:{BTCUSDT:[bar(t-30*60000,100,101,99,100)]}});
 let report=await journal.report();
 assert.equal(report.totals.waiting,1);
 assert.equal(report.totals.closed,0);
 assert.equal(report.metrics.winRate,null);
 assert.equal(report.metrics.profitFactor,null);
 // At 14:10 the 13:00-14:00 bar has closed. It touches both SL and TP.
 // Stop-first priority must result in a net loss, including fees and slip.
 clock=Date.UTC(2026,10,11,14,10);
 await journal.observe({plans:[],candlesBySymbol:{BTCUSDT:[
  bar(Date.UTC(2026,10,11,12),100,101,99,100),
  bar(Date.UTC(2026,10,11,13),100,112,94,102)]}});
 report=await journal.report();
 assert.equal(report.totals.closed,1);
 assert.equal(report.trades[0].reason,'stop');
 assert.equal(report.trades[0].ambiguous,true);
 assert.ok(report.trades[0].netR < -1,'Execution costs must be paid');
 const reloaded=createForwardPaperJournal({path:file,now:()=>clock});
 assert.equal((await reloaded.report()).totals.closed,1,'State must persist on disk');
 await reloaded.observe({plans:[{...plan,scannedAt:new Date(clock).toISOString()}]});
 assert.equal((await reloaded.report()).trades.length,1,'Continuous signal must not generate repeated trades');
 assert.equal((await reloaded.report()).ordersEnabled,false);
 assert.equal(summarizePaperTrades([]).winRate,null,'No invented win rate');
 // Distinct paper record: after fill, a missing hour makes it unverifiable.
 const file2=join(folder,'gap.json'),j2=createForwardPaperJournal({path:file2,now:()=>clock});
 const p2={...plan,symbol:'ETHUSDT',scannedAt:new Date(clock).toISOString()};
 await j2.observe({plans:[p2]});
 clock=Date.UTC(2026,10,11,16,10);
 await j2.observe({candlesBySymbol:{ETHUSDT:[bar(Date.UTC(2026,10,11,15),100,102,99,101)]}});
 assert.equal((await j2.report()).totals.open,1);
 clock=Date.UTC(2026,10,11,18,10);
 await j2.observe({candlesBySymbol:{ETHUSDT:[bar(Date.UTC(2026,10,11,17),101,102,99,100)]}});
 assert.equal((await j2.report()).totals.unverifiable,1);
 assert.equal((await j2.report()).metrics.closed,0);
 console.log('Forward paper simulation: stop-first, costs, persistence, duplicate prevention, missing bars, empty metrics PASS');
}finally{await rm(folder,{recursive:true,force:true})}
