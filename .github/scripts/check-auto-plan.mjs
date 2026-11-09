import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const errors=[];
const json=(route,value)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
await context.route('**/api/market/instruments',route=>json(route,{category:'linear',symbols:['BTCUSDT','ETHUSDT']}));
await context.route('**/api/scanner/opportunities',route=>json(route,{
 status:'ready',updatedAt:new Date().toISOString(),total:2,completed:2,attention:[],errors:[],
 opportunities:[{symbol:'ETHUSDT',side:'long',entry:100,stop:95,target:112,rr:2.4,confirmations:4,checks:4,scannedAt:new Date().toISOString()}]
}));
await context.route('**/api/scanner/notifications',route=>json(route,{session:'mock',alerts:[],ordersEnabled:false}));
await context.route('**/api/scanner/notification-settings',route=>json(route,{macNotifications:false,ordersEnabled:false}));
await context.route('**/api/market/candles?*',route=>json(route,{symbol:'ETHUSDT',interval:'60',candles:Array.from({length:80},(_,i)=>({t:Date.now()-(80-i)*3600000,o:100,h:102,l:98,c:100,v:10}))}));
const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8765',{waitUntil:'load'});
await page.waitForFunction(()=>document.querySelector('#entry')?.value==='100',{timeout:15000});
const draft=await page.evaluate(()=>({
 symbol:document.querySelector('#marketSymbolText').textContent,
 entry:document.querySelector('#entry').value,
 stop:document.querySelector('#stop').value,
 target:document.querySelector('#target').value,
 status:document.querySelector('#autoPlanStatus').textContent,
 executionDisabled:document.querySelector('#executeButton').disabled
}));
if(draft.symbol!=='ETHUSDT'||draft.stop!=='95'||draft.target!=='112')errors.push('Auto draft not applied: '+JSON.stringify(draft));
if(!draft.executionDisabled)errors.push('Auto plan enabled live order submission');
await page.locator('#openRiskWindow').click();
await page.locator('#entry').fill('101');
await page.locator('#entry').dispatchEvent('input');
await page.evaluate(()=>document.querySelector('#autoPlanReset').click());
if(await page.locator('#entry').inputValue()!=='101')errors.push('Manual level overwritten by auto-clear');
if(!await page.locator('#autoPlanStatus').innerText().then(v=>v.includes('Ручні')))errors.push('Manual lock not surfaced');
await page.locator('#autoPlanEnabled').uncheck();
if(await page.locator('#entry').inputValue()!=='101')errors.push('Toggling auto mode modified manual plan');
await browser.close();
if(errors.length)throw Error(errors.join(' | '));
console.log('Auto draft + manual-edit protection + disabled order submission: success');
