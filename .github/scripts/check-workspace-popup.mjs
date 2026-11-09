import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1400,height:900}});
const errors=[];
await context.addInitScript(()=>{
 class MockWebSocket{
  static OPEN=1;
  constructor(){this.readyState=0;setTimeout(()=>{this.readyState=1;this.onopen?.()},25)}
  send(){}close(){this.readyState=3;this.onclose?.({code:1000})}
 }
 window.WebSocket=MockWebSocket;
});
const json=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
await context.route('**/api/market/instruments',route=>json(route,{category:'linear',symbols:['BTCUSDT','ETHUSDT','SOLUSDT','DOTUSDT','DOGEUSDT','XRPUSDT']}));
await context.route('**/api/scanner/opportunities',route=>json(route,{status:'ready',total:6,completed:6,updatedAt:new Date().toISOString(),opportunities:[],
 attention:['ETHUSDT','SOLUSDT','DOTUSDT','DOGEUSDT','XRPUSDT'].map(symbol=>({
  symbol,side:'long',passed:3,total:5,rsi:48,relativeVolume:.9,hasTradePlan:false,
  reason:'Тренд потребує підтвердження',waitFor:['MACD'],checkedAt:new Date().toISOString()
 })),errors:[]}));
await context.route('**/api/scanner/notifications',route=>json(route,{session:'test',macNotifications:false,alerts:[],ordersEnabled:false}));
await context.route('**/api/scanner/notification-settings',route=>json(route,{macNotifications:false,ordersEnabled:false}));
await context.route('**/api/market/candles?*',route=>json(route,{symbol:'BTCUSDT',interval:'D',candles:Array.from({length:80},(_,i)=>({t:Date.now()-(80-i)*86400000,o:100,h:102,l:98,c:100,v:10}))}));
const page=await context.newPage();
page.on('pageerror',e=>errors.push('main: '+e.message));
await page.goto('http://127.0.0.1:8765',{waitUntil:'load'});
const newWindow=page.waitForEvent('popup');
await page.locator('#openAssistantWindow').click();
const popup=await newWindow;
popup.on('pageerror',e=>errors.push('popup: '+e.message));
await popup.waitForLoadState('load');
await popup.locator('#aiCard').waitFor({state:'visible',timeout:10000});
await popup.waitForFunction(()=>document.querySelectorAll('#watchBrief .watch-pair').length===5,null,{timeout:10000});
if(await popup.locator('#watchBrief .watch-pair').count()!==5)errors.push('Watchlist truncated');
await popup.locator('#watchBrief .watch-pair').filter({hasText:'DOTUSDT'}).click();
await popup.waitForFunction(()=>document.querySelector('#marketSymbolText')?.textContent==='DOTUSDT',null,{timeout:12000});
await page.waitForFunction(()=>document.querySelector('#marketSymbolText')?.textContent==='DOTUSDT',null,{timeout:12000});
if(!await popup.locator('#watchBrief .watch-pair').filter({hasText:'DOTUSDT'}).evaluate(el=>el.classList.contains('selected')))errors.push('Selected pair not highlighted');
if(await popup.locator('#watchBrief .watch-pair').filter({hasText:'DOTUSDT'}).getAttribute('aria-pressed')!=='true')errors.push('Selected pair not accessible');
if(!new URL(popup.url()).searchParams.has('workspace'))errors.push('Popup missing workspace mode');
if(!await page.locator('#rightPanel').evaluate(el=>el.classList.contains('is-closed')))errors.push('Main chart obstructed by floating assistant');
if(await popup.locator('#chartCard').isVisible())errors.push('Chart rendered in helper window');
const rect=await popup.locator('#rightPanel').boundingBox();
if(!rect||rect.width<700||rect.height<500)errors.push('Workspace did not fill detached window: '+JSON.stringify(rect));
await popup.locator('[data-window-section="risk"]').click();
if(!await popup.locator('#riskCard').isVisible())errors.push('Calculator tab not available');
await page.locator('#openOrderWindow').click();
await popup.waitForFunction(()=>document.querySelector('#orderCard')?.getClientRects().length>0);
if(!await popup.locator('#orderCard').isVisible())errors.push('Reopening section failed');
await popup.screenshot({path:'layout-screenshots/assistant-workspace-popup.png'});
const closed=popup.waitForEvent('close',{timeout:5000});
await popup.locator('#closeAssistantWindow').click();
await closed;
await browser.close();
if(errors.length)throw Error(errors.join(' | '));
console.log('Standalone AI workspace, panel switching and main chart separation: success');
