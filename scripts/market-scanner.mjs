/**
 * Read-only Bybit multi-market opportunity scanner.
 * Runs with the local loopback Node server, not in the browser or GitHub Pages.
 * It never accesses API credentials and has no order submission endpoint.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const WATCHLIST=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT','LINKUSDT','AVAXUSDT','DOTUSDT'];
const REQUIRED=['15','60','240','D'];
const BAR_MS={'15':900000,'60':3600000,'240':14400000,D:86400000};
const REFRESH_MS=5*60*1000;
const ALLOWED=new Set(WATCHLIST);
const finite=x=>Number.isFinite(x);
const ema=(xs,p)=>{
  const alpha=2/(p+1);let last=null;
  return xs.map(x=>last=last===null?x:last+alpha*(x-last));
};
function rsi(xs){
  let up=0,down=0;
  for(let i=1;i<=14;i++){let d=xs[i]-xs[i-1];up+=Math.max(0,d);down+=Math.max(0,-d)}
  up/=14;down/=14;
  for(let i=15;i<xs.length;i++){
    let d=xs[i]-xs[i-1];
    up=(up*13+Math.max(d,0))/14;down=(down*13+Math.max(-d,0))/14;
  }
  return down===0?(up===0?50:100):100-100/(1+up/down);
}
function analyze(candles,tf){
  const n=candles.length;
  if(n<55)return null;
  const close=candles.map(c=>c.c),last=candles.at(-1),e20=ema(close,20).at(-1),e50=ema(close,50).at(-1);
  const e200=n>=200?ema(close,200).at(-1):null;
  let direction=last.c>e20&&e20>e50?'up':last.c<e20&&e20<e50?'down':'mixed';
  if(e200&&((direction==='up'&&last.c<e200)||(direction==='down'&&last.c>e200)))direction='mixed';
  const twelve=ema(close,12),twentysix=ema(close,26);
  const hist=twelve.map((v,i)=>v-twentysix[i]);
  const macd=hist.at(-1)-ema(hist,9).at(-1);
  const tr=[];
  for(let i=n-14;i<n;i++)tr.push(Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c)));
  const atr=tr.reduce((a,b)=>a+b,0)/14;
  const prior=candles.slice(-21,-1);
  const support=Math.min(...prior.map(v=>v.l)),resistance=Math.max(...prior.map(v=>v.h));
  const volumeBaseline=prior.reduce((a,v)=>a+v.v,0)/20;
  return {tf,price:last.c,lastTime:last.t,direction,rsi:rsi(close),macd,atr,support,resistance,
    relVolume:volumeBaseline>0?last.v/volumeBaseline:null};
}
export function evaluateTradeSetup(symbol,candleSeries,asOf=Date.now()){
 const frames={};
 for(const tf of REQUIRED){
  const candles=(candleSeries[tf]||[]).filter(c=>c.t+BAR_MS[tf]<=asOf);
  frames[tf]=analyze(candles,tf);
 }
 return proposal(symbol,frames,new Date(asOf).toISOString());
}
function frameSummary(data){
 return REQUIRED.map(tf=>data[tf]).filter(Boolean).map(f=>({
  tf:f.tf,direction:f.direction,price:f.price,rsi:f.rsi,macd:f.macd,
  relativeVolume:f.relVolume,support:f.support,resistance:f.resistance,
  atrPct:f.price>0?100*f.atr/f.price:null,lastTime:f.lastTime
 }));
}
function proposal(symbol,data,asOf){
  const m15=data['15'],h1=data['60'],h4=data['240'],daily=data.D;
  if(!m15||!h1||!h4||!daily)return null;
  const price=h1.price;
  if(!finite(price)||price<=0||h1.atr<=0)return null;
  const out=[];
  for(const side of ['long','short']){
    const d=side==='long'?'up':'down';
    if(h1.direction!==d||h4.direction!==d)continue;
    if(daily.direction!=='mixed'&&daily.direction!==d)continue;
    if(m15.direction!==d&&m15.direction!=='mixed')continue;
    if(side==='long'&&!(h1.rsi>=42&&h1.rsi<=67&&h1.macd>0))continue;
    if(side==='short'&&!(h1.rsi>=33&&h1.rsi<=58&&h1.macd<0))continue;
    const stop=side==='long'?Math.min(h1.support,price-h1.atr):Math.max(h1.resistance,price+h1.atr);
    const target=side==='long'?h1.resistance:h1.support;
    const risk=Math.abs(price-stop),reward=Math.abs(target-price),rr=reward/risk;
    if(!finite(rr)||rr<1.5||risk/price>.05)continue;
    if(side==='long'&&!(stop<price&&target>price))continue;
    if(side==='short'&&!(stop>price&&target<price))continue;
    const confirmations=[h1,h4,m15,daily].filter(x=>x.direction===d).length;
    out.push({symbol,side,entry:price,stop,target,rr,confirmations,checks:4,
      timeframe:'60',priceAsOf:h1.lastTime,scannedAt:asOf,timeframes:frameSummary(data),
      reasons:['EMA 1год і 4год узгоджені',daily.direction===d?'Денний тренд підтверджує':'Денний тренд змішаний',
        'RSI та MACD відповідають напрямку','Підтримка/опір за 20 свічками, R:R ≥ 1:1.5'],
      warning:'Умовний план за останньою 1год свічкою; комісії, спред і прослизання не враховані. Перевір актуальну ціну перед дією.'});
  }
  return out.sort((a,b)=>b.confirmations-a.confirmations||b.rr-a.rr)[0]||null;
}
// Observation ranking is not a probability or a trade recommendation.
function attentionCandidate(symbol,frames,asOf){
 const rows=REQUIRED.map(tf=>frames[tf]).filter(Boolean);
 if(rows.length<3)return null;
 const h1=frames['60'],h4=frames['240'],day=frames.D,short=frames['15'];
 if(!h1||!h4)return null;
 const up=rows.filter(x=>x.direction==='up').length;
 const down=rows.filter(x=>x.direction==='down').length;
 const side=up>=down?'long':'short',matching=Math.max(up,down);
 const aligned=h1.direction===h4.direction&&h1.direction!=='mixed';
 const rsiNormal=finite(h1.rsi)&&h1.rsi>=30&&h1.rsi<=70;
 const macdAligned=(side==='long'&&h1.macd>0)||(side==='short'&&h1.macd<0);
 const volumePresent=h1.relVolume!==null&&finite(h1.relVolume);
 const volumeActive=volumePresent&&h1.relVolume>=1;
 const dailySupport=day?.direction=== (side==='long'?'up':'down');
 // Weighted qualitative criteria for ranking only; not confidence or success chance.
 const checks=[
  {label:'1год/4год підтверджують напрямок',ok:aligned},
  {label:'Щонайменше 3 таймфрейми в одному напрямку',ok:matching>=3},
  {label:'RSI не в крайній зоні',ok:rsiNormal},
  {label:'MACD підтверджує напрямок',ok:macdAligned},
  {label:'Обсяг не нижче середнього',ok:volumeActive}
 ];
 const passed=checks.filter(c=>c.ok).length;
 if(passed<2)return null;
 const pending=checks.filter(c=>!c.ok).map(c=>c.label);
 return {symbol,side,passed,total:checks.length,aligned,frames:rows.length,
  up,down,mixed:rows.length-up-down,rsi:h1.rsi,relativeVolume:volumePresent?h1.relVolume:null,
  atrPct:finite(h1.atr)&&h1.price>0?100*h1.atr/h1.price:null,
  checkedAt:asOf,timeframes:frameSummary(frames),hasTradePlan:false,
  reason:aligned?'1год і 4год показують узгоджений напрямок EMA.':
   'Є рух або ознаки імпульсу, але 1год і 4год поки не узгоджені.',
  waitFor:pending.length?pending.slice(0,2):['Підтвердити актуальний вхід, SL/TP, R:R і ліквідність'],
  disclosure:'Рейтинг уваги за 5 перевірками, не ймовірність прибутку. Це не сигнал до входу.'};
}
export function createMarketScanner({getKlines,getInstruments,historyPath=null,onPromotion=()=>{},onCycle=async()=>{}}){
  let snapshot={status:'starting',updatedAt:null,startedAt:null,completed:0,total:0,watchlist:WATCHLIST.slice(),
    opportunities:[],attention:[],alerts:[],errors:[],mode:'local-background',ordersEnabled:false};
  let scanning=false,closed=false,history=[],alerts=[],hasBaseline=false,previousWatching=new Set(),previousOpportunities=new Set(),sequence=0;
  async function scan(){
    if(scanning||closed)return;
    scanning=true;const start=new Date().toISOString(),found=[],attention=[],errors=[];
    const allowed=await getInstruments().catch(e=>{errors.push('Список пар: '+String(e.message).slice(0,90));return []});
    const list=WATCHLIST.filter(x=>ALLOWED.has(x)&&allowed.includes(x));
    snapshot={...snapshot,status:'scanning',startedAt:start,completed:0,total:list.length,errors:[],watchlist:list};
    for(const symbol of list){
      if(closed)break;
      try{
        const frames={};
        // Stagger requests to stay within public market API rate limits.
        for(const tf of REQUIRED){
          const data=await getKlines(symbol,tf);
          // A forming candle must NEVER count as a confirmed trend or an entry.
          frames[tf]=analyze(data.candles.filter(c=>c.t+BAR_MS[tf]<=Date.now()),tf);
        }
        const scannedAt=new Date().toISOString();
        const item=proposal(symbol,frames,scannedAt);
        if(item)found.push(item);
        const watch=attentionCandidate(symbol,frames,scannedAt);
        if(watch)attention.push({...watch,hasTradePlan:Boolean(item)});
      }catch(e){errors.push(symbol+': '+String(e.message||e).slice(0,90))}
      snapshot={...snapshot,completed:snapshot.completed+1};
    }
    found.sort((a,b)=>b.confirmations-a.confirmations||b.rr-a.rr);
    attention.sort((a,b)=>b.passed-a.passed||Number(b.aligned)-Number(a.aligned)||a.symbol.localeCompare(b.symbol));
    // Alert only on a transition from an observed pair into a NEW qualified setup.
    // First scan establishes baseline; no startup storm or repeated alerts on every refresh.
    const currentOpportunities=new Set(found.map(x=>x.symbol+'|'+x.side));
    const currentWatching=new Set(attention.map(x=>x.symbol));
    if(hasBaseline){
      for(const item of found){
        const key=item.symbol+'|'+item.side;
        if(previousWatching.has(item.symbol)&&!previousOpportunities.has(key)){
          const alert={id:++sequence,symbol:item.symbol,side:item.side,entry:item.entry,
            stop:item.stop,target:item.target,rr:item.rr,createdAt:new Date().toISOString(),
            message:'Пара під наглядом перейшла до торгового плану; перевірте актуальність перед входом.'};
          alerts.unshift(alert);
          try{onPromotion({...alert})}catch{}
        }
      }
    }
    hasBaseline=true;previousWatching=currentWatching;previousOpportunities=currentOpportunities;
    alerts=alerts.slice(0,50);
    const prior=new Set(snapshot.opportunities.map(x=>x.symbol+'|'+x.side));
    for(const item of found){
      if(!prior.has(item.symbol+'|'+item.side)){
        history.unshift({...item,detectedAt:new Date().toISOString()});
      }
    }
    history=history.slice(0,100);
    if(historyPath){
      try{
        await mkdir(dirname(historyPath),{recursive:true,mode:0o700});
        await writeFile(historyPath,JSON.stringify({version:1,history},null,2),{mode:0o600});
      }catch(e){errors.push('Не вдалося зберегти історію сканування')}
    }
    snapshot={...snapshot,status:errors.length&&errors.length===list.length?'error':'ready',updatedAt:new Date().toISOString(),
      opportunities:found.slice(0,15),attention:attention.slice(0,10),alerts:alerts.slice(),errors,completed:list.length,total:list.length};
    try{await onCycle({opportunities:found,checkedAt:snapshot.updatedAt})}
    catch(e){snapshot.errors=[...snapshot.errors,'Журнал paper trading: '+String(e.message||e).slice(0,90)]}
    scanning=false;
  }
  let timer=null;
  const start=()=>{
    (async()=>{
      if(historyPath){
        try{
          const raw=JSON.parse(await readFile(historyPath,'utf8'));
          if(Array.isArray(raw.history))history=raw.history.slice(0,100);
        }catch{}
      }
      await scan();
    })().catch(()=>{scanning=false;snapshot={...snapshot,status:'error',errors:['Помилка сканера']}});
    timer=setInterval(()=>scan().catch(()=>{scanning=false}),REFRESH_MS);
    timer.unref?.();
  };
  const stop=()=>{closed=true;clearInterval(timer)};
  const getSnapshot=()=>({...snapshot,opportunities:snapshot.opportunities.filter(x=>Date.now()-Date.parse(x.scannedAt)<REFRESH_MS*2),attention:snapshot.attention.filter(x=>Date.now()-Date.parse(x.checkedAt)<REFRESH_MS*2)});
  const getHistory=()=>history.slice(0,100).map(x=>({...x}));
  const getAlerts=()=>alerts.map(x=>({...x}));
  return {start,stop,getSnapshot,getHistory,getAlerts,refresh:scan};
}
