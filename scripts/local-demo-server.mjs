/**
 * Local-only settings bridge for Bybit Demo credentials.
 * Run: node scripts/local-demo-server.mjs
 * Open http://127.0.0.1:4177/ (not GitHub Pages).
 *
 * Keys are stored in macOS Keychain, NEVER in HTML, localStorage, Git or logs.
 * This bridge intentionally does not place orders.
 */
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createMarketScanner } from './market-scanner.mjs';
import { verifyStrategy } from './strategy-verification.mjs';
import { createPaperLedger } from './paper-ledger.mjs';

const host = '127.0.0.1';
const port = Number(process.env.ATA_LOCAL_PORT || 4177);
const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const services = Object.freeze({key:'com.ai-trading-assistant.demo.api-key',secret:'com.ai-trading-assistant.demo.api-secret'});
const account = 'local';
const json = (res,status,obj) => {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(obj));
};
// The macOS "security add-generic-password ... -w" command prompts at a TTY.
// Piping a password to that command does NOT satisfy its prompt and leaves it
// hanging. Batch mode (-i) reads a command from stdin without putting secrets
// in the process argument list. Credentials are deliberately restricted to
// the ordinary ASCII token alphabet to avoid command interpolation.
const runSecurity = (args,stdinText) => new Promise((resolve,reject) => {
  if(process.platform!=='darwin')return reject(new Error('Потрібен macOS Keychain'));
  const child=spawn('/usr/bin/security',args,{stdio:['pipe','pipe','pipe']});
  let out='',settled=false;
  const finish=(error,value)=>{
    if(settled)return;
    settled=true;clearTimeout(timer);
    if(error)reject(error);else resolve(value);
  };
  const timer=setTimeout(()=>{
    child.kill('SIGKILL');
    finish(new Error('macOS Keychain не відповідає. Перевірте, чи розблокована зв’язка ключів.'));
  },8000);
  child.stdout.on('data',buf=>{out+=buf.toString();if(out.length>16384)out=out.slice(-16384);});
  // Never store, print or return security stderr: interactive output might
  // contain private values on some operating system versions.
  child.stderr.resume();
  child.on('error',()=>finish(new Error('macOS Keychain недоступний')));
  child.on('close',code=>code===0?finish(null,out.trimEnd()):finish(new Error('Операція Keychain завершилася з помилкою ('+code+')')));
  child.stdin.on('error',()=>{});
  child.stdin.end(stdinText===undefined?'':stdinText);
});
const keychainRead = service => runSecurity(['find-generic-password','-a',account,'-s',service,'-w']);
const keychainSave = async (service,value) => {
  if(!/^[A-Za-z0-9_-]{8,512}$/.test(value))throw new Error('Непідтримувані символи API-ключа. Не вводьте секрет у терміналі.');
  // In security interactive mode the complete add command is read on stdin.
  await runSecurity(['-i'],'add-generic-password -U -a '+account+' -s '+service+' -w '+value+'\n');
  const stored=await keychainRead(service);
  if(stored!==value)throw new Error('Keychain не підтвердив збереження ключа');
};
const keychainDelete = service => runSecurity(['delete-generic-password','-a',account,'-s',service]);
const readJson = async req => {
  let raw='';
  for await(const piece of req){
    raw+=piece.toString();
    if(raw.length>16384)throw new Error('Завеликий запит');
  }
  try{return JSON.parse(raw);}catch{throw new Error('Некоректний JSON');}
};
async function verifyDemoKey(key,secret){
  const now=Date.now().toString(),window='5000';
  const query='accountType=UNIFIED';
  const sign=createHmac('sha256',secret).update(now+key+window+query).digest('hex');
  const response=await fetch('https://api-demo.bybit.com/v5/account/wallet-balance?'+query,{
    headers:{'X-BAPI-API-KEY':key,'X-BAPI-TIMESTAMP':now,'X-BAPI-RECV-WINDOW':window,'X-BAPI-SIGN':sign},
    signal:AbortSignal.timeout(10000),cache:'no-store'
  });
  const result=await response.json();
  if(!response.ok||result?.retCode!==0){
    const err=new Error('Bybit Demo відхилив перевірку: '+String(result?.retMsg||response.status).slice(0,120));
    err.status=422;throw err;
  }
  return true;
}

async function authenticatedGet(path,params,key,secret){
  const query=new URLSearchParams(params).toString();
  const now=Date.now().toString(),window='5000';
  const signature=createHmac('sha256',secret).update(now+key+window+query).digest('hex');
  const response=await fetch('https://api-demo.bybit.com'+path+'?'+query,{
    headers:{'X-BAPI-API-KEY':key,'X-BAPI-TIMESTAMP':now,
      'X-BAPI-RECV-WINDOW':window,'X-BAPI-SIGN':signature},
    cache:'no-store',signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw new Error('Bybit Demo HTTP '+response.status);
  const data=await response.json();
  if(data?.retCode!==0)throw new Error('Bybit Demo: '+String(data?.retMsg||data?.retCode).slice(0,130));
  return data.result||{};
}
const finiteText=value=>value===undefined||value===null||value===''?'':String(value);
async function loadDemoAccount(){
  const [key,secret]=await Promise.all([keychainRead(services.key),keychainRead(services.secret)]);
  if(!key||!secret)throw new Error('Demo API ключ не збережено');
  const wallet=await authenticatedGet('/v5/account/wallet-balance',{accountType:'UNIFIED'},key,secret);
  const item=wallet.list?.find(x=>x.accountType==='UNIFIED');
  if(!item)throw new Error('Bybit не повернув Unified wallet');
  const results=await Promise.allSettled([
    authenticatedGet('/v5/position/list',{category:'linear',settleCoin:'USDT'},key,secret),
    authenticatedGet('/v5/order/realtime',{category:'linear',settleCoin:'USDT',openOnly:'0'},key,secret)
  ]);
  const positions=results[0].status==='fulfilled'?(results[0].value.list||[])
    .filter(p=>Number(p.size)>0).map(p=>({
      symbol:finiteText(p.symbol),side:finiteText(p.side),size:finiteText(p.size),
      avgPrice:finiteText(p.avgPrice),stopLoss:finiteText(p.stopLoss),
      takeProfit:finiteText(p.takeProfit),unrealisedPnl:finiteText(p.unrealisedPnl),
      positionValue:finiteText(p.positionValue),markPrice:finiteText(p.markPrice)
    })) : null;
  const orders=results[1].status==='fulfilled'?(results[1].value.list||[]).map(o=>({
    symbol:finiteText(o.symbol),side:finiteText(o.side),orderType:finiteText(o.orderType),
    price:finiteText(o.price),qty:finiteText(o.qty),leavesQty:finiteText(o.leavesQty),
    orderStatus:finiteText(o.orderStatus),createdTime:finiteText(o.createdTime)
  })) : null;
  return {
    mode:'demo',source:'Bybit Demo API',updatedAt:new Date().toISOString(),
    wallet:{totalEquity:finiteText(item.totalEquity),totalWalletBalance:finiteText(item.totalWalletBalance),
      totalAvailableBalance:finiteText(item.totalAvailableBalance),
      totalPerpUPL:finiteText(item.totalPerpUPL),
      usdtWallet:finiteText(item.coin?.find(c=>c.coin==='USDT')?.walletBalance)},
    positions,orders,
    warnings:{
      positions:results[0].status==='rejected'?'Не вдалося отримати позиції':null,
      orders:results[1].status==='rejected'?'Не вдалося отримати ордери':null
    },
    ordersEnabled:false
  };
}

const intervals=new Set(['1','3','5','15','30','60','120','240','D','W','M','3M']);
let instrumentsCache=null,instrumentsFetched=0;
async function publicBybit(path,params){
 const u=new URL('https://api.bybit.com'+path);
 for(const [key,value] of Object.entries(params))u.searchParams.set(key,String(value));
 const response=await fetch(u,{
   headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000),cache:'no-store'
 });
 if(!response.ok)throw new Error('Bybit market HTTP '+response.status);
 const body=await response.json();
 if(body?.retCode!==0)throw new Error('Bybit market: '+String(body?.retMsg||body?.retCode).slice(0,130));
 return body.result||{};
}
async function getInstruments(){
 if(instrumentsCache&&Date.now()-instrumentsFetched<300000)return instrumentsCache;
 const symbols=[],seen=new Set();let cursor='';
 for(let page=0;page<15;page++){
   const params={category:'linear',status:'Trading',limit:'1000'};
   if(cursor)params.cursor=cursor;
   const result=await publicBybit('/v5/market/instruments-info',params);
   for(const item of result.list||[]){
     const symbol=String(item.symbol||'');
     if(item.quoteCoin!=='USDT'||item.settleCoin!=='USDT'||item.contractType!=='LinearPerpetual'
        ||item.status!=='Trading'||!(/^[A-Z0-9]{3,30}USDT$/).test(symbol)||seen.has(symbol))continue;
     seen.add(symbol);symbols.push(symbol);
   }
   if(!result.nextPageCursor)break;
   if(result.nextPageCursor===cursor)throw new Error('Bybit pagination cursor stalled');
   cursor=result.nextPageCursor;
 }
 if(!symbols.length)throw new Error('Bybit не повернув торгові пари USDT Perpetual');
 symbols.sort((a,b)=>a.localeCompare(b,'en'));
 instrumentsCache=symbols;instrumentsFetched=Date.now();
 return symbols;
}
// Exchange publishes monthly candles. Group them by UTC calendar quarter for 3M;
 // don't invent prices: O=first month, H=max, L=min, C=last month, V=sum.
function aggregateQuarterly(months){
 const quarters=[];
 for(const month of months){
   const date=new Date(month.t),monthNum=date.getUTCMonth();
   const start=Date.UTC(date.getUTCFullYear(),Math.floor(monthNum/3)*3,1);
   const prev=quarters.at(-1);
   if(!prev||prev.t!==start)quarters.push({...month,t:start});
   else{
     prev.h=Math.max(prev.h,month.h);
     prev.l=Math.min(prev.l,month.l);
     prev.c=month.c;
     prev.v+=month.v;
   }
 }
 return quarters;
}
async function getKlines(symbol,interval){
 if(!intervals.has(interval)||!(/^[A-Z0-9]{3,30}USDT$/).test(symbol))
   throw new Error('Некоректна пара або таймфрейм');
 const available=await getInstruments();
 if(!available.includes(symbol))throw new Error('Пара відсутня у списку активних USDT Perpetual');
 const result=await publicBybit('/v5/market/kline',{category:'linear',symbol,interval:interval==='3M'?'M':interval,limit:220});
 const candles=(result.list||[]).map(row=>({
   t:Number(row[0]),o:Number(row[1]),h:Number(row[2]),l:Number(row[3]),
   c:Number(row[4]),v:Number(row[5])
 })).filter(c=>[c.t,c.o,c.h,c.l,c.c,c.v].every(Number.isFinite)&&c.t>0&&c.l<=c.h)
   .reverse();
 if(!candles.length)throw new Error('Bybit не повернув свічки для обраної пари');
 const aggregated=interval==='3M'?aggregateQuarterly(candles):candles;
 return {symbol,interval,source:'Bybit public market API',updatedAt:new Date().toISOString(),candles:aggregated};
}
const scannerDataDir=join(homedir(),'Library','Application Support','AI Trading Assistant');
const MAX_HISTORY={'15':2800,'60':660,'240':360,D:255};
async function loadStrategyHistory(symbol){
 const available=await getInstruments();
 if(!available.includes(symbol))throw Error('Пара відсутня у списку Bybit');
 const output={};
 for(const [tf,count] of Object.entries(MAX_HISTORY)){
  let end=Date.now(),rows=[],seen=new Set();
  for(let page=0;page<Math.ceil(count/1000);page++){
   const data=await publicBybit('/v5/market/kline',{
    category:'linear',symbol,interval:tf,end,limit:Math.min(1000,count-rows.length)
   });
   const fetched=(data.list||[]).map(row=>({
    t:Number(row[0]),o:Number(row[1]),h:Number(row[2]),l:Number(row[3]),c:Number(row[4]),v:Number(row[5])
   })).filter(c=>[c.t,c.o,c.h,c.l,c.c,c.v].every(Number.isFinite)&&c.t>0&&c.o>0&&c.l<=c.h);
   if(!fetched.length)break;
   for(const c of fetched)if(!seen.has(c.t)){seen.add(c.t);rows.push(c)}
   const oldest=Math.min(...fetched.map(c=>c.t));
   if(oldest>=end||rows.length>=count)break;
   end=oldest-1;
  }
  output[tf]=rows.sort((a,b)=>a.t-b.t).slice(-count);
 }
 return output;
}
let backtestBusy=false,backtestCache=new Map();
async function runStrategyBacktest(symbol){
 const saved=backtestCache.get(symbol);
 if(saved&&Date.now()-saved.at<10*60*1000)return saved.result;
 if(backtestBusy)throw Object.assign(new Error('Історична перевірка вже виконується'),{status:429});
 backtestBusy=true;
 try{
  const series=await loadStrategyHistory(symbol);
  const result=verifyStrategy({symbol,series});
  backtestCache.set(symbol,{at:Date.now(),result});
  return result;
 }finally{backtestBusy=false}
}
const alertPreferencesPath=join(scannerDataDir,'notification-preferences.json');
const scannerSession=String(Date.now());
let alertPreferences={macNotifications:false};
async function loadAlertPreferences(){
 try{
  const data=JSON.parse(await readFile(alertPreferencesPath,'utf8'));
  alertPreferences={macNotifications:data.macNotifications===true};
 }catch{alertPreferences={macNotifications:false}}
}
async function saveAlertPreferences(){
 await mkdir(scannerDataDir,{recursive:true,mode:0o700});
 await writeFile(alertPreferencesPath,JSON.stringify(alertPreferences),{mode:0o600});
}
function notifyMacOfOpportunity(alert){
 if(!alertPreferences.macNotifications||process.platform!=='darwin')return;
 // Arguments are constant syntax plus strictly sanitized market symbol and side.
 // AppleScript displays a notification only; never invokes a trade or network action.
 const symbol=/^[A-Z0-9]{3,30}USDT$/.test(alert.symbol)?alert.symbol:'Пара';
 const side=alert.side==='short'?'SHORT':'LONG';
 const title='AI Trading Assistant';
 const body=symbol+' · '+side+' — з’явився торговий план. Перевірте графік.';
 const script='display notification '+JSON.stringify(body)+' with title '+JSON.stringify(title);
 const child=spawn('/usr/bin/osascript',['-e',script],{stdio:'ignore'});
 const kill=setTimeout(()=>child.kill('SIGKILL'),5000);
 kill.unref?.();
 child.on('error',()=>clearTimeout(kill));
 child.on('close',()=>clearTimeout(kill));
}
const paperLedger=createPaperLedger({
 path:join(scannerDataDir,'paper-ledger.json'),loadCandles:getKlines
});
const opportunityScanner=createMarketScanner({getKlines,getInstruments,
 historyPath:join(scannerDataDir,'scanner-history.json'),
 onPromotion:notifyMacOfOpportunity,
 onCycle:cycle=>paperLedger.refresh(cycle)});

const server=http.createServer(async(req,res)=>{
  const hostHeader=String(req.headers.host||'');
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(hostHeader)){
    res.writeHead(403);res.end();return;
  }
  const origin=req.headers.origin;
  if(origin && !['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin)){
    res.writeHead(403);res.end();return;
  }
  const path=new URL(req.url||'/', 'http://127.0.0.1:'+port).pathname;
  if(req.method==='OPTIONS'){res.writeHead(405);res.end();return;}
  if(req.method==='GET'&&(path==='/'||path==='/dashboard.html')){
    const html=await readFile(resolve(base,'public/dashboard.html'));
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://stream.bybit.com; form-action 'self'; frame-ancestors 'none'"});
    res.end(html);return;
  }
  if(req.method==='GET'&&path==='/api/demo/status'){
    const configured=await keychainRead(services.key).then(Boolean).catch(()=>false);
    return json(res,200,{configured,mode:'demo',ordersEnabled:false});
  }
  if(req.method==='GET'&&path==='/api/market/instruments'){
    try{return json(res,200,{category:'linear',symbols:await getInstruments()});}
    catch(e){return json(res,503,{error:String(e.message||'Bybit market API недоступний')});}
  }
  if(req.method==='GET'&&path==='/api/market/candles'){
    try{
      const query=new URL(req.url,'http://127.0.0.1:'+port).searchParams;
      return json(res,200,await getKlines(query.get('symbol')||'BTCUSDT',query.get('interval')||'D'));
    }catch(e){return json(res,503,{error:String(e.message||'Bybit market API недоступний'),candles:[]});}
  }
  if(req.method==='GET'&&path==='/api/scanner/notifications'){
    return json(res,200,{session:scannerSession,alerts:opportunityScanner.getAlerts(),macNotifications:alertPreferences.macNotifications,ordersEnabled:false});
  }
  if(req.method==='POST'&&path==='/api/scanner/notification-settings'){
    if(req.headers['x-ata-local']!=='1'||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))
      return json(res,403,{error:'Лише локальний інтерфейс може налаштовувати сповіщення'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))
      return json(res,415,{error:'Очікується JSON'});
    try{
      const data=await readJson(req);
      if(typeof data.macNotifications!=='boolean')return json(res,400,{error:'Потрібен параметр macNotifications'});
      if(data.macNotifications&&process.platform!=='darwin')
        return json(res,422,{error:'Системні сповіщення підтримуються лише на macOS'});
      alertPreferences={macNotifications:data.macNotifications};
      await saveAlertPreferences();
      return json(res,200,{macNotifications:alertPreferences.macNotifications,ordersEnabled:false});
    }catch{return json(res,500,{error:'Налаштування сповіщень не вдалося зберегти'})}
  }
  if(req.method==='GET'&&path==='/api/scanner/history'){
    return json(res,200,{history:opportunityScanner.getHistory(),ordersEnabled:false});
  }
  if(req.method==='GET'&&path==='/api/scanner/opportunities'){
    return json(res,200,opportunityScanner.getSnapshot());
  }
  if(req.method==='GET'&&path==='/api/strategy/paper'){
    try{return json(res,200,await paperLedger.report())}
    catch(e){return json(res,503,{error:String(e.message||e),ordersEnabled:false})}
  }
  if(req.method==='GET'&&path==='/api/strategy/backtest'){
    const query=new URL(req.url,'http://127.0.0.1:'+port).searchParams;
    const symbol=query.get('symbol')||'BTCUSDT';
    if(!/^[A-Z0-9]{3,30}USDT$/.test(symbol))return json(res,400,{error:'Некоректна пара'});
    try{return json(res,200,await runStrategyBacktest(symbol))}
    catch(e){return json(res,e.status||503,{error:String(e.message||e),ordersEnabled:false})}
  }
  if(req.method==='GET'&&path==='/api/demo/account'){
    try{
      const account=await loadDemoAccount();
      return json(res,200,account);
    }catch(e){return json(res,503,{error:String(e.message||'Bybit Demo недоступний').slice(0,160),mode:'demo'});}
  }
  if(path==='/api/demo/credentials' && (req.method==='POST'||req.method==='DELETE')){
    if(req.headers['x-ata-local']!=='1'||req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin'){
      return json(res,403,{error:'Лише локальний інтерфейс може керувати ключем'});
    }
    if(req.method==='DELETE'){
      await Promise.allSettled([keychainDelete(services.key),keychainDelete(services.secret)]);
      return json(res,200,{configured:false});
    }
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'Очікується JSON'});
    try{
      const data=await readJson(req);
      const key=String(data.key||'').trim(),secret=String(data.secret||'').trim();
      if(!/^[A-Za-z0-9_-]{8,256}$/.test(key)||secret.length<8||secret.length>512) return json(res,400,{error:'Перевірте API Key та Secret'});
      await verifyDemoKey(key,secret);
      await keychainSave(services.key,key);
      await keychainSave(services.secret,secret);
      return json(res,200,{configured:true,verified:true,ordersEnabled:false});
    }catch(e){return json(res,e.status||422,{error:String(e.message||'Помилка підключення')});}
  }
  return json(res,404,{error:'Not found'});
});
server.listen(port,host,()=>{
  console.log('AI Trading Assistant Demo settings: http://127.0.0.1:'+port+'/');
  loadAlertPreferences().finally(()=>opportunityScanner.start());
});
process.on('SIGINT',()=>{opportunityScanner.stop();server.close(()=>process.exit(0))});
process.on('SIGTERM',()=>{opportunityScanner.stop();server.close(()=>process.exit(0))});