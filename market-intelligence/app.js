'use strict';
/* Market Intelligence MVP: signal-first presentation of real, server-calculated plans.
 * Secrets never live in this file or localStorage. All trading actions are disabled.
 */
const $=id=>document.getElementById(id);
let snapshot=null,universeStatus=null,selectedMarket='all',page='opportunities',selectedPlan=null;
const STARTUP=Date.now(),MAX_AGE=20*60*1000,STORAGE_KEY='market-intelligence-saved-plans-v1';
const safeSymbol=s=>typeof s==='string'&&/^[A-Z0-9]{3,30}USDT$/.test(s);
const finite=n=>Number.isFinite(Number(n))&&n!==null&&n!==''?Number(n):null;
const fprice=n=>{const v=finite(n);return v===null?'—':v.toLocaleString('en-US',{minimumFractionDigits:v<1?Math.min(8,Math.max(4,-Math.floor(Math.log10(v))+2)):2,maximumFractionDigits:v<1?8:2})};
const pct=n=>finite(n)===null?'—':(Number(n)>0?'+':'')+Number(n).toFixed(2)+'%';
const el=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e};
const append=(root,...children)=>{root.append(...children);return root};
const timestamp=iso=>{const t=Date.parse(iso||'');return Number.isFinite(t)?new Date(t).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}):'—'};
const isFresh=p=>safeSymbol(p?.symbol)&&p?.state==='plan'&&p?.ordersEnabled===false&&Number.isFinite(Date.parse(p.scannedAt))&&Date.now()-Date.parse(p.scannedAt)>=0&&Date.now()-Date.parse(p.scannedAt)<=MAX_AGE&&
 ['long','short'].includes(p.side)&&[p.entry,p.stop,p.target,p.rr].every(x=>finite(x)!==null)&&Number(p.rr)>=1.5&&
 (p.side==='long'?(Number(p.stop)<Number(p.entry)&&Number(p.entry)<Number(p.target)):(Number(p.target)<Number(p.entry)&&Number(p.entry)<Number(p.stop)));
function navigate(next){
 page=next;document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-'+next));
 document.querySelectorAll('[data-page]').forEach(n=>n.classList.toggle('active',n.dataset.page===next));
 const label={opportunities:'Можливості',plans:'Мої плани',insights:'Аналітика',settings:'Підключення'}[next];
 $('crumb').textContent=label;
 if(next==='plans')drawPlans();
 if(next==='insights')loadPaperResults();
 if(next==='settings')loadDemoStatus();
}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));
$('openSettings').onclick=()=>navigate('settings');
document.querySelectorAll('[data-market]').forEach(button=>button.addEventListener('click',()=>{
 selectedMarket=button.dataset.market;
 document.querySelectorAll('[data-market]').forEach(b=>b.classList.toggle('active',b===button));
 drawOpportunities();
}));
function availabilityMessage(){
 const messages={stocks:'Акції та ETF поки не підключені. Сигнали без перевірених даних не показуються.',forex:'Forex поки не підключений. Для сигналів потрібен ліцензований потік котирувань.',commodities:'Сировинні інструменти ще не підключені. Потрібне надійне джерело даних.'};
 return messages[selectedMarket]||'';
}
function setStatus(text,error=false){
 $('statusline').textContent=text;
 $('statusline').classList.toggle('error',error);
 $('statusline').parentElement.classList.toggle('error',error);
}
function drawScannerMetrics(){
 const state=snapshot?.status;
 if(!snapshot||state==='starting'){
  for(const id of ['metricChecked','metricReady','metricWatch'])$(id).textContent='—';
  $('diagnosticsBody').textContent='Очікуємо першого сканування.';return;
 }
 const checked=Number(snapshot.completed)||0;
 const plans=verified();
 const countWatch=Array.isArray(snapshot.watch)?snapshot.watch.length:0;
 $('metricChecked').textContent=String(checked);
 $('metricReady').textContent=String(plans.length);
 $('metricWatch').textContent=String(countWatch);
 const errors=Array.isArray(snapshot.errors)?snapshot.errors:[];
 const notes=[
  'Стан: '+({ready:'перевірку завершено',partial:'частково завершено',scanning:'триває перевірка',error:'помилка джерела'}[state]||'очікування'),
  'Перевірено '+checked+' із '+(Number(snapshot.total)||0)+' інструментів.',
  'Кандидати під наглядом — не готові сигнали.',
  'Ринки без підключеного провайдера не скануються.'
 ];
 if(errors.length){
  notes.push('Помилок джерела: '+errors.length+'.');
  notes.push(...errors.slice(0,5).map(x=>String(x).slice(0,160)));
  if(errors.length>5)notes.push('Решта помилок: '+(errors.length-5));
 }
 $('diagnosticsBody').textContent=notes.join('\n');
}
function setConnection(ok,label){
 const pill=$('connectionPill');pill.classList.toggle('offline',!ok);
 pill.lastChild.textContent=' '+label;
}
function isCryptoView(){return selectedMarket==='all'||selectedMarket==='crypto'}
function planSort(a,b){return Number(b.confirmations)-Number(a.confirmations)||Number(b.rr)-Number(a.rr)||Number(b.turnover24h)-Number(a.turnover24h)}
function verified(){
 return (Array.isArray(snapshot?.opportunities)?snapshot.opportunities:[]).filter(isFresh).sort(planSort);
}
function priceValue(parent,name,value,type){
 const block=el('div','signal-value '+type);
 append(block,el('span','',name),el('strong','',fprice(value)));
 parent.append(block);
}
function showBest(root,plan){
 const card=el('div','signal-card');
 const left=el('div','signal-main'),right=el('div','signal-aside');
 const eyebrow=el('div','signal-eyebrow');append(eyebrow,el('span','signal-ready','● План сформовано'),el('span','','BYBIT · КРИПТО'));
 left.append(eyebrow);
 const head=el('div','signal-symbol');
 append(head,el('h3','',plan.symbol),el('span','direction '+(plan.side==='long'?'long':'short'),plan.side==='long'?'↗ LONG':'↘ SHORT'));
 left.append(head,el('div','signal-meta','1 година · підтверджень '+(plan.confirmations??'—')+'/4 · оновлено '+timestamp(plan.scannedAt)));
 const values=el('div','signal-values');
 priceValue(values,'Зона входу',plan.entry,'entry');priceValue(values,'Stop Loss',plan.stop,'stop');priceValue(values,'Take Profit',plan.target,'target');
 left.append(values);
 const foot=el('div','signal-footer');
 append(foot,el('span','', 'R:R · '+Number(plan.rr).toFixed(2)),el('span','','24 год обіг · '+Math.round(Number(plan.turnover24h)||0).toLocaleString('en-US')+' USDT'));
 left.append(foot);
 right.append(el('div','signal-aside-label','ЧОМУ ВІДІБРАНО'));
 for(const reason of (Array.isArray(plan.reasons)?plan.reasons:[]).slice(0,4)){
  const item=el('div','why-item');append(item,el('span','why-check','✓'),el('span','',reason));right.append(item);
 }
 right.append(el('div','signal-warning','Це алгоритмічний план, а не гарантія прибутку. Ціна та витрати можуть змінитися.'));
 const actions=el('div','signal-actions'),more=el('button','primary-button','Переглянути план →'),save=el('button','ghost-button','☆ Зберегти');
 more.onclick=()=>openPlan(plan);save.onclick=()=>{savePlan(plan);save.textContent='✓ Збережено'};
 append(actions,more,save);right.append(actions);
 append(card,left,right);root.append(card);
}
function watchRow(t){
 const row=el('tr','watch-row');
 const isScored=Number.isFinite(t.readinessPassed)&&Number.isFinite(t.readinessTotal);
 const score=isScored?t.readinessPassed+'/'+t.readinessTotal:'—';
 const columns=[
  [t.symbol,'watch-symbol'],
  [fprice(t.lastPrice),'watch-number'],
  [t.side==='long'?'↗ Висхідний':t.side==='short'?'↘ Низхідний':'—','watch-direction'],
  [score,'watch-score'],
  [t.reason||'Немає підтвердженого плану','watch-reason']
 ];
 for(const [value,cls] of columns){
  const cell=el('td',cls,value);
  if(cls==='watch-reason'){
   const tag=t.state==='near'?'Близько до входу':t.tradeFeasibility?.validLevels?'План не готовий':'Немає рівнів';
   cell.prepend(el('span','readiness-tag '+(t.state==='near'?'near':'watch'),tag));
   const summary=t.tradeFeasibility;
   if(summary?.netRR!==null&&Number.isFinite(summary?.netRR)){
    cell.append(el('span','watch-rr',' · R:R після модельних витрат '+summary.netRR.toFixed(2)));
   }
  }
  row.append(cell);
 }
 const action=el('td','watch-action-cell');
 const btn=el('button','watch-more','Детальніше');
 btn.type='button';btn.setAttribute('aria-label','Детальний аналіз '+t.symbol);
 btn.onclick=()=>openWatch(t);action.append(btn);row.append(action);
 row.onclick=event=>{if(!event.target.closest('button'))openWatch(t)};
 return row;
}
function showWatchChart(root,candles){
 const good=(Array.isArray(candles)?candles:[]).filter(x=>[x.t,x.c].every(Number.isFinite)&&x.c>0).sort((a,b)=>a.t-b.t).slice(-90);
 if(good.length<3){root.append(el('p','muted','Недостатньо завершених свічок для графіка.'));return}
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 600 185');svg.setAttribute('role','img');
 svg.setAttribute('aria-label','Графік закриття останніх '+good.length+' годинних свічок Bybit');
 svg.classList.add('watch-svg');
 const prices=good.map(x=>x.c),lo=Math.min(...prices),hi=Math.max(...prices),span=Math.max(hi-lo,hi*.002);
 const points=prices.map((n,i)=>(15+570*i/(prices.length-1)).toFixed(1)+','+(165-145*(n-lo)/span).toFixed(1)).join(' ');
 for(const y of [25,65,105,145]){
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');
  for(const [k,v] of Object.entries({x1:15,x2:585,y1:y,y2:y,stroke:'#334e70','stroke-width':1}))line.setAttribute(k,String(v));
  svg.append(line);
 }
 const poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
 for(const [k,v] of Object.entries({points,fill:'none',stroke:'#80b9ff','stroke-width':'2.5','stroke-linecap':'round','stroke-linejoin':'round'}))poly.setAttribute(k,String(v));
 svg.append(poly);root.append(svg);
 root.append(el('p','watch-chart-caption','Bybit Public · закриті 1-годинні свічки · остання ціна '+fprice(prices.at(-1))+'. Графік не визначає готову точку входу.'));
}
let watchRequestSeq=0;
async function openWatch(t){
 if(!safeSymbol(t.symbol))return;
 const root=$('watchDetails');root.replaceChildren();
 const heading=el('div','watch-detail-heading');
 append(heading,el('h2','',t.symbol),el('span','watch-detail-label',t.state==='near'?'Близько до підтвердження':'Під спостереженням'));
 root.append(heading);
 root.append(el('p','watch-detail-subtitle','Bybit USDT perpetual · дериватив, не акція чи ETF · 1 година'));
 const grid=el('div','watch-detail-grid');
 for(const [name,val] of [
  ['Поточна ціна',fprice(t.lastPrice)],
  ['Зміна за 24 год',pct(t.change24h)],
  ['Умови торгового плану',Number.isFinite(t.readinessPassed)?t.readinessPassed+'/'+t.readinessTotal:'Немає оцінки'],
  ['Ринкова ситуація',Number.isFinite(t.marketQuality?.passed)?t.marketQuality.passed+'/5 критеріїв':'Не визначено']
 ]){
  const item=el('div','watch-detail-stat');append(item,el('span','',name),el('strong','',val));grid.append(item);
 }
 root.append(grid);
 const feasibility=t.tradeFeasibility||{};
 const feasibilityBox=el('section','watch-feasibility');
 feasibilityBox.append(el('h3','','Придатність угоди'));
 const result=feasibility.status==='conditional'?'Рівні та витрати прийнятні, бракує підтвердження ринку':
  feasibility.status==='blocked'?'Умови входу не виконані':
  'Недостатньо даних для торгового плану';
 feasibilityBox.append(el('p','',result));
 const checks=el('div','watch-feasibility-metrics');
 for(const [name,value] of [
  ['Оціночне R:R після витрат',Number.isFinite(feasibility.netRR)?feasibility.netRR.toFixed(2):'—'],
  ['Ризик до SL',Number.isFinite(feasibility.riskPct)?feasibility.riskPct.toFixed(2)+'%':'—'],
  ['Обіг 24 год',Number.isFinite(feasibility.turnover24h)?Math.round(feasibility.turnover24h).toLocaleString('en-US')+' USDT':'—']]){
  const item=el('div','watch-feasibility-item');item.append(el('span','',name),el('strong','',value));checks.append(item);
 }
 feasibilityBox.append(checks);root.append(feasibilityBox);
 const preview=t.scenario;
 if(preview?.status==='hypothetical'){
  const previewBox=el('section','watch-preview');
  previewBox.append(el('h3','','Попередній сценарій · НЕ СИГНАЛ'));
  const levels=el('div','watch-preview-levels');
  for(const [name,value] of [['Напрямок',preview.side==='long'?'LONG':'SHORT'],
   ['Умовний вхід',fprice(preview.entry)],['Попередній SL',fprice(preview.stop)],
   ['Попередній TP',fprice(preview.target)]]){
   const cell=el('div','watch-preview-level');cell.append(el('span','',name),el('strong','',value));levels.append(cell);
  }
  previewBox.append(levels,el('p','',preview.warning||'Попередні рівні не є торговою рекомендацією.'));
  root.append(previewBox);
 }
 const explain=el('div','watch-detail-explain');
 explain.append(el('h3','','Що заважає готовому входу'));
 const pending=Array.isArray(t.waitFor)&&t.waitFor.length?t.waitFor:[t.reason||'Підтвердити всі умови готового торгового плану'];
 const ul=el('ul');
 for(const item of pending)ul.append(el('li','',item));
 explain.append(ul,el('p','', 'Кількість виконаних умов — не ймовірність успіху. Рівні у попередньому сценарії не можна використовувати як підтверджений сигнал. Справжній спред, funding та ліквідність у стакані ще не перевірені.'));
 root.append(explain);
 if(Array.isArray(t.timeframes)&&t.timeframes.length){
  const table=el('div','watch-timeframes');
  table.append(el('h3','','Тренди за таймфреймами'));
  const list=el('div','watch-tf-list');
  const names={'15':'15 хв','60':'1 год','240':'4 год','D':'1 день'};
  for(const tf of t.timeframes){
   const row=el('div','watch-tf-item');
   append(row,el('b','',names[tf.tf]||tf.tf),
    el('span','',tf.direction==='up'?'↗ Висхідний':tf.direction==='down'?'↘ Низхідний':'↔ Змішаний'),
    el('span','',Number.isFinite(tf.rsi)?'RSI '+tf.rsi.toFixed(1):'RSI —'));
   list.append(row);
  }
  table.append(list);root.append(table);
 }
 const chart=el('div','watch-chart');chart.append(el('h3','','Ціновий графік'),el('p','muted','Завантажуємо закриті свічки…'));root.append(chart);
 $('watchDialog').showModal();
 const seq=++watchRequestSeq;
 try{
  const data=await request('/api/market/candles?symbol='+encodeURIComponent(t.symbol));
  if(seq!==watchRequestSeq||!$('watchDialog').open)return;
  chart.replaceChildren(el('h3','','Ціновий графік'));
  showWatchChart(chart,data.candles);
 }catch(error){
  if(seq===watchRequestSeq&&$('watchDialog').open){
   chart.replaceChildren(el('h3','','Ціновий графік'),el('p','error-text','Немає актуальних даних: '+String(error.message||error)));
  }
 }
}
$('closeWatch').onclick=()=>{$('watchDialog').close();watchRequestSeq++};
$('watchDialog').onclick=e=>{if(e.target===$('watchDialog')){$('watchDialog').close();watchRequestSeq++}};
function drawOpportunities(){
 const root=$('featured'),list=$('watchList');root.replaceChildren();list.replaceChildren();
 const marketNotice=availabilityMessage();
 const plans=isCryptoView()?verified():[];
 if(plans.length)showBest(root,plans[0]);
 else{
  const empty=el('div','empty-state');
  const symbol=el('span','empty-symbol');symbol.textContent='◷';
  append(empty,symbol,
   el('h3','',marketNotice?'Дані ринку не підключені':snapshot?.status==='scanning'?'Перевіряємо торгові сценарії':'Готових входів зараз немає'),
   el('p','',marketNotice||'Система продовжує перевірку. Нижче — інструменти під наглядом; вони ще не є сигналами для входу.'));
  root.append(empty);
 }
 const watch=(isCryptoView()&&Array.isArray(snapshot?.watch)?snapshot.watch:[]).filter(t=>safeSymbol(t.symbol)).slice(0,18);
 $('watchCount').textContent=String(watch.length);
 const nearCount=watch.filter(x=>x.state==='near').length;
 const section=document.querySelector('.secondary-section .section-aside');
 if(section)section.textContent=nearCount?
  'Близько до підтвердження: '+nearCount+' · не сигнали до входу':
  'Критерії торгового плану · не прогноз прибутку';
 if(!isCryptoView()){
  const tr=el('tr'),td=el('td','quiet-message',marketNotice);td.colSpan=6;tr.append(td);list.append(tr);
}
 else if(!watch.length){
  const tr=el('tr'),td=el('td','quiet-message','Пари під спостереженням з’являться після завершення сканування.');
  td.colSpan=6;tr.append(td);list.append(tr);
}
 else for(const t of watch)list.append(watchRow(t));
 $('lastScan').textContent=snapshot?.updatedAt?'Оновлено о '+timestamp(snapshot.updatedAt):'Очікуємо сканування';
 drawScannerMetrics();
}
async function renderPlanRisk(plan,root){
 root.replaceChildren(el('p','muted','Розраховуємо ризик за актуальним Demo-рахунком…'));
 try{
  const result=await request('/api/risk/plan?symbol='+encodeURIComponent(plan.symbol));
  root.replaceChildren();
  const head=el('h4','','Ризик: не більше 1% на угоду · 3% сукупно');root.append(head);
  if(result.status!=='calculated'){
   root.append(el('p','error-text','Розрахунок заблоковано: '+(result.reason||'Немає перевірених даних')));
   return;
  }
  const details=el('div','risk-summary-grid');
  const show=(name,value)=>{
   const item=el('div','risk-summary-item');append(item,el('span','',name),el('strong','',value));details.append(item);
  };
  show('Капітал Demo',fprice(result.equity)+' USDT');
  show('Ліміт 1%',fprice(result.perTradeBudget)+' USDT');
  show('Вже зайнятий ризик',fprice(result.currentRisk)+' USDT');
  show('Доступний ризик',fprice(result.allowedLoss)+' USDT');
  show('Макс. теоретична кількість',String(result.maxQuantityUnrounded));
  show('Оціночний номінал',fprice(result.notionalUnrounded)+' USDT');
  root.append(details,el('p','risk-warning',result.warning));
 }catch(error){root.replaceChildren(el('p','error-text','Немає актуального підтвердженого розрахунку ризику: '+error.message))}
}
function openPlan(p){
 if(!isFresh(p)){setStatus('Цей план застарів. Оновіть аналіз перед розглядом.',true);return}
 selectedPlan=p;
 const root=$('planDetails');root.replaceChildren();
 const body=el('div','plan-body');
 const head=el('div','signal-symbol');
 append(head,el('h2','',p.symbol),el('span','direction '+p.side,p.side==='long'?'↗ LONG':'↘ SHORT'));
 body.append(head,el('p','','Bybit · USDT Perpetual · 1 година · сформовано о '+timestamp(p.scannedAt)));
 const grid=el('div','plan-stats');
 for(const [name,value] of [['Вхід',p.entry],['Stop Loss',p.stop],['Take Profit',p.target],['R:R','1 : '+Number(p.rr).toFixed(2)],['Підтверджень',(p.confirmations??'—')+' / 4'],['Відносний ризик',Math.abs((Number(p.entry)-Number(p.stop))/Number(p.entry)*100).toFixed(2)+'%']]){
  const stat=el('div','plan-stat');append(stat,el('span','',name),el('strong','',typeof value==='number'?fprice(value):String(value)));grid.append(stat);
 }
 body.append(grid);
 const riskBox=el('section','plan-risk-box');body.append(riskBox);
 void renderPlanRisk(p,riskBox);
 const map=el('div','price-map');
 const levels=p.side==='long'?[['Take Profit',p.target,'tp'],['Entry',p.entry,'entry'],['Stop Loss',p.stop,'sl']]:[['Stop Loss',p.stop,'sl'],['Entry',p.entry,'entry'],['Take Profit',p.target,'tp']];
 for(const [name,n,type] of levels){const line=el('div','price-line '+type);append(line,el('b','',name),el('strong','',fprice(n)));map.append(line)}body.append(map);
 const note=el('div','note-box');append(note,el('h4','','Пояснення сценарію'),el('p','',(Array.isArray(p.reasons)?p.reasons:[]).join(' · ')||'Пояснення недоступне'));body.append(note);
 const warn=el('div','note-box');append(warn,el('h4','','Умови та обмеження'),el('p','',p.warning||'Оціночні рівні, комісії, спред і прослизання не враховані. Скасувати план, якщо ціна чи ринкові умови змінилися.'));body.append(warn);
 const buttons=el('div','dialog-actions'),close=el('button','ghost-button','Закрити'),save=el('button','primary-button','☆ Зберегти план');
 close.onclick=()=>$('planDialog').close();save.onclick=()=>{savePlan(p);save.textContent='✓ Збережено'};
 append(buttons,close,save);body.append(buttons);root.append(body);
 $('planDialog').showModal();
}
$('closePlan').onclick=()=>$('planDialog').close();
$('planDialog').onclick=e=>{if(e.target===$('planDialog'))$('planDialog').close()};
function saved(){
 try{const a=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return Array.isArray(a)?a.filter(p=>safeSymbol(p.symbol)&&['long','short'].includes(p.side)).slice(0,100):[]}
 catch{return []}
}
function savePlan(p){
 if(!safeSymbol(p.symbol))return;
 const item={symbol:p.symbol,side:p.side,entry:p.entry,stop:p.stop,target:p.target,rr:p.rr,scannedAt:p.scannedAt,
  savedAt:new Date().toISOString(),reasons:Array.isArray(p.reasons)?p.reasons.slice(0,4):[],warning:p.warning||'План може бути застарілим.',state:'plan',ordersEnabled:false};
 const arr=saved().filter(x=>!(x.symbol===item.symbol&&x.side===item.side&&x.scannedAt===item.scannedAt));
 arr.unshift(item);localStorage.setItem(STORAGE_KEY,JSON.stringify(arr.slice(0,100)));if(page==='plans')drawPlans();
}
function drawPlans(){
 const root=$('savedPlans');root.replaceChildren();const plans=saved();
 if(!plans.length){root.append(el('div','quiet-message','Тут будуть збережені плани для розгляду. Збереження не означає розміщення ордера.'));return}
 for(const p of plans){
  const item=el('article','saved-item'),text=el('div'),buttons=el('div','saved-buttons');
  append(text,el('h3','',p.symbol+' · '+p.side.toUpperCase()),el('p','','Вхід '+fprice(p.entry)+' · SL '+fprice(p.stop)+' · TP '+fprice(p.target)+' · збережено '+timestamp(p.savedAt)));
  const del=el('button','ghost-button','Видалити');del.onclick=()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(saved().filter(x=>!(x.symbol===p.symbol&&x.side===p.side&&x.scannedAt===p.scannedAt))));drawPlans()};
  const view=el('button','outline-button','Показати рівні');view.onclick=()=>{const data=el('div','note-box');data.append(el('p','','Вхід '+fprice(p.entry)+' · Stop Loss '+fprice(p.stop)+' · Take Profit '+fprice(p.target)+' · R:R '+(finite(p.rr)??'—')));item.append(data);view.disabled=true};
  append(buttons,view,del);append(item,text,buttons);root.append(item);
 }
}
async function request(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 const data=await response.json();if(!response.ok)throw new Error(data?.error||'Сервер повернув HTTP '+response.status);
 return data;
}
async function updateSnapshot(){
 try{
  const data=await request('/api/opportunities');snapshot=data;
  const state=data.status,completed=Number(data.completed)||0,total=Number(data.total)||0;
  const errors=(Array.isArray(data.errors)?data.errors:[]).length;
  if(state==='scanning')setStatus('Скануємо ліквідні пари Bybit · перевірено '+completed+' з '+total+'. Готових угод до завершення перевірки не показуємо.');
  else if(state==='ready')setStatus('Перевірено '+completed+' інструментів. Готових сценаріїв: '+verified().length+'. Відбір за правилами, не гарантія результату.');
  else if(state==='partial')setStatus('Сканування частково завершене: '+errors+' помилок джерела. Сигнали доступні лише за успішними інструментами.',true);
  else if(state==='error')setStatus('Не вдалося отримати повні дані Bybit. Нові входи не пропонуються.',true);
  else setStatus('Сканер запускається. Дані з’являться після перевірки.');
  setConnection(state==='ready'||state==='scanning'||state==='partial','Bybit Public · '+(state==='error'?'помилка':'доступний'));
  drawOpportunities();
 }catch(e){snapshot=null;setConnection(false,'Локальний сервер недоступний');setStatus('Не вдалося зв’язатися з сервером: '+e.message,true);drawOpportunities()}
}
let busyScan=false;
async function startScan(){
 if(busyScan)return;busyScan=true;$('scan').disabled=true;
 try{await request('/api/scan',{method:'POST',headers:{'x-mi-action':'scan'}});setStatus('Перевірка ринків запущена; нові результати з’являться після сканування.')}
 catch(e){setStatus('Не вдалося запустити сканер: '+e.message,true)}
 finally{$('scan').disabled=false;busyScan=false;await updateSnapshot()}
}
$('scan').onclick=startScan;$('refresh').onclick=updateSnapshot;

// Read-only forward simulation: NEVER imply demo or real orders were opened.
async function loadPaperResults(){
 const root=$('paperStats'),rows=$('paperRows');
 try{
  const report=await request('/api/paper/report'),m=report.metrics||{},t=report.totals||{};
  $('paperStatus').textContent='Очікують входу: '+(t.waiting||0)+' · умовно відкрито: '+(t.open||0)+
   ' · завершено: '+(t.closed||0)+' · неможливо перевірити: '+(t.unverifiable||0);
  root.replaceChildren();
  const format=(v,suffix='')=>Number.isFinite(v)?v.toFixed(2)+suffix:'—';
  for(const [label,value] of [
   ['Завершені угоди',String(m.closed??0)],
   ['Успішні (%)',m.closed?format(m.winRate,'%'):'—'],
   ['Середній результат (R)',m.closed?format(m.expectancyR):'—'],
   ['Profit Factor',m.closed?format(m.profitFactor):'—'],
   ['Макс. просадка (R)',m.closed?format(m.maxDrawdownR):'—']
  ]){
   const card=el('div','paper-stat');
   append(card,el('span','',label),el('strong','',value));root.append(card);
  }
  rows.replaceChildren();
  if(!report.trades?.length){
   const tr=el('tr'),td=el('td','quiet-message','Поки немає зареєстрованих підтверджених сигналів');td.colSpan=6;tr.append(td);rows.append(tr);
  }else for(const trade of report.trades){
   const tr=el('tr');
   for(const val of [trade.symbol,trade.side==='long'?'LONG':'SHORT',
    ({waiting:'Очікуємо наступну свічку',open:'Умовно відкрита',closed:'Завершена',unverifiable:'Недостатньо даних'})[trade.status]||'—',
    Number.isFinite(trade.fillPrice)?fprice(trade.fillPrice):'—',
    Number.isFinite(trade.netR)?format(trade.netR):'—',
    trade.signalAt?new Date(trade.signalAt).toLocaleString('uk-UA'):'—']){
    tr.append(el('td','',String(val)));
   }
   rows.append(tr);
  }
  $('paperDisclosure').textContent=report.warning||'Результати умовні, без реальних ордерів.';
 }catch(error){
  $('paperStatus').textContent='Журнал недоступний: '+String(error.message||error);
  root.replaceChildren();rows.replaceChildren();
 }
}
$('refreshPaper').onclick=loadPaperResults;

async function loadDemoStatus(){
 try{
  const data=await request('/api/demo/status');
  const badge=$('demoBadge');badge.textContent=data.saved?'Ключі збережено':'Не підключено';badge.classList.toggle('connected',data.saved);
  if(data.saved)await loadDemoAccount();else $('demoAccount').replaceChildren(el('p','muted','API-ключі не налаштовано.'));
 }catch(e){$('demoBadge').textContent='Недоступно';$('demoMessage').textContent=e.message}
}
async function loadDemoAccount(){
 const root=$('demoAccount');root.replaceChildren(el('p','muted','Завантажуємо стан Demo-рахунку…'));
 try{
  const data=await request('/api/demo/account');
  root.replaceChildren();
  for(const [label,value] of [['Баланс рахунку (USDT)',data.wallet?.totalWalletBalance],['Капітал',data.wallet?.totalEquity],
    ['Доступно',data.wallet?.totalAvailableBalance],['Активних позицій',data.positions?.length],['Активних ордерів',data.orders?.length]]){
   const row=el('div','metric-row');append(row,el('span','',label),el('b','',value===null||value===undefined?'—':String(value)));root.append(row);
  }
  if(data.warnings?.positions||data.warnings?.orders)root.append(el('p','field-message','Частину інформації рахунку не вдалося завантажити.'));
 }catch(e){root.replaceChildren(el('p','field-message error','Дані недоступні: '+e.message))}
}
$('reloadAccount').onclick=loadDemoAccount;
$('demoForm').onsubmit=async e=>{
 e.preventDefault();
 const key=$('demoKey').value.trim(),secret=$('demoSecret').value.trim();
 const button=$('connectDemo');button.disabled=true;$('demoMessage').textContent='Перевіряємо доступ на сервері Bybit Demo…';
 try{
  const r=await request('/api/demo/connect',{method:'POST',headers:{'content-type':'application/json','x-mi-action':'connect'},
   body:JSON.stringify({key,secret})});
  $('demoForm').reset();$('demoMessage').textContent='✓ З’єднання перевірено. Дані збережено у macOS Keychain. Ордери вимкнено.';
  await loadDemoStatus();
 }catch(err){$('demoMessage').textContent='Помилка підключення: '+err.message;$('demoMessage').classList.add('error')}
 finally{button.disabled=false}
};
$('disconnectDemo').onclick=async()=>{
 if(!confirm('Відключити Demo API та видалити ці ключі з локального Keychain?'))return;
 try{await request('/api/demo/disconnect',{method:'POST',headers:{'x-mi-action':'disconnect'}});$('demoForm').reset();$('demoMessage').textContent='Demo-ключі видалено з локальної конфігурації.';await loadDemoStatus()}
 catch(e){$('demoMessage').textContent='Помилка: '+e.message}
};
updateSnapshot();
setInterval(()=>{if(!document.hidden)updateSnapshot()},15000);
setInterval(()=>{if(page==='settings'&&!document.hidden)loadDemoStatus()},120000);
