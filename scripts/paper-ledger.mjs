/**
 * Read-only paper ledger. Observes NEW confirmed scanner plans, never opens orders.
 * Paper fills at the next *closed* 15m candle's open, after the plan was observed.
 * Both SL and TP in one candle => conservative SL-first outcome.
 */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {completedCandles,scoreTrades,tradingCosts} from './strategy-verification.mjs';
const BAR=900000,HOLD=48*3600000;
const valid=p=>p&&/^[A-Z0-9]{3,30}USDT$/.test(p.symbol)&&['long','short'].includes(p.side)&&
 [p.entry,p.stop,p.target].every(x=>Number.isFinite(Number(x))&&Number(x)>0)&&
 Number.isFinite(Date.parse(p.scannedAt));
export function createPaperLedger({path,loadCandles,now=()=>Date.now(),costs=tradingCosts}){
 let loaded=false,rows=[],activeKeys=new Set(),error=null;
 async function ensure(){
  if(loaded)return;loaded=true;
  try{
   const saved=JSON.parse(await readFile(path,'utf8'));
   if(Array.isArray(saved.rows))rows=saved.rows.filter(x=>x&&typeof x.id==='string').slice(-300);
   if(Array.isArray(saved.activeKeys))activeKeys=new Set(saved.activeKeys.filter(x=>typeof x==='string'));
  }catch(e){if(e.code!=='ENOENT')error='Не вдалося прочитати paper ledger'}
 }
 async function persist(){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const tmp=path+'.tmp';
  await writeFile(tmp,JSON.stringify({version:1,rows,activeKeys:[...activeKeys]},null,2),{mode:0o600});
  await rename(tmp,path);
 }
 async function refresh({opportunities=[]}={}){
  await ensure();
  const present=new Set();
  const observed=now();
  for(const plan of opportunities.filter(valid)){
   const key=plan.symbol+'|'+plan.side;present.add(key);
   if(activeKeys.has(key))continue;
   const id=key+'|'+String(plan.priceAsOf||plan.scannedAt);
   if(rows.some(x=>x.id===id))continue;
   rows.push({id,symbol:plan.symbol,side:plan.side,proposedEntry:Number(plan.entry),stop:Number(plan.stop),
    target:Number(plan.target),observedAt:new Date(observed).toISOString(),
    status:'waiting-fill',entry:null,exit:null,netR:null,reason:null});
  }
  activeKeys=present;
  for(const row of rows.filter(x=>['waiting-fill','open'].includes(x.status))){
   let candles;
   try{const res=await loadCandles(row.symbol,'15');candles=completedCandles(res.candles||[],'15',observed)}
   catch(e){error='Paper tracking: '+String(e.message||e).slice(0,100);continue}
   const observedAt=Date.parse(row.observedAt);
   // Cannot "fill" in a 15m candle opened before the observation.
   const future=candles.filter(c=>c.t>observedAt);
   if(row.status==='waiting-fill'){
    if(!future.length)continue;
    const first=future[0],direction=row.side==='long'?1:-1;
    const entry=first.o*(1+direction*costs.slippagePerSide);
    if(!(direction*(entry-row.stop)>0&&direction*(row.target-entry)>0)){
     row.status='rejected';row.reason='gap invalidated plan';continue;
    }
    row.entry=entry;row.entryAt=new Date(first.t).toISOString();row.status='open';
   }
   const entryAt=Date.parse(row.entryAt),direction=row.side==='long'?1:-1;
   for(const candle of future.filter(c=>c.t>=entryAt)){
    const stopHit=row.side==='long'?candle.l<=row.stop:candle.h>=row.stop;
    const targetHit=row.side==='long'?candle.h>=row.target:candle.l<=row.target;
    const timed=candle.t-entryAt>=HOLD;
    if(!stopHit&&!targetHit&&!timed)continue;
    const level=stopHit?row.stop:targetHit?row.target:candle.c;
    const exit=level*(1-direction*costs.slippagePerSide);
    const risk=Math.abs(row.entry-row.stop);
    row.exit=exit;row.exitAt=new Date(candle.t+BAR).toISOString();row.status='closed';
    row.reason=stopHit?'stop':targetHit?'target':'timeout';row.ambiguous=stopHit&&targetHit;
    row.grossR=direction*(exit-row.entry)/risk;
    row.feesR=costs.feePerSide*(row.entry+exit)/risk;
    row.netR=row.grossR-row.feesR;
    break;
   }
  }
  rows=rows.slice(-300);
  await persist();
 }
 async function report(){
  await ensure();
  const closed=rows.filter(x=>x.status==='closed');
  return {mode:'paper',ordersEnabled:false,source:'Bybit public closed 15m candles',costs:{...costs},
   warning:'Симуляція майбутніх сигналів, не реальні угоди. Старт після виявлення сигналу, SL має пріоритет при неоднозначній свічці.',
   totals:{waiting:rows.filter(x=>x.status==='waiting-fill').length,open:rows.filter(x=>x.status==='open').length,
    rejected:rows.filter(x=>x.status==='rejected').length,closed:closed.length},
   metrics:scoreTrades(closed),trades:rows.slice(-100).reverse(),error};
 }
 return {refresh,report};
}
