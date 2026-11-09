/**
 * Deterministic walk-forward verification of the SAME 4-timeframe strategy as scanner.
 * Signals use only candles that closed before evaluation; fills occur at the NEXT 1h open.
 * Conservative rule: if stop and target are touched in the same OHLC bar, stop wins.
 * No orders, leverage, profit prediction, exchange credentials or remote reporting.
 */
import {evaluateTradeSetup} from './market-scanner.mjs';
const MS={'15':900000,'60':3600000,'240':14400000,D:86400000};
const COST={feePerSide:0.00055,slippagePerSide:0.0005};
export const tradingCosts=Object.freeze(COST);
export function completedCandles(candles,tf,now=Date.now()){
 const duration=MS[tf];if(!duration)throw Error('Unsupported backtest timeframe');
 return candles.filter(c=>Number.isFinite(c.t)&&c.t+duration<=now&&
   [c.o,c.h,c.l,c.c,c.v].every(Number.isFinite)&&c.o>0&&c.h>=Math.max(c.o,c.c)&&c.l<=Math.min(c.o,c.c))
  .sort((a,b)=>a.t-b.t).filter((c,i,a)=>i===0||c.t!==a[i-1].t);
}
const clampFinite=n=>Number.isFinite(n)?n:null;
export function scoreTrades(trades){
 const finished=trades.filter(t=>t.status==='closed'&&Number.isFinite(t.netR));
 if(!finished.length)return {closed:0,winRate:null,profitFactor:null,maxDrawdownR:null,expectancyR:null,totalNetR:0,losses:0,wins:0};
 const wins=finished.filter(x=>x.netR>0).length,losses=finished.length-wins;
 const profit=finished.reduce((a,t)=>a+Math.max(0,t.netR),0),loss=finished.reduce((a,t)=>a+Math.max(0,-t.netR),0);
 let equity=0,peak=0,drawdown=0;
 for(const t of finished){equity+=t.netR;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity)}
 return {closed:finished.length,wins,losses,winRate:100*wins/finished.length,
  profitFactor:loss===0?null:profit/loss,maxDrawdownR:drawdown,
  expectancyR:equity/finished.length,totalNetR:equity};
}
export function verifyStrategy({symbol,series,costs=COST,maxHoldBars=48,maxSignals=20000}){
 if(!/^[A-Z0-9]{3,30}USDT$/.test(symbol))throw Error('Invalid market symbol');
 const frames=Object.fromEntries(Object.keys(MS).map(tf=>[tf,completedCandles(series[tf]||[],tf)]));
 const hours=frames['60'];if(hours.length<220)throw Error('Not enough completed 1h candles for EMA200 warm-up');
 const trades=[];let noSignal=0,skipped=0;
 // Advancing cursors avoid scanning the full history for EVERY hourly decision.
 const cursors=Object.fromEntries(Object.keys(MS).map(tf=>[tf,0]));
 for(let i=219;i<hours.length-1&&trades.length<maxSignals;i++){
  const signalAt=hours[i].t+MS['60'];
  const history={};let enough=true;
  for(const tf of Object.keys(MS)){
   const data=frames[tf];
   while(cursors[tf]<data.length&&data[cursors[tf]].t+MS[tf]<=signalAt)cursors[tf]++;
   if(cursors[tf]<200){enough=false;break}
   history[tf]=data.slice(Math.max(0,cursors[tf]-220),cursors[tf]);
  }
  if(!enough){skipped++;continue}
  const plan=evaluateTradeSetup(symbol,history,signalAt);
  if(!plan){noSignal++;continue}
  const next=hours[i+1];
  const adverse=plan.side==='long'?1:-1;
  const entry=next.o*(1+adverse*costs.slippagePerSide);
  const stop=plan.stop,target=plan.target;
  const risk=Math.abs(entry-stop),direction=plan.side==='long'?1:-1;
  if(!(risk>0&&direction*(entry-stop)>0&&direction*(target-entry)>0)){skipped++;continue}
  const grossR=direction*(target-entry)/risk;
  if(grossR<1.5){skipped++;continue}
  let done=null,exitIndex=null;
  for(let j=i+1;j<hours.length&&j<=i+maxHoldBars;j++){
   const candle=hours[j];
   const hitStop=plan.side==='long'?candle.l<=stop:candle.h>=stop;
   const hitTarget=plan.side==='long'?candle.h>=target:candle.l<=target;
   if(hitStop||hitTarget){
    // A stop-market fill can be worse than the stop after an adverse opening gap.
    const worstStop=plan.side==='long'?Math.min(stop,candle.o):Math.max(stop,candle.o);
    const level=hitStop?worstStop:target;
    const exit=level*(1-direction*costs.slippagePerSide);
    done={exit,reason:hitStop?'stop':'target',ambiguous:hitStop&&hitTarget};
    exitIndex=j;break;
   }
   if(j===i+maxHoldBars){
    const exit=candle.c*(1-direction*costs.slippagePerSide);
    done={exit,reason:'timeout',ambiguous:false};exitIndex=j;
   }
  }
  if(!done){skipped++;break}
  const gross=direction*(done.exit-entry)/risk;
  const fees=costs.feePerSide*(entry+done.exit)/risk;
  trades.push({symbol,side:plan.side,signalAt:new Date(signalAt).toISOString(),
   entryAt:new Date(next.t).toISOString(),exitAt:new Date(hours[exitIndex].t+MS['60']).toISOString(),
   entry,stop,target,exit:done.exit,reason:done.reason,ambiguous:done.ambiguous,
   grossR:gross,feesR:fees,netR:gross-fees,status:'closed'});
  i=exitIndex; // No overlapping trades on the same instrument.
 }
 const metrics=scoreTrades(trades);
 return {symbol,method:'walk-forward-closed-candles-next-open-stop-first',source:'Bybit public OHLCV',
  costs:{...costs},timeframes:['15','60','240','D'],ordersEnabled:false,
  period:{from:hours[0]&&new Date(hours[0].t).toISOString(),to:hours.at(-1)&&new Date(hours.at(-1).t+MS['60']).toISOString()},
  bars:{h1:hours.length,m15:frames['15'].length,h4:frames['240'].length,daily:frames.D.length},
  skipped,noSignal,metrics,trades:trades.slice(-5000),warning:trades.length<30?
   'Замало угод для статистично стійкого висновку. Минулі результати не прогнозують майбутнє.':
   'Історичний результат не гарантує прибутковості. Перевір на даних поза періодом тесту.'};
}
