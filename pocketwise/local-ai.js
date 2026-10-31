/* Optional WebLLM bridge for Qwen2.5-1.5B. Model execution is isolated in a worker. */
(function(){
  'use strict';
  const READY_KEY='pocketwise-webllm-qwen25-15b-v1';
  const LEGACY_READY_KEYS=['pocketwise-qwen3-last-prepared-v1','pocketwise-smollm2-last-prepared-v1'];
  const LEGACY_CACHE_NAMES=['pocketwise-qwen3-06b-v1','pocketwise-smollm2-135m-v1'];
  let worker=null,seq=0,requests=new Map(),loadPromise=null,loadState='idle',currentIntent='prepare';
  const $=s=>document.querySelector(s);
  function settingStatus(message){const el=$('#pw-local-ai-status');if(el)el.textContent=message;}
  function setActionButtons(){const busy=loadState==='loading';const dl=$('#pw-local-ai-download'),remove=$('#pw-local-ai-remove');if(dl){dl.disabled=busy;dl.textContent=busy?'Downloading / loading…':loadState==='ready'?'Qwen cached · Prepare again':'Download Qwen2.5 AI';}if(remove)remove.disabled=busy;}
  function progressText(detail){
    const label=String(detail?.text||detail?.status||detail?.file||'Preparing model files…');
    const n=Number(detail?.progress);
    return Number.isFinite(n)&&n>=0?`${label} · ${Math.max(0,Math.min(100,Math.round(n*100)))}%`:label;
  }
  function releaseWorker(){const old=worker;worker=null;try{old?.terminate();}catch(_){}}
  function ensureWorker(){
    if(worker)return worker;
    worker=new Worker(new URL('local-ai-worker.js',document.baseURI),{type:'module',name:'pocketwise-local-ai'});
    worker.addEventListener('message',event=>{
      const msg=event.data||{};
      if(msg.type==='status'){settingStatus(msg.message||'Preparing Qwen2.5 locally…');return;}
      if(msg.type==='progress'){settingStatus(progressText(msg.detail));return;}
      if(msg.type==='loaded'){
        loadState='ready';try{localStorage.setItem(READY_KEY,'1');}catch(_){}
        settingStatus('Qwen2.5-1.5B is prepared in this browser cache. Its runtime is released after preparation and each mapping to reduce memory pressure.');setActionButtons();
        if(loadPromise){const resolve=loadPromise.resolve;loadPromise=null;resolve(msg);}
        if(currentIntent==='prepare')releaseWorker();
        return;
      }
      if(msg.type==='error'){
        loadState='error';try{localStorage.removeItem(READY_KEY);}catch(_){}const message=String(msg.message||'Local AI could not be loaded.').slice(0,500);
        settingStatus(`Could not prepare local AI: ${message} Statement parsing and manual column mapping remain available.`);setActionButtons();
        if(loadPromise){const reject=loadPromise.reject;loadPromise=null;reject(new Error(message));}
        releaseWorker();return;
      }
      if(msg.type==='cache-removed')return;
      if(msg.type==='response'||msg.type==='response-error'){
        const request=requests.get(msg.id);if(!request)return;requests.delete(msg.id);if(request.timer)clearTimeout(request.timer);
        if(msg.type==='response')request.resolve(msg.mapping);else request.reject(new Error(msg.message||'Local AI mapping failed.'));
        releaseWorker();
      }
    });
    worker.addEventListener('error',event=>{
      const message=String(event.message||'The local AI worker failed.').slice(0,400);loadState='error';try{localStorage.removeItem(READY_KEY);}catch(_){}settingStatus(`Local AI unavailable: ${message} Manual column mapping remains available.`);setActionButtons();
      if(loadPromise){loadPromise.reject(new Error(message));loadPromise=null;}releaseWorker();
      for(const [id,request] of requests){if(request.timer)clearTimeout(request.timer);request.reject(new Error(message));requests.delete(id);}
    });
    return worker;
  }
  function isDownloaded(){try{return localStorage.getItem(READY_KEY)==='1';}catch(_){return false;}}
  async function ensureLoaded(intent='prepare'){
    currentIntent=intent;
    if(loadState==='ready')return true;
    if(loadPromise)return loadPromise.promise;
    loadState='loading';setActionButtons();settingStatus('Starting the optional on-device Qwen model. First use downloads about 880 MB; Wi-Fi is recommended.');
    const w=ensureWorker();let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});loadPromise={promise,resolve,reject};w.postMessage({type:'load',intent});return promise;
  }
  async function clearModelCache(){
    releaseWorker();loadPromise=null;loadState='idle';
    for(const [id,request] of requests){if(request.timer)clearTimeout(request.timer);request.reject(new Error('Local AI cache removal started.'));requests.delete(id);}
    const cleaner=new Worker(new URL('local-ai-worker.js',document.baseURI),{type:'module',name:'pocketwise-model-cache-cleaner'});
    try{
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Cache removal timed out.')),45000);
        cleaner.addEventListener('message',event=>{const msg=event.data||{};if(msg.type==='cache-removed'){clearTimeout(timeout);resolve();}else if(msg.type==='error'){clearTimeout(timeout);reject(new Error(msg.message||'Unable to remove model cache.'));}}, {once:false});
        cleaner.addEventListener('error',event=>{clearTimeout(timeout);reject(new Error(event.message||'Cache cleanup worker failed.'));},{once:true});
        cleaner.postMessage({type:'removeCache'});
      });
      if('caches'in window)await Promise.all(LEGACY_CACHE_NAMES.map(name=>caches.delete(name).catch(()=>false)));
      try{localStorage.removeItem(READY_KEY);for(const key of LEGACY_READY_KEYS)localStorage.removeItem(key);}catch(_){}
      settingStatus('Qwen2.5 model cache removed. Existing PocketWise transactions and other app data were not changed.');setActionButtons();
    }finally{cleaner.terminate();}
  }
  function initializeSettings(){
    // Clean only prior model caches/flags. Never clear the origin's general storage or transactions.
    if('caches'in window)Promise.all(LEGACY_CACHE_NAMES.map(name=>caches.delete(name).catch(()=>false))).catch(()=>{});
    try{for(const key of LEGACY_READY_KEYS)localStorage.removeItem(key);}catch(_){}
    if(isDownloaded())settingStatus('Qwen2.5-1.5B was prepared on this browser before. PocketWise checks the cache when the model is used; the browser can evict cached files.');
    else settingStatus('Optional Qwen2.5-1.5B-Instruct · about 880 MB download and about 1.63 GB GPU memory. Requires WebGPU; there is no CPU fallback. Download is user-triggered; statement rows remain on-device.');
    setActionButtons();
    $('#pw-local-ai-download')?.addEventListener('click',async()=>{try{await ensureLoaded('prepare');}catch(_){/* status explains the safe fallback */}});
    $('#pw-local-ai-remove')?.addEventListener('click',async()=>{
      if(!confirm('Remove the Qwen2.5 model files from this browser? Your PocketWise transactions and other app data will not be changed.'))return;
      const button=$('#pw-local-ai-remove');if(button)button.disabled=true;
      try{await clearModelCache();}catch(error){settingStatus(`Could not fully remove model cache: ${error.message||error}. PocketWise transaction data was not changed.`);setActionButtons();}
    });
  }
  async function mapColumns(headers,sampleRows=[]){
    currentIntent='map';await ensureLoaded('map');const w=ensureWorker(),id=++seq;
    const safeHeaders=(headers||[]).slice(0,80).map(v=>String(v).slice(0,100));
    const safeRows=(Array.isArray(sampleRows)?sampleRows:[]).slice(0,8).map(row=>(Array.isArray(row)?row:[]).slice(0,12).map(v=>String(v??'').slice(0,100)));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{const request=requests.get(id);if(request){requests.delete(id);request.reject(new Error('The local AI took too long to respond. Use manual column mapping instead.'));releaseWorker();}},90000);
      requests.set(id,{resolve,reject,timer});w.postMessage({type:'mapColumns',id,headers:safeHeaders,sampleRows:safeRows});
    });
  }
  window.PocketwiseLocalAI={ensureLoaded,mapColumns,isLoaded:()=>loadState==='ready',isDownloaded,modelName:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',initializeSettings};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initializeSettings,{once:true});else initializeSettings();
})();
