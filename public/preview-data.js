/* Synthetic data for the visual preview only. Never used for account balances or orders. */
(() => {
  'use strict';
  window.__ATA_VISUAL_PREVIEW__ = true;
  const originalFetch = window.fetch.bind(window);
  const intervals = {'1':60000,'5':300000,'15':900000,'30':1800000,'60':3600000,'240':14400000,D:86400000,W:604800000};
  const parameters = {
    '1':[1.6,190,85,.28], '5':[5,360,140,.22], '15':[9,570,180,.19],
    '30':[14,780,220,.18], '60':[23,1100,290,.16], '240':[38,1750,420,.14],
    D:[62,2850,520,.12], W:[85,4000,760,.10]
  };
  const makeCandles = interval => {
    const tf = Object.hasOwn(intervals,interval) ? interval : 'D';
    const [slope,amplitude,noise,frequency] = parameters[tf];
    const baseline = i => 103730.44+(i-179)*slope
      +amplitude*(Math.sin(i*frequency+tf.length)-Math.sin(179*frequency+tf.length))
      +amplitude*.46*(Math.sin(i*frequency*.43+2)-Math.sin(179*frequency*.43+2));
    const lastTime=Date.UTC(2026,10,9,8,0);
    return Array.from({length:180},(_,i)=>{
      const c=baseline(i),o=i===0?c-noise:baseline(i-1)+Math.sin(i*1.9)*noise;
      const wick=80+noise*(.35+.65*Math.abs(Math.sin(i*.77+tf.length)));
      return {t:lastTime-(179-i)*intervals[tf],o,c,h:Math.max(o,c)+wick,l:Math.min(o,c)-wick*.88,
        v:140+(i%13)*20+Math.round(Math.abs(Math.sin(i*.31+tf.length))*260)};
    });
  };
  window.fetch = async (input,init) => {
    const url=String(input);
    if(url.startsWith('/api/market-data')){
      const interval=new URL(url,location.origin).searchParams.get('interval')||'D';
      return new Response(JSON.stringify({candles:makeCandles(interval),interval,updatedAt:Date.now(),source:'STATIC_VISUAL_PREVIEW'}),{
        status:200,headers:{'content-type':'application/json'}
      });
    }
    return originalFetch(input,init);
  };
})();
