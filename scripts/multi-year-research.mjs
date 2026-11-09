/**
 * Local, bounded, read-only multi-market historical verification.
 * History is saved on disk, with incremental checkpointing. No exchange orders.
 */
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyStrategy,scoreTrades} from './strategy-verification.mjs';
const TFS={'15':900000,'60':3600000,'240':14400000,D:86400000};
const SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT','LINKUSDT','AVAXUSDT','DOTUSDT'];
const YEAR=365.25*86400000;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const good=c=>Number.isFinite(c?.t)&&c.t>0&&[c.o,c.h,c.l,c.c,c.v].every(Number.isFinite)&&c.o>0&&c.l<=Math.min(c.o,c.c)&&c.h>=Math.max(c.o,c.c);
const clean=x=>[...new Map(x.filter(good).map(c=>[c.t,c])).values()].sort((a,b)=>a.t-b.t);
function summarize(result,testCut){
 const trades=result.trades||[];
 const train=trades.filter(t=>Date.parse(t.signalAt)<testCut);
 const test=trades.filter(t=>Date.parse(t.signalAt)>=testCut);
 const metric=arr=>scoreTrades(arr);
 const report={
  symbol:result.symbol,
  period:result.period,
  bars:result.bars,
  train:metric(train),test:metric(test),
  all:metric(trades),
  losses:trades.filter(t=>t.netR<=0).reduce((agg,t)=>{agg[t.reason]=(agg[t.reason]||0)+1;return agg},{}),
  trades:trades.slice(-40),
  note:trades.length<30?'Менше 30 завершених угод; висновки ненадійні.':'Історичні результати не гарантують майбутніх.'
 };
 return report;
}
export function createMultiYearResearch({dir,getKlinesPage,getInstruments,now=()=>Date.now(),requestDelayMs=110}){
 let state={status:'idle',years:1,stage:'',symbol:null,completed:0,total:SYMBOLS.length,progress:0,startedAt:null,
  finishedAt:null,results:[],errors:[],ordersEnabled:false,method:'walk-forward'};
 let busy=false;const status=()=>({...state,results:state.results.map(x=>({...x})),errors:[...state.errors]});
 async function loadHistory(symbol,tf,fromTime,nowTime){
  const path=join(dir,'history',symbol+'-'+tf+'.json');
  let rows=[];
  try{
   const saved=JSON.parse(await readFile(path,'utf8'));
   if(Array.isArray(saved.candles))rows=clean(saved.candles);
  }catch{}
  rows=rows.filter(c=>c.t<=nowTime);
  // The latest saved candle may be forming: re-fetch recent bars to refresh.
  const refreshTail=rows.length?Math.min(nowTime,rows.at(-1).t-TFS[tf]):nowTime;
  let end=rows.length&&rows[0].t<=fromTime?refreshTail:nowTime;
  let fetched=0;
  const save=async()=>{
   await mkdir(join(dir,'history'),{recursive:true,mode:0o700});
   const temp=path+'.tmp';
   await writeFile(temp,JSON.stringify({version:1,symbol,tf,candles:rows}),{mode:0o600});
   await rename(temp,path);
  };
  // Bound memory and requests, permit checkpoints after partial progress.
  for(let page=0;page<Math.ceil((3*YEAR/TFS[tf])/1000)+8;page++){
   const response=await getKlinesPage(symbol,tf,end,1000);
   const incoming=(response||[]).map(x=>({t:Number(x.t),o:Number(x.o),h:Number(x.h),l:Number(x.l),c:Number(x.c),v:Number(x.v)})).filter(good);
   if(!incoming.length)break;
   rows=clean([...rows,...incoming]).filter(c=>c.t>=fromTime-TFS[tf]*2);
   fetched+=incoming.length;
   if(page%5===0)await save();
   const oldest=Math.min(...incoming.map(c=>c.t));
   if(oldest<=fromTime||oldest>=end)break;
   end=oldest-1;
   if(requestDelayMs)await delay(requestDelayMs);
  }
  await save();
  return rows.filter(c=>c.t>=fromTime);
 }
 async function start(years=1){
  if(busy)return {started:false,error:'Історична перевірка вже працює'};
  if(![1,2,3].includes(years))return {started:false,error:'Оберіть 1, 2 або 3 роки'};
  busy=true;
  state={status:'running',years,stage:'Перевірка доступних інструментів',symbol:null,completed:0,total:SYMBOLS.length,progress:0,startedAt:new Date(now()).toISOString(),
   finishedAt:null,results:[],errors:[],ordersEnabled:false,method:'walk-forward'};
  // Async intentionally belongs to the local server's on-demand job, not the chat assistant.
  void(async()=>{
   try{
    const all=await getInstruments();
    const enabled=SYMBOLS.filter(s=>all.includes(s));
    state.total=enabled.length;
    const end=now(),cutoff=end-years*YEAR,from=cutoff-220*86400000;
    for(const symbol of enabled){
     state.symbol=symbol;state.stage='Завантаження історії';
     try{
      const series={};
      for(const tf of Object.keys(TFS)){
       state.stage='Свічки '+tf;
       series[tf]=await loadHistory(symbol,tf,from,end);
      }
      state.stage='Тестування стратегії';
      const result=verifyStrategy({symbol,series});
      const filtered={...result,trades:result.trades.filter(t=>Date.parse(t.signalAt)>=cutoff)};
      state.results.push(summarize(filtered,cutoff+years*YEAR*.7));
     }catch(e){state.errors.push(symbol+': '+String(e.message||e).slice(0,160))}
     state.completed++;
     state.progress=state.total?Math.round(100*state.completed/state.total):100;
    }
    state.stage='Завершено';state.status=state.errors.length?'partial':'complete';
   }catch(e){state.status='error';state.errors.push(String(e.message||e).slice(0,180))}
   finally{state.finishedAt=new Date(now()).toISOString();busy=false;state.symbol=null}
  })();
  return {started:true,years,ordersEnabled:false};
 }
 function aggregated(){
  const combined=state.results.flatMap(r=>r.trades||[]).sort((a,b)=>Date.parse(a.signalAt)-Date.parse(b.signalAt));
  // Aggregate all metrics from per-symbol metrics, not the last-40 UI summaries.
  const trainResults=state.results.map(r=>r.train),testResults=state.results.map(r=>r.test);
  const sum=(items,key)=>items.reduce((a,v)=>a+(Number(v?.[key])||0),0);
  const metrics=items=>{
   const closed=sum(items,'closed'),wins=sum(items,'wins'),totalNetR=sum(items,'totalNetR');
   const gain=items.reduce((a,r)=>a+(r?.profitFactor==null?Math.max(0,r?.totalNetR||0):Math.max(0,r.totalNetR)+Math.max(0,-r.totalNetR)/(Math.max(r.profitFactor,0.000001))),0);
   // Aggregate raw profit/loss are added below by the verification engine; use neutral values otherwise.
   return {closed,wins,winRate:closed?100*wins/closed:null,expectancyR:closed?totalNetR/closed:null,totalNetR};
  };
  return {...status(),train:metrics(trainResults),test:metrics(testResults),
   warning:'Вибір варіантів стратегії на test/OOS заборонений. Зараз перевіряється одна зафіксована стратегія без оптимізації параметрів.',
   sampleTrades:combined.slice(-80)};
 }
 return {start,status:aggregated};
}
