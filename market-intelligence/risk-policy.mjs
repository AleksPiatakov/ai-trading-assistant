/**
 * Market Intelligence risk guard: 1% of current account equity per proposed trade
 * and 3% TOTAL loss at stops across active positions plus proposed exposure.
 *
 * Conservative stop loss / cost estimates, NOT a guaranteed maximum loss:
 * gaps, liquidation, funding, slippage beyond assumption and exchange failures.
 * Read-only. Never creates orders.
 */
export const RISK_POLICY=Object.freeze({perTradePct:1,portfolioPct:3,feePerSide:0.00055,slippagePerSide:0.0005});
const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const round=(n,d=6)=>Number(n.toFixed(d));
function riskForUnit(side,entry,stop,policy){
 const adverse=side==='long'?entry-stop:stop-entry;
 if(!(entry>0&&stop>0&&adverse>0))return null;
 return adverse+(entry+stop)*(policy.feePerSide+policy.slippagePerSide);
}
function countPositions(positions,policy){
 let risk=0;
 for(const p of positions){
  const size=num(p.size),entry=num(p.avgPrice),mark=num(p.markPrice),stop=num(p.stopLoss);
  if(!(size>0))continue;
  if(!(entry>0&&mark>0&&stop>0))return null;
  const side=p.side==='Buy'?'long':p.side==='Sell'?'short':null;
  // totalEquity already includes unrealised PnL: use the more conservative
  // current-mark-to-stop vs original-entry-to-stop risk reference.
  const reference=side==='long'?Math.max(entry,mark):Math.min(entry,mark);
  const perUnit=side&&riskForUnit(side,reference,stop,policy);
  if(perUnit===null)return null;
  risk+=size*perUnit;
 }
 return risk;
}
export function sizeTrade({equity,positions,orders,plan,policy=RISK_POLICY}){
 const blocked=(reason,more={})=>({status:'blocked',reason,ordersEnabled:false,
  limits:{perTradePct:policy.perTradePct,portfolioPct:policy.portfolioPct},...more});
 const capital=num(equity);
 if(!(capital>0))return blocked('Немає підтвердженого актуального totalEquity Bybit Demo');
 if(!Array.isArray(positions)||!Array.isArray(orders))return blocked('Позиції або заявки недоступні: сукупний ризик не можна перевірити');
 // Any outstanding order can add position risk; do not assume its future fill is zero.
 if(orders.some(o=>!['Filled','Cancelled','Rejected','Deactivated','PartiallyFilledCanceled'].includes(o.orderStatus)))
  return blocked('Є незавершені або неперевірені заявки: їхній ризик необхідно врахувати');
 for(const p of positions){
  if(!(num(p.size)>0))continue;
  const side=p.side==='Buy'?'long':p.side==='Sell'?'short':null;
  const stop=num(p.stopLoss),entry=num(p.avgPrice),mark=num(p.markPrice);
  const reference=side==='long'?Math.max(entry,mark):Math.min(entry,mark);
  if(!side||!(entry>0&&mark>0&&stop>0)||riskForUnit(side,reference,stop,policy)===null)
   return blocked('Є відкрита позиція без коректного Stop Loss: резерв ризику неможливо встановити');
 }
 const currentRisk=countPositions(positions,policy);
 if(currentRisk===null)return blocked('Не вдалося розрахувати ризик відкритих позицій');
 const availableBudget=Math.max(0,capital*policy.portfolioPct/100-currentRisk);
 const singleBudget=capital*policy.perTradePct/100;
 const budget=Math.min(singleBudget,availableBudget);
 if(budget<=0)return blocked('Сукупний ліміт 3% вичерпано', {equity:capital,currentRisk:round(currentRisk),remainingRisk:0});
 if(!plan)return blocked('Оберіть підтверджений актуальний торговий план');
 const side=plan.side;
 const entry=num(plan.entry),stop=num(plan.stop),target=num(plan.target);
 if(!['long','short'].includes(side)||!(entry>0&&stop>0&&target>0))
  return blocked('Некоректні рівні торгового плану');
 if(side==='long'&&!(stop<entry&&target>entry)||side==='short'&&!(stop>entry&&target<entry))
  return blocked('Stop Loss або Take Profit не відповідають напрямку');
 const unitLoss=riskForUnit(side,entry,stop,policy);
 if(!(unitLoss>0))return blocked('Неможливо оцінити збиток одиниці позиції');
 const maxQuantity=budget/unitLoss;
 // Do not prescribe an exchange quantity without instrument lot-size / tick-size metadata.
 return {status:'calculated',ordersEnabled:false,requiresExchangeQtyStep:true,
  symbol:plan.symbol,side,entry,stop,target,equity:capital,
  limits:{perTradePct:policy.perTradePct,portfolioPct:policy.portfolioPct},
  riskPerUnit:round(unitLoss,8),currentRisk:round(currentRisk),
  perTradeBudget:round(singleBudget),remainingPortfolioBudget:round(availableBudget),
  allowedLoss:round(budget),maxQuantityUnrounded:round(maxQuantity,8),
  notionalUnrounded:round(maxQuantity*entry,2),
  warning:'Розрахунок умовний. Лоти, крок кількості, маржа, фактичний спред і funding ще не перевірені. Прослизання або ціновий розрив можуть призвести до збитку понад 1%. Реальні ордери вимкнено.'};
}
