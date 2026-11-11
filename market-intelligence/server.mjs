/**
 * Market Intelligence — independent localhost-only research UI and read-only Bybit Demo bridge.
 * Start: node market-intelligence/server.mjs
 * No order placement endpoints. Credentials remain exclusively in macOS Keychain.
 */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {assessTradeReadiness,compareWatchCandidates} from '../scripts/market-scanner.mjs';
import {createForwardPaperJournal} from './forward-paper.mjs';

const host='127.0.0.1';
const port=Number(process.env.MI_PORT||4188);
const root=resolve(dirname(fileURLToPath(import.meta.url)));
const services=Object.freeze({key:'com.market-intelligence.demo.api-key',secret:'com.market-intelligence.demo.api-secret'});
const account='local';
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'"});res.end(JSON.stringify(data))};
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


const barMs={'15':900000,'60':3600000,'240':14400000,D:86400000};
const timeframes=['15','60','240','D'];
const maxUniverse=16;
const scanEveryMs=10*60000;
let lastSnapshot={status:'starting',updatedAt:null,universe:[],opportunities:[],watch:[],errors:[],completed:0,total:0,ordersEnabled:false};
let refreshing=false;
let nextScanAt=0;
let tickersCache={at:0,data:[]};
let scannerInterval=null;
let scanFailures=0;
const paperJournal=createForwardPaperJournal({path:join(homedir(),'Library','Application Support','Market Intelligence','forward-paper.json')});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function publicCall(endpoint,params={}){
 const url=new URL('https://api.bybit.com'+endpoint);
 for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
 const response=await fetch(url,{signal:AbortSignal.timeout(14000),cache:'no-store'});
 if(response.status===429)throw Error('Bybit rate limit (HTTP 429)');
  if(!response.ok)throw Error('Bybit HTTP '+response.status);
 const payload=await response.json();
 if(payload.retCode!==0)throw Error('Bybit: '+String(payload.retMsg||payload.retCode).slice(0,110));
 return payload.result||{};
}
async function liquidUniverse(){
 if(Date.now()-tickersCache.at<5*60000&&tickersCache.data.length)return tickersCache.data;
 const result=await publicCall('/v5/market/tickers',{category:'linear'});
 const list=(result.list||[]).filter(t=>/^[A-Z0-9]{3,30}USDT$/.test(String(t.symbol||''))&&
  Number(t.turnover24h)>0&&Number(t.lastPrice)>0&&Number.isFinite(Number(t.turnover24h)));
 list.sort((a,b)=>Number(b.turnover24h)-Number(a.turnover24h));
 const resultList=list.slice(0,maxUniverse).map(t=>({symbol:t.symbol,last:Number(t.lastPrice),
  turnover24h:Number(t.turnover24h),change24h:Number(t.price24hPcnt)*100,
  volume24h:Number(t.volume24h)}));
 tickersCache={at:Date.now(),data:resultList};
 return resultList;
}
async function candles(symbol,interval){
 const data=await publicCall('/v5/market/kline',{category:'linear',symbol,interval,limit:230});
 return (data.list||[]).map(v=>({t:Number(v[0]),o:Number(v[1]),h:Number(v[2]),l:Number(v[3]),
  c:Number(v[4]),v:Number(v[5])})).filter(c=>[c.t,c.o,c.h,c.l,c.c,c.v].every(Number.isFinite)&&c.t>0)
  .filter(c=>c.t+barMs[interval]<=Date.now()).sort((a,b)=>a.t-b.t).slice(-220);
}
async function scan(){
 if(refreshing)return;refreshing=true;nextScanAt=Date.now()+scanEveryMs;
 const startedAt=new Date().toISOString(),plans=[],watch=[],errors=[],candlesBySymbol={};
 try{
  const universe=await liquidUniverse();
  lastSnapshot={...lastSnapshot,status:'scanning',startedAt,universe,completed:0,total:universe.length,errors:[]};
  for(const ticker of universe){
   try{
    const frames={};
    for(const tf of timeframes){frames[tf]=await candles(ticker.symbol,tf);await wait(110)}
    candlesBySymbol[ticker.symbol]=frames['60'];
    const evaluatedAt=Date.now();
    const assessment=assessTradeReadiness(ticker.symbol,frames,evaluatedAt,{turnover24h:ticker.turnover24h,lastPrice:ticker.last});
    const plan=assessment.plan;
    if(plan){
     plans.push({...plan,market:'crypto',source:'Bybit public',turnover24h:ticker.turnover24h,
      updatedPrice:ticker.last,change24h:ticker.change24h,
      state:'plan',quality:'rules-qualified',confidence:null,ordersEnabled:false});
    }else{
     const candidate=assessment.attention;
     const waiting=assessment.blocking;
     watch.push({symbol:ticker.symbol,market:'crypto',instrumentType:'Bybit USDT perpetual derivative',
      source:'Bybit public',state:assessment.status,lastPrice:ticker.last,change24h:ticker.change24h,
      turnover24h:ticker.turnover24h,side:assessment.side,
      passed:Number.isFinite(candidate?.passed)?candidate.passed:null,
      total:candidate?.total||5,timeframes:candidate?.timeframes||[],
      readinessPassed:assessment.checksPassed,readinessTotal:assessment.checksTotal,
      estimatedRR:assessment.estimatedRR,netRR:assessment.netRR,
      marketQuality:assessment.marketQuality,tradeFeasibility:assessment.tradeFeasibility,
      scenario:assessment.scenario,checkedAt:new Date(evaluatedAt).toISOString(),
      waitFor:waiting,reason:waiting[0]?'Очікуємо: '+waiting[0]:
       'Готовий план ще не сформовано; перевірте ринкові умови.',
      ordersEnabled:false});
    }
   }catch(e){errors.push(ticker.symbol+': '+String(e.message||e).slice(0,100))}
   lastSnapshot={...lastSnapshot,completed:lastSnapshot.completed+1};
  }
  plans.sort((a,b)=>b.confirmations-a.confirmations||b.rr-a.rr||b.turnover24h-a.turnover24h);
  // "near" = only one missing required condition WITH valid risk geometry.
  // This is neither a probability nor a recommendation to enter early.
  watch.sort(compareWatchCandidates);
  try{await paperJournal.observe({plans,candlesBySymbol})}
  catch(e){errors.push('Paper journal: '+String(e.message||e).slice(0,100))}
  lastSnapshot={status:errors.length===universe.length?'error':errors.length?'partial':'ready',
   updatedAt:new Date().toISOString(),startedAt,universe,opportunities:plans,watch,errors,
   completed:universe.length,total:universe.length,ordersEnabled:false,nextScanAt:new Date(nextScanAt).toISOString()};
 }catch(e){
  lastSnapshot={...lastSnapshot,status:'error',errors:[String(e.message||e).slice(0,160)],updatedAt:new Date().toISOString()};
 }finally{refreshing=false}
}
const sameOrigin=req=>{
 const origin=req.headers.origin;
 const expected='http://'+host+':'+port;
 return (!origin||origin===expected)&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']));
};
const allowedHost=req=>{
 const value=String(req.headers.host||'');
 return value===host+':'+port||value==='localhost:'+port;
};
const respondFile=async(res,path,kind)=>{
 const body=await readFile(resolve(root,path));
 res.writeHead(200,{'Content-Type':kind,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
 res.end(body);
};
const server=http.createServer(async(req,res)=>{
 try{
  if(!allowedHost(req))return json(res,403,{error:'Локальна адреса потрібна'});
  const u=new URL(req.url,'http://'+host+':'+port);
  if(!sameOrigin(req))return json(res,403,{error:'Зовнішній запит відхилено'});
  if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/index.html'))return await respondFile(res,'index.html','text/html; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/app.css')return await respondFile(res,'app.css','text/css; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/app.js')return await respondFile(res,'app.js','text/javascript; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/api/status')return json(res,200,{
   name:'Market Intelligence',mode:'local-read-only',ordersEnabled:false,
   markets:[{id:'crypto',status:'connected',source:'Bybit public data'},
    {id:'stocks',status:'not-connected'},{id:'forex',status:'not-connected'},
    {id:'commodities',status:'not-connected'}],scanner:lastSnapshot.status});
  if(req.method==='GET'&&u.pathname==='/api/market/candles'){
   const symbol=u.searchParams.get('symbol')||'';
   const allowed=lastSnapshot.universe.some(x=>x.symbol===symbol);
   if(!/^[A-Z0-9]{3,30}USDT$/.test(symbol)||!allowed)return json(res,400,{error:'Інструмент відсутній в поточному сканері'});
   try{
    const result=await candles(symbol,'60');
    return json(res,200,{symbol,market:'crypto',source:'Bybit public',
     interval:'60',ordersEnabled:false,candles:result.slice(-110)});
   }catch(e){return json(res,503,{error:'Графік тимчасово недоступний: '+String(e.message||e).slice(0,120)})}
  }
  if(req.method==='GET'&&u.pathname==='/api/paper/report'){
   return json(res,200,await paperJournal.report());
  }
  if(req.method==='GET'&&u.pathname==='/api/opportunities'){
   const snapshot={...lastSnapshot,
    opportunities:lastSnapshot.opportunities.filter(p=>Date.now()-Date.parse(p.scannedAt)<2*scanEveryMs)};
   return json(res,200,snapshot);
  }
  if(req.method==='POST'&&u.pathname==='/api/scan'){
   if(req.headers['x-mi-action']!=='scan')return json(res,403,{error:'Local action required'});
   if(refreshing)return json(res,202,{status:'running'});
   void scan();return json(res,202,{status:'started'});
  }
  if(req.method==='GET'&&u.pathname==='/api/demo/status'){
   let saved=false;try{saved=Boolean(await keychainRead(services.key))&&Boolean(await keychainRead(services.secret))}catch{}
   return json(res,200,{saved,mode:'demo',ordersEnabled:false,secretExposed:false,endpoint:'api-demo.bybit.com'});
  }
  if(req.method==='POST'&&u.pathname==='/api/demo/connect'){
   if(req.headers['x-mi-action']!=='connect')return json(res,403,{error:'Local action required'});
   const payload=await readJson(req);
   const key=String(payload?.key||'').trim(),secret=String(payload?.secret||'').trim();
   if(!/^[A-Za-z0-9_-]{8,512}$/.test(key)||!/^[A-Za-z0-9_-]{8,512}$/.test(secret))
    return json(res,400,{error:'Невірний формат Demo API ключів'});
   await verifyDemoKey(key,secret);
   await keychainSave(services.key,key);
   await keychainSave(services.secret,secret);
   return json(res,200,{connected:true,mode:'demo',ordersEnabled:false});
  }
  if(req.method==='GET'&&u.pathname==='/api/demo/account'){
   try{return json(res,200,await loadDemoAccount())}
   catch(e){return json(res,503,{error:String(e.message||e).slice(0,180),ordersEnabled:false})}
  }
  if(req.method==='POST'&&u.pathname==='/api/demo/disconnect'){
   if(req.headers['x-mi-action']!=='disconnect')return json(res,403,{error:'Local action required'});
   for(const svc of Object.values(services))try{await keychainDelete(svc)}catch{}
   return json(res,200,{connected:false,ordersEnabled:false});
  }
  return json(res,404,{error:'Не знайдено'});
 }catch(e){return json(res,500,{error:String(e.message||e).slice(0,180)})}
});
server.listen(port,host,()=>console.log('Market Intelligence: http://'+host+':'+port));
if(process.env.MI_DISABLE_AUTOSCAN!=='1'){
 void scan();scannerInterval=setInterval(()=>void scan(),scanEveryMs);scannerInterval.unref?.();
}
