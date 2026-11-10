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
function watchCard(t){
 const card=el('article','watch-card'),head=el('div','watch-head');
 append(head,el('h3','',t.symbol),el('span','watch-tag','◷ Спостерігати'));
 card.append(head,el('div','watch-price',fprice(t.lastPrice)));
 card.append(el('p','',t.reason||'Підтверджених умов входу наразі немає.'));
 const foot=el('div','watch-foot');append(foot,el('span','', '24г зміна '+pct(t.change24h)),el('span','','Не торговий сигнал'));
 card.append(foot);
 return card;
}
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
 if(!isCryptoView())list.append(el('div','quiet-message',marketNotice));
 else if(!watch.length)list.append(el('div','quiet-message','Пари під спостереженням з’являться після завершення сканування.'));
 else for(const t of watch)list.append(watchCard(t));
 $('lastScan').textContent=snapshot?.updatedAt?'Оновлено о '+timestamp(snapshot.updatedAt):'Очікуємо сканування';
 drawScannerMetrics();
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
