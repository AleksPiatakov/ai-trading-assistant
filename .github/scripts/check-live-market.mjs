import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  window.__marketSockets=[];
  window.__marketSubscriptions=[];
  class MockWebSocket{
    static CONNECTING=0; static OPEN=1; static CLOSED=3;
    constructor(url){
      this.url=url;this.readyState=0;
      window.__marketSockets.push(this);
      setTimeout(()=>{this.readyState=1;this.onopen?.()},15);
    }
    send(value){
      const obj=JSON.parse(value);
      if(obj.op==='subscribe'){
        this.args=obj.args;
        window.__marketSubscriptions.push(...obj.args);
      }
    }
    close(){this.readyState=3;this.onclose?.({code:1000})}
    emit(data){this.onmessage?.({data:JSON.stringify(data)})}
  }
  window.WebSocket=MockWebSocket;
});
await page.route('**/api/market/instruments',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({category:'linear',symbols:['BTCUSDT','ETHUSDT']})
}));
const candleBase={BTCUSDT:100,ETHUSDT:50};
await page.route('**/api/market/candles?*',route=>{
  const url=new URL(route.request().url()),symbol=url.searchParams.get('symbol');
  const base=candleBase[symbol];
  if(!base){return route.fulfill({status:400,body:'{}'})}
  const minute=Math.floor(Date.now()/60000)*60000;
  const candles=Array.from({length:80},(_,i)=>({
    t:minute-(79-i)*60000,o:base+i*.01,h:base+i*.01+.25,
    l:base+i*.01-.25,c:base+i*.01+.03,v:1+i*.01
  }));
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    symbol,interval:url.searchParams.get('interval'),candles
  })});
});
await page.goto('http://127.0.0.1:8765',{waitUntil:'load'});
await page.waitForFunction(()=>window.__marketSubscriptions.includes('tickers.BTCUSDT'),{timeout:10000});
await page.evaluate(()=>{
  const ws=window.__marketSockets.at(-1);
  ws.emit({topic:'tickers.BTCUSDT',type:'snapshot',ts:Date.now(),data:{
    symbol:'BTCUSDT',lastPrice:'102.25',price24hPcnt:'0.0125'
  }});
});
await page.waitForFunction(()=>document.querySelector('#quote')?.textContent==='102.25',{timeout:4000});
const status=await page.locator('#quoteMeta').innerText();
if(!status.includes('Потік Bybit'))errors.push('Live WebSocket status missing: '+status);
await page.evaluate(()=>{
  const ws=window.__marketSockets.at(-1),last=Date.now();
  ws.emit({topic:'kline.D.BTCUSDT',type:'snapshot',ts:last,data:[{
    start:Math.floor(last/86400000)*86400000,open:'100',high:'104',
    low:'99',close:'103',volume:'29',confirm:false
  }]});
});
await page.waitForTimeout(250);
await page.locator('#longTfToggle').click();
if(await page.locator('#longTfMenu').evaluate(el=>el.classList.contains('hidden')))errors.push('Long timeframe menu closed');
await page.locator('[data-long-tf="M"]').click();
await page.waitForFunction(()=>window.__marketSubscriptions.includes('kline.M.BTCUSDT'),null,{timeout:10000});
if(await page.locator('#longTfLabel').innerText()!=='1Міс')errors.push('Monthly label mismatch');
await page.locator('#longTfToggle').click();
await page.locator('[data-long-tf="3M"]').click();
if(await page.locator('#longTfLabel').innerText()!=='3Міс')errors.push('Quarterly label mismatch');
await page.locator('#longTfToggle').click();
await page.locator('[data-long-tf="W"]').click();
await page.waitForFunction(()=>window.__marketSubscriptions.includes('kline.W.BTCUSDT'),null,{timeout:10000});
// Drawing toolbar must be actionable, with real canvas annotations and erasing.
const toolButtons=page.locator('[data-chart-tool]');
if(await toolButtons.count()!==10)errors.push('Expected 10 chart drawing buttons');
await page.locator('[data-chart-tool="trend"]').click();
if(await page.locator('[data-chart-tool="trend"]').getAttribute('aria-pressed')!=='true')
 errors.push('Trendline tool did not activate');
const chartBox=await page.locator('#chart').boundingBox();
await page.mouse.move(chartBox.x+chartBox.width*.25,chartBox.y+chartBox.height*.24);
await page.mouse.down();
await page.mouse.move(chartBox.x+chartBox.width*.43,chartBox.y+chartBox.height*.37,{steps:6});
await page.mouse.up();
const drawingCount=await page.evaluate(()=>JSON.parse(localStorage.getItem('ata-drawings-BTCUSDT|W')||'[]').length);
if(drawingCount!==1)errors.push('Trend drawing not saved');
await page.locator('[data-chart-tool="eraser"]').click();
await page.mouse.click(chartBox.x+chartBox.width*.25,chartBox.y+chartBox.height*.24);
const afterErase=await page.evaluate(()=>JSON.parse(localStorage.getItem('ata-drawings-BTCUSDT|W')||'[]').length);
if(afterErase!==0)errors.push('Eraser failed to remove line');
await page.locator('[data-chart-tool="home"]').click();
await page.locator('#settingsNav').click();
if(!await page.locator('#settingsOverlay').isVisible())errors.push('Settings did not open as a modal');
if(await page.locator('#settingsOverlay #demoCredentialsForm').count()!==1)errors.push('Bybit Demo form missing from modal');
await page.locator('#settingsClose').click();
if(await page.locator('#settingsOverlay').isVisible())errors.push('Settings modal could not be closed');
await page.locator('#marketSelectButton').click();
await page.locator('#marketSearch').fill('ETH');
await page.locator('.market-list-entry').filter({hasText:'ETHUSDT'}).click();
await page.waitForFunction(()=>window.__marketSubscriptions.includes('tickers.ETHUSDT'),{timeout:10000});
await page.evaluate(()=>{
  const ws=window.__marketSockets.at(-1);
  ws.emit({topic:'tickers.ETHUSDT',type:'snapshot',ts:Date.now(),data:{
    symbol:'ETHUSDT',lastPrice:'55.75',price24hPcnt:'0.02'
  }});
});
await page.waitForFunction(()=>document.querySelector('#quote')?.textContent==='55.75',{timeout:4000});
const selected=await page.locator('#marketSymbolText').innerText();
if(selected!=='ETHUSDT')errors.push('Symbol switching failed');
if(errors.length)throw Error('Live market smoke test failed: '+errors.join(' | '));
console.log('Live WebSocket ticker/kline and BTC→ETH switching: success');
await browser.close();
