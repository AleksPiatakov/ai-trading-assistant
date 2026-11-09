import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMultiYearResearch} from '../../scripts/multi-year-research.mjs';
const base=await mkdtemp(join(tmpdir(),'ata-multiyear-'));
try{
 const current=Date.UTC(2026,10,9,12),ms={'15':900000,'60':3600000,'240':14400000,D:86400000};
 let calls=0;
 const getKlinesPage=async(symbol,tf,end)=>{
  calls++;
  assert.equal(symbol,'BTCUSDT');
  const step=ms[tf];
  // Simulate an older, limited-history listing. Not enough 15m for annual coverage.
  if(end<current-260*step)return [];
  return Array.from({length:260},(_,i)=>{
   const t=current-(260-i)*step,v=100+i*.03;
   return {t,o:v,h:v+.2,l:v-.2,c:v,v:15}
  }).filter(x=>x.t<=end).reverse();
 };
 const engine=createMultiYearResearch({
  dir:base,now:()=>current,requestDelayMs:0,
  getInstruments:async()=>['BTCUSDT'],getKlinesPage
 });
 assert.equal((await engine.start(4)).started,false);
 assert.equal((await engine.start(1)).started,true);
 assert.equal((await engine.start(1)).started,false,'Parallel run must be rejected');
 let state;
 for(let i=0;i<200;i++){
  state=engine.status();
  if(state.status!=='running')break;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.equal(state.status,'complete',JSON.stringify(state.errors));
 assert.equal(state.total,1);
 assert.equal(state.completed,1);
 assert.equal(state.results.length,1);
 assert.equal(state.selectedOnTrain,null);
 assert.equal(state.ordersEnabled,false);
 assert.equal(state.variants.baseline.train.closed,0);
 assert.equal(state.variants.strict.test.closed,0);
 assert.equal(state.results[0].train.winRate,null);
 assert.ok(calls>=4);
 console.log('Multi-market historical loader, bounded run, honest empty metrics and variant OOS separation: success');
}finally{await rm(base,{recursive:true,force:true})}
