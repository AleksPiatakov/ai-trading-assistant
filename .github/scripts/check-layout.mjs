import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('layout-screenshots',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let failed=false;
for(const [w,h] of [[1525,900],[1525,740],[1280,740],[980,800]]){
 const page=await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765',{waitUntil:'load'});
 await page.waitForTimeout(1000);
 const boxes=await page.evaluate(()=>{
  const selectors=['#chartCard','#aiCard','#riskCard','#orderCard','#positions','#executeButton'];
  return Object.fromEntries(selectors.map(s=>{const el=document.querySelector(s);const r=el.getBoundingClientRect();return [s,{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}]}));
 });
 const navIds=['homeNav','marketsNav','analysisNav','journalNav','riskNav','learnNav','settingsNav'];
 for(const selectedId of navIds){
  await page.locator('#'+selectedId).click();
  const selected=await page.evaluate(()=>Array.from(document.querySelectorAll('.nav-reference .nav-action.active')).map(e=>e.id));
  const current=await page.locator('#'+selectedId).getAttribute('aria-current');
  if(selected.length!==1||selected[0]!==selectedId||current!=='page'){
   errors.push('Sidebar selected state incorrect for '+selectedId+': '+selected.join(','));
  }
 }
 await page.locator('#sidebarToggle').click();
 if(!await page.locator('#app').evaluate(el=>el.classList.contains('expanded')))errors.push('Sidebar did not expand');
 if(!await page.locator('#settingsNav').evaluate(el=>el.classList.contains('active')))errors.push('Collapse selection changed active destination');
 await page.locator('#sidebarToggle').click();
 await page.locator('#homeNav').click();
 await page.screenshot({path:`layout-screenshots/${w}x${h}.png`,fullPage:true});
 const p=boxes['#positions'],o=boxes['#orderCard'],e=boxes['#executeButton'];
 const threshold=2;
 const issues=[];
 if(w>1050 && o.bottom>p.top+threshold)issues.push('Order card overlaps positions table');
 if(e.bottom>o.bottom+threshold)issues.push('Order button falls outside order card');
 if(boxes['#riskCard'].bottom>o.top+threshold)issues.push('Risk card overlaps order card');
 if(boxes['#aiCard'].bottom>boxes['#riskCard'].top+threshold)issues.push('AI card overlaps risk card');
 if(errors.length)issues.push('Browser errors: '+errors.join('; '));
 console.log(JSON.stringify({viewport:`${w}x${h}`,positionsTop:p.top,orderBottom:o.bottom,buttonBottom:e.bottom,issues}));
 if(issues.length)failed=true;
 await page.close();
}
await browser.close();
if(failed)process.exit(1);
