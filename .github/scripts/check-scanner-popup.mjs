import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1420,height:880}});
const errors=[];
await context.addInitScript(()=>{
 class MockWebSocket{
  static OPEN=1;
  constructor(){this.readyState=0;setTimeout(()=>{this.readyState=1;this.onopen?.()},20)}
  send(){}close(){this.readyState=3;this.onclose?.({code:1000})}
 }
 window.WebSocket=MockWebSocket;
});
const json=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
await context.route('**/api/market/instruments',route=>json(route,{category:'linear',symbols:['BTCUSDT','ETHUSDT']}));
await context.route('**/api/scanner/opportunities',route=>json(route,{
 status:'ready',total:2,completed:2,updatedAt:new Date().toISOString(),errors:[],
 opportunities:[],
 attention:[{
  symbol:'ETHUSDT',side:'long',passed:3,total:5,aligned:true,frames:4,up:3,down:0,mixed:1,
  rsi:51.3,relativeVolume:1.16,atrPct:1.2,hasTradePlan:false,
  checkedAt:new Date().toISOString(),reason:'EMA 1год і 4год узгоджені',
  waitFor:['Підтвердження MACD'],
  timeframes:['15','60','240','D'].map(tf=>({tf,direction:'up',rsi:51.3,macd:.2,relativeVolume:1.16,support:99,resistance:105}))
 }]
}));
await context.route('**/api/scanner/history',route=>json(route,{history:[]}));
await context.route('**/api/scanner/notifications',route=>json(route,{session:'test',macNotifications:false,alerts:[],ordersEnabled:false}));
await context.route('**/api/scanner/notification-settings',route=>json(route,{macNotifications:false,ordersEnabled:false}));
await context.route('**/api/market/candles?*',route=>{
 const now=Date.now();
 json(route,{symbol:'ETHUSDT',interval:'60',candles:Array.from({length:80},(_,i)=>({
  t:now-(80-i)*3600000,o:100,h:102,l:99,c:100+i*.01,v:10
 }))});
});
const page=await context.newPage();
page.on('pageerror',e=>errors.push('main: '+e.message));
await page.goto('http://127.0.0.1:8765',{waitUntil:'load'});
const popupWait=page.waitForEvent('popup');
await page.locator('#marketsNav').click();
const popup=await popupWait;
popup.on('pageerror',e=>errors.push('popup: '+e.message));
await popup.waitForLoadState('load');
await popup.locator('#scannerAttentionTab').click();
await popup.locator('.scanner-attention-row').first().waitFor({timeout:10000});
const row=popup.locator('.scanner-attention-row').first();
await row.getByRole('button',{name:'Детальна аналітика'}).click();
const details=row.locator('.scanner-analysis');
if(!await details.isVisible())errors.push('Expanded analytics not visible');
if(await details.locator('tbody tr').count()!==4)errors.push('Missing four analyzed timeframes');
await row.getByRole('button',{name:'Відкрити графік'}).click();
await page.waitForFunction(()=>document.querySelector('#marketSymbolText')?.textContent==='ETHUSDT',null,{timeout:10000});
if(await page.locator('#marketSymbolText').textContent()!=='ETHUSDT')errors.push('Popup did not navigate parent chart');
if(popup.isClosed())errors.push('Scanner closed unexpectedly');
await popup.screenshot({path:'layout-screenshots/scanner-popup.png'});
await popup.close();
await browser.close();
if(errors.length)throw Error(errors.join(' | '));
console.log('Separate scanner popup, detailed analytics and chart navigation: success');
