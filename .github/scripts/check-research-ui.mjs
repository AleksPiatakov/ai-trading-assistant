import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1320,height:900}});
const errors=[];
const json=(r,data)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
await context.addInitScript(()=>{
 class WS{static OPEN=1;constructor(){this.readyState=0;setTimeout(()=>{this.readyState=1;this.onopen?.()},15)}
  send(){}close(){this.readyState=3;this.onclose?.({code:1000})}}
 window.WebSocket=WS;
});
await context.route('**/api/market/instruments',r=>json(r,{symbols:['BTCUSDT','ETHUSDT']}));
await context.route('**/api/market/candles?*',r=>json(r,{candles:[]}));
await context.route('**/api/scanner/opportunities',r=>json(r,{status:'ready',opportunities:[],attention:[],total:0,completed:0,errors:[],updatedAt:new Date().toISOString()}));
await context.route('**/api/strategy/paper',r=>json(r,{ordersEnabled:false,totals:{waiting:2,open:0,closed:0,rejected:0},
 metrics:{closed:0,winRate:null,profitFactor:null,maxDrawdownR:null,expectancyR:null,totalNetR:0},
 trades:[],warning:'Paper records only'}));
await context.route('**/api/strategy/backtest?*',r=>json(r,{ordersEnabled:false,symbol:'BTCUSDT',
 period:{from:'2026-10-10T00:00:00Z',to:'2026-11-01T00:00:00Z'},metrics:{closed:2,winRate:50,profitFactor:1.5,maxDrawdownR:1,expectancyR:.25,totalNetR:.5},
 costs:{feePerSide:.00055,slippagePerSide:.0005},trades:[{symbol:'BTCUSDT',signalAt:'2026-10-14T00:00:00Z',side:'long',reason:'stop',netR:-1.1}],
 warning:'Small sample'}));
await context.route('**/api/strategy/multi-year',r=>json(r,{status:'running',years:3,
 total:10,completed:0,progress:8,symbol:'BTCUSDT',stage:'Свічки 15',
 train:{closed:0,expectancyR:null},test:{closed:0,expectancyR:null},
 pairProgress:[
  {symbol:'BTCUSDT',status:'running',stage:'Завантаження 15',progress:82,timeframes:{'15':{loaded:85000,expected:105000},'60':{loaded:0,expected:26000}}},
  {symbol:'ETHUSDT',status:'queued',stage:'У черзі',progress:0,timeframes:{}}
 ],results:[],errors:[]}));
const page=await context.newPage();
page.on('pageerror',e=>errors.push('main: '+e.message));
await page.goto('http://127.0.0.1:8765',{waitUntil:'load'});
const event=page.waitForEvent('popup');
await page.locator('#openStrategyResearch').click();
const popup=await event;
popup.on('pageerror',e=>errors.push('research: '+e.message));
await popup.waitForLoadState('load');
await popup.locator('#paperMetrics .research-metric').first().waitFor({timeout:12000});
await popup.locator('#researchTabAll').click();
await popup.locator('#researchPairsProgress .research-pair-item').first().waitFor({timeout:12000});
if(await popup.locator('#researchOverviewPanel').isVisible())errors.push('Overview still visible in all-markets tab');
if(!await popup.locator('#researchAllMarketsSection').isVisible())errors.push('All-markets tab hidden');
if(await popup.locator('#researchPairsProgress .research-pair-item').count()!==2)errors.push('Per-symbol status cards absent');
if(!await popup.locator('#researchPairsProgress').innerText().then(t=>t.includes('85 000')||t.includes('85 000')))errors.push('Downloaded candles not shown');
if(await popup.locator('#researchAllProgress').getAttribute('aria-valuenow')!=='8')errors.push('Weighted progress not rendered');
await popup.locator('#researchTabOverview').click();
if(!await popup.locator('#researchOverviewPanel').isVisible())errors.push('Overview not restored');
if(await popup.locator('#researchAllMarketsSection').isVisible())errors.push('All-markets panel overlays overview');
const pf=await popup.locator('#paperMetrics .research-metric').nth(2).innerText();
if(!pf.includes('—'))errors.push('Empty paper performance shown as nonempty: '+pf);
if(!await popup.locator('#paperStatus').innerText().then(x=>x.includes('Очікують')))errors.push('Waiting paper records not shown');
await popup.locator('#researchRunBacktest').click();
await popup.waitForFunction(()=>document.querySelector('#backtestMetrics .research-metric')?.textContent?.includes('2'),null,{timeout:12000});
const win=await popup.locator('#backtestMetrics .research-metric').nth(1).innerText();
if(!win.includes('50.0%'))errors.push('Backtest win rate missing: '+win);
if(await popup.locator('#chartCard').isVisible())errors.push('Chart incorrectly displayed in research window');
if(!await page.locator('#chartCard').isVisible())errors.push('Main chart disappeared');
if(await popup.locator('#executeButton').isVisible())errors.push('Order form shown in research-only window');
await popup.screenshot({path:'layout-screenshots/strategy-verification-popup.png'});
await popup.close();await browser.close();
if(errors.length)throw Error(errors.join(' | '));
console.log('Research popup, no fabricated performance metrics and backtest UI: success');
