import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
const port=14288;
const server=spawn(process.execPath,['market-intelligence/server.mjs'],{
 cwd:root,env:{...process.env,MI_PORT:String(port),MI_DISABLE_AUTOSCAN:'1'},
 stdio:['ignore','pipe','pipe']
});
let logs='',errLogs='';
server.stdout.on('data',b=>{logs+=b.toString().slice(0,500)});
server.stderr.on('data',b=>{errLogs+=b.toString().slice(0,600)});
const base='http://127.0.0.1:'+port;
try{
 let started=false;
 for(let i=0;i<75;i++){
  try{const r=await fetch(base+'/api/status');if(r.ok){started=true;break}}catch{}
  await pause(80);
 }
 assert.ok(started,'Independent server failed to start: '+errLogs);
 const response=await fetch(base+'/');
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-security-policy')||'',/script-src 'self'/);
 const html=await response.text();
 for(const id of ['featured','watchList','demoForm','demoKey','demoSecret','planDialog','metricChecked','metricReady','metricWatch','diagnosticsBody'])
  assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 assert.ok(html.includes('aria-label="Основні розділи"'),'Missing navigation');
 assert.ok(html.includes('<svg class="ui-icon"'),'Missing standard navigation icons');
 assert.ok(!html.includes('<div class="rail-caption">'),'Legacy oversized sidebar caption remains');
 for(const path of ['/app.css','/app.js']){
  const r=await fetch(base+path);
  assert.equal(r.status,200,'missing '+path);
  assert.ok((await r.text()).length>500);
 }
 const status=await (await fetch(base+'/api/status')).json();
 assert.equal(status.ordersEnabled,false);
 const stocks=status.markets.find(m=>m.id==='stocks');
 assert.equal(stocks.status,'not-connected','Unconnected stocks must not be marketed as live');
 const snapshot=await (await fetch(base+'/api/opportunities')).json();
 assert.deepEqual(snapshot.opportunities,[]);
 const denied=await fetch(base+'/api/demo/connect',{method:'POST',headers:{'content-type':'application/json','origin':'https://attacker.example','x-mi-action':'connect'},body:JSON.stringify({key:'FAKESECRETKEY',secret:'FAKESECRETSECRET'})});
 assert.equal(denied.status,403);
 const bad=await fetch(base+'/api/demo/connect',{method:'POST',headers:{'content-type':'application/json','x-mi-action':'connect'},body:JSON.stringify({key:'abc',secret:'abc'})});
 assert.equal(bad.status,400);
 assert.ok(!(await bad.text()).includes('FAKESECRET'));
 const noOrder=await fetch(base+'/api/order/create',{method:'POST',headers:{'x-mi-action':'connect'}});
 assert.equal(noOrder.status,404);
 const fakeOrigin=await fetch(base+'/api/status',{headers:{origin:'https://attacker.example'}});
 assert.equal(fakeOrigin.status,403);
 console.log('PASS: independent startup, signal-first UI, unconnected markets, local Demo bridge, no-order policy and origin protection');
}finally{server.kill('SIGTERM')}
