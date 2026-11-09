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
await page.waitForFunction(()=>document.querySelectorAll('#skillMatrix .skill-tf').length===12,null,{timeout:20000});
const opportunity=await page.locator('#tradeOpportunity').innerText();
if(!opportunity.includes('Найближча торгова можливість'))errors.push('Trade plan opportunity not rendered');
const opportunityStatus=await page.locator('#opportunityState').innerText();
const planEnabled=await page.locator('#applyOpportunity').isEnabled();
if(opportunityStatus==='Утриматися'&&planEnabled)errors.push('Unsafe plan button enabled while assistant advises waiting');
if(await page.locator('#executeButton').isEnabled())errors.push('Live trade execution became enabled');
const intervals=await page.locator('#skillMatrix .skill-tf').count();
if(intervals!==12)errors.push('Multi-timeframe analysis did not cover all 12 intervals');
if(await page.locator('#multiDetails').isVisible())errors.push('Detailed multi-timeframe section expanded by default');
await page.locator('#toggleMultiDetails').click();
if(!await page.locator('#multiDetails').isVisible())errors.push('Detailed multi-timeframe section did not expand');
if(await page.locator('#toggleMultiDetails').getAttribute('aria-expanded')!=='true')errors.push('Expanded state not announced');
await page.locator('#toggleMultiDetails').click();
if(await page.locator('#multiDetails').isVisible())errors.push('Detailed multi-timeframe section did not collapse');
const firstSummary=await page.locator('#multiSummary').innerText();
if(!firstSummary.includes('12/12'))errors.push('Multi-timeframe coverage summary missing');
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
// The market and timeframe are user preferences and must survive a full page reload.
await page.reload({waitUntil:'load'});
await page.waitForFunction(()=>document.querySelector('#marketSymbolText')?.textContent==='ETHUSDT',null,{timeout:10000});
if(await page.locator('#marketSymbolText').innerText()!=='ETHUSDT')errors.push('Saved symbol did not survive reload');
if(await page.locator('#longTfLabel').innerText()!=='1Тиж')errors.push('Saved weekly timeframe did not survive reload');
if(!await page.locator('#longTfToggle').evaluate(el=>el.classList.contains('active')))errors.push('Saved timeframe button is not active after reload');
const persisted=await page.evaluate(()=>({symbol:localStorage.getItem('ata-market-symbol'),tf:localStorage.getItem('ata-market-timeframe')}));
if(persisted.symbol!=='ETHUSDT'||persisted.tf!=='W')errors.push('Local preference storage does not match selections');
if(errors.length)throw Error('Live market smoke test failed: '+errors.join(' | '));
console.log('Live WebSocket ticker/kline and BTC→ETH switching: success');
await browser.close();
