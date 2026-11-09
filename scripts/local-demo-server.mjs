/**
 * Local-only settings bridge for Bybit Demo credentials.
 * Run: node scripts/local-demo-server.mjs
 * Open http://127.0.0.1:4177/ (not GitHub Pages).
 *
 * Keys are stored in macOS Keychain, NEVER in HTML, localStorage, Git or logs.
 * This bridge intentionally does not place orders.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

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
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"});
    res.end(html);return;
  }
  if(req.method==='GET'&&path==='/api/demo/status'){
    const configured=await keychainRead(services.key).then(Boolean).catch(()=>false);
    return json(res,200,{configured,mode:'demo',ordersEnabled:false});
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
server.listen(port,host,()=>console.log('AI Trading Assistant Demo settings: http://127.0.0.1:'+port+'/'));