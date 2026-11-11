/**
 * Market Intelligence forward-only paper outcomes.
 * Read-only observation; never places Bybit orders, never uses Demo credentials.
 * A plan is only simulated after its detection, starting at the next completed 1h bar.
 */
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
const HOUR=3600000,MAX_HOLD=48*HOUR;
const fee=.00055,slippage=.0005;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validBar=b=>finite(b?.t)&&[b.o,b.h,b.l,b.c].every(finite)&&
 b.o>0&&b.l>0&&b.h>=Math.max(b.o,b.c)&&b.l<=Math.min(b.o,b.c);
const round=n=>Number(n.toFixed(5));
export function summarizePaperTrades(trades){
 const closed=trades.filter(x=>x.status==='closed'&&finite(x.netR)).sort((a,b)=>Date.parse(a.closedAt)-Date.parse(b.closedAt));
 const wins=closed.filter(x=>x.netR>0).length;
 const gain=closed.filter(x=>x.netR>0).reduce((v,x)=>v+x.netR,0);
 const loss=closed.filter(x=>x.netR<0).reduce((v,x)=>v-x.netR,0);
 let equity=0,peak=0,drawdown=0;
 for(const x of closed){equity+=x.netR;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity)}
 return {closed:closed.length,wins,losses:closed.length-wins,
  winRate:closed.length?100*wins/closed.length:null,
  profitFactor:closed.length&&loss>0?gain/loss:null,
  expectancyR:closed.length?equity/closed.length:null,
  totalNetR:closed.length?equity:null,
  maxDrawdownR:closed.length?drawdown:null};
}
export function createForwardPaperJournal({path,now=()=>Date.now(),maxRows=2000}){
 let cache=null,writing=Promise.resolve();
 async function load(){
  if(cache)return cache;
  try{const parsed=JSON.parse(await readFile(path,'utf8'));cache=Array.isArray(parsed.rows)?parsed.rows:[]}
  catch(e){if(e.code!=='ENOENT')throw e;cache=[]}
  return cache;
 }
 async function save(){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const tmp=path+'.tmp';
  await writeFile(tmp,JSON.stringify({version:1,rows:cache}),{mode:0o600});
  await rename(tmp,path);
 }
 function serial(fn){
  const task=writing.then(async()=>{await load();const result=await fn();await save();return result});
  writing=task.catch(()=>{});return task;
 }
 function normalizedPlan(plan,seenAt){
  if(!/^[A-Z0-9]{3,30}USDT$/.test(plan?.symbol||'')||
   !['long','short'].includes(plan.side)||![plan.entry,plan.stop,plan.target].every(finite))return null;
  if(!(plan.side==='long'?plan.stop<plan.entry&&plan.entry<plan.target:
   plan.target<plan.entry&&plan.entry<plan.stop))return null;
  const signalAt=Date.parse(plan.scannedAt);
  if(!Number.isFinite(signalAt)||signalAt>seenAt||seenAt-signalAt>20*60000)return null;
  return {symbol:plan.symbol,side:plan.side,entry:plan.entry,stop:plan.stop,target:plan.target,
   signalAt:new Date(signalAt).toISOString(),seenAt:new Date(seenAt).toISOString(),
   status:'waiting',lastCheckedAt:null,ordersEnabled:false};
 }
 async function observe({plans=[],candlesBySymbol={}}={}){
  return serial(async()=>{
   const at=now();
   for(const p of plans){
    const plan=normalizedPlan(p,at);if(!plan)continue;
    const ongoing=cache.some(x=>x.symbol===plan.symbol&&x.side===plan.side&&
      ['waiting','open'].includes(x.status));
    // Avoid re-entering the same continuously reported setup after it just closed.
    const duplicate=cache.some(x=>x.symbol===plan.symbol&&x.side===plan.side&&
      (x.signalAt===plan.signalAt||Date.parse(plan.signalAt)-Date.parse(x.signalAt)<4*HOUR));
    if(!ongoing&&!duplicate)cache.push({...plan,id:plan.symbol+'|'+plan.side+'|'+plan.signalAt});
   }
   for(const row of cache){
    if(row.status!=='waiting'&&row.status!=='open')continue;
    const series=(candlesBySymbol[row.symbol]||[]).filter(validBar)
     .filter(b=>b.t+HOUR<=at).sort((a,b)=>a.t-b.t);
    const last=Date.parse(row.lastCheckedAt||row.seenAt);
    const unread=series.filter(b=>b.t+HOUR>last);
    if(!unread.length)continue;
    if(unread[0].t>(row.status==='open'?last:last+HOUR)){
      row.status='unverifiable';row.reason='Пропуск свічок після сигналу';continue;
    }
    for(const bar of unread){
     if(bar.t>last+MAX_HOLD+HOUR)break;
     if(row.status==='waiting'){
      // Do not simulate a fill inside a candle already forming when the signal arrived.
      if(bar.t<Date.parse(row.seenAt))continue;
      row.fillAt=new Date(bar.t).toISOString();row.fillPrice=bar.o;row.status='open';
     }
     const stopHit=row.side==='long'?bar.l<=row.stop:bar.h>=row.stop;
     const targetHit=row.side==='long'?bar.h>=row.target:bar.l<=row.target;
     const timeout=bar.t-Date.parse(row.fillAt)>=MAX_HOLD-HOUR;
     row.lastCheckedAt=new Date(bar.t+HOUR).toISOString();
     if(!stopHit&&!targetHit&&!timeout)continue;
     const stopFill=row.side==='long'?Math.min(row.stop,bar.o):Math.max(row.stop,bar.o);
     const price=stopHit?stopFill:targetHit?row.target:bar.c;
     const entry=row.fillPrice,side=row.side==='long'?1:-1;
     const risk=Math.abs(row.entry-row.stop);
     // Costs assumed at both sides of executed prices; unfavorable slip applied to entry and exit.
     const net=side*(price-entry)-slippage*(entry+price)-fee*(entry+price);
     row.netR=round(net/risk);
     row.reason=stopHit?'stop':targetHit?'target':'timeout';
     row.ambiguous=Boolean(stopHit&&targetHit);
     row.exitPrice=price;row.closedAt=new Date(bar.t+HOUR).toISOString();row.status='closed';
     break;
    }
   }
   if(cache.length>maxRows)cache=cache.slice(-maxRows);
   return {ordersEnabled:false,records:cache.length};
  });
 }
 async function report(){
  await writing;const rows=await load();
  return {mode:'forward-paper',ordersEnabled:false,updatedAt:new Date(now()).toISOString(),
   totals:{waiting:rows.filter(x=>x.status==='waiting').length,open:rows.filter(x=>x.status==='open').length,
    closed:rows.filter(x=>x.status==='closed').length,unverifiable:rows.filter(x=>x.status==='unverifiable').length},
   metrics:summarizePaperTrades(rows),trades:rows.slice(-100).reverse(),
   warning:'Умовні результати, не реальні ордери. Запис лише після появи сигналу. Дані з прогалинами не рахуються як прибуток. Комісія і прослизання модельні; funding та реальна ліквідність не враховані.'};
 }
 return {observe,report};
}
