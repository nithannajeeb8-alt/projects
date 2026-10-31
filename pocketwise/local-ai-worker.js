/* Optional on-device WebLLM mapper. Only bounded sample rows explicitly supplied for column mapping enter this worker; no statement data is posted to a remote inference API. */
import './local-ai-cache-recovery.js';
const MODEL_ID='Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const WEBLLM_URL='https://esm.run/@mlc-ai/web-llm@0.2.86';
const LEGACY_CACHE_NAMES=['pocketwise-qwen3-06b-v1','pocketwise-smollm2-135m-v1'];
let webllmPromise=null,engine=null,enginePromise=null;
const post=(type,data={})=>self.postMessage({type,...data});
function progressDetail(report){return {text:String(report?.text||report?.progressText||report?.status||'Preparing local model…'),progress:Number.isFinite(report?.progress)?report.progress:null};}
async function getLibrary(){if(!webllmPromise)webllmPromise=import(WEBLLM_URL);return webllmPromise;}
async function ensureEngine(){
  if(engine)return engine;
  if(enginePromise)return enginePromise;
  enginePromise=(async()=>{
    post('status',{message:'Checking WebGPU support…'});
    if(!self.navigator?.gpu)throw new Error('This browser does not expose WebGPU. For safety, Qwen2.5 will not run on CPU. Statement parsing and manual mapping still work.');
    let adapter=null;try{adapter=await self.navigator.gpu.requestAdapter();}catch(_){}
    if(!adapter)throw new Error('WebGPU is unavailable or no compatible GPU adapter was found. AI is disabled to protect the browser from a memory-heavy CPU fallback.');
    const lib=await getLibrary();
    post('status',{message:'Loading Qwen2.5-1.5B locally. First use may download about 880 MB; progress is shown here.'});
    const createEngine=()=>lib.CreateMLCEngine(MODEL_ID,{
      initProgressCallback:report=>post('progress',{detail:progressDetail(report)}),
      logLevel:'ERROR'
    });
    // WebLLM can encounter a corrupt/incomplete cached tensor shard (for example,
    // a record range larger than a zero-byte shard). Purge only this model's WebLLM
    // cache and retry once, rather than leaving the user stuck with the same error.
    engine=await self.PocketwiseAICacheRecovery.loadWithCacheRecovery({
      load:createEngine,
      isCorruptCacheError:self.PocketwiseAICacheRecovery.isCorruptTensorCacheError,
      onRecover:async()=>post('status',{message:'A damaged Qwen2.5 cache was detected. Removing only the local AI model cache and retrying once…'}),
      clearCache:async()=>{
        post('status',{message:'Repairing the Qwen2.5 model cache…'});
        await lib.deleteModelAllInfoInCache(MODEL_ID,lib.prebuiltAppConfig);
      }
    });
    return engine;
  })();
  try{return await enginePromise;}catch(error){engine=null;enginePromise=null;throw error;}
}
async function unloadEngine(){const current=engine;engine=null;enginePromise=null;if(current){try{await current.unload();}catch(error){console.warn('WebLLM unload warning',error);}}}
async function load(intent='prepare'){
  try{
    await ensureEngine();
    if(intent!=='map')await unloadEngine();
    post('loaded',{model:MODEL_ID,device:'webgpu'});
  }catch(error){await unloadEngine();post('error',{message:String(error?.message||error||'Unable to prepare local AI model.')});}
}
function parseJsonObject(text){const s=String(text||'').replace(/<think>[\s\S]*?<\/think>/g,'').trim();const first=s.indexOf('{'),last=s.lastIndexOf('}');if(first<0||last<first)throw new Error('The local model did not return a usable column map.');return JSON.parse(s.slice(first,last+1));}
async function mapColumns(headers,sampleRows=[]){
  const safeHeaders=(headers||[]).slice(0,80).map((label,index)=>({index,label:String(label||'').slice(0,100)}));
  const safeRows=(Array.isArray(sampleRows)?sampleRows:[]).slice(0,8).map(row=>(Array.isArray(row)?row:[]).slice(0,12).map(value=>String(value??'').slice(0,100)));
  if(!safeHeaders.length)throw new Error('No column labels were supplied to the local model.');
  const current=await ensureEngine();
  try{
    const response=await current.chat.completions.create({
      model:MODEL_ID,
      messages:[
        {role:'system',content:'You are a cautious bank-statement table column mapper. Inputs are processed locally. Use header labels and sample cell values to identify columns. Return only a JSON object with zero-based indexes or null. Never invent transaction rows, amounts, dates or directions. Prefer separate debit and credit columns when present. Never map a running balance as transaction amount. For generic labels such as Column 1, infer roles only when sample values strongly support it; otherwise return null.'},
        {role:'user',content:'Map this statement table to exactly this schema: {"date": number|null, "description": number|null, "debit": number|null, "credit": number|null, "amount": number|null, "balance": number|null, "reference": number|null}. Use sample values to distinguish transaction amount from running balance. Headers: '+JSON.stringify(safeHeaders)+' Sample rows (possibly private transaction data, processed by this local model only): '+JSON.stringify(safeRows)}
      ],
      temperature:0,
      max_tokens:180,
      response_format:{type:'json_object'}
    });
    const content=response?.choices?.[0]?.message?.content;
    return parseJsonObject(content);
  }finally{await unloadEngine();}
}
async function removeCache(){
  try{
    const lib=await getLibrary();
    await lib.deleteModelAllInfoInCache(MODEL_ID,lib.prebuiltAppConfig);
    if('caches'in self)await Promise.all(LEGACY_CACHE_NAMES.map(name=>self.caches.delete(name).catch(()=>false)));
    post('cache-removed',{model:MODEL_ID});
  }catch(error){post('error',{message:String(error?.message||error||'Could not clear the local AI model cache.')});}
}
self.addEventListener('message',async event=>{
  const {id,type,headers,sampleRows,intent}=event.data||{};
  try{
    if(type==='load')await load(intent||'prepare');
    else if(type==='mapColumns'){const mapping=await mapColumns(headers||[],sampleRows||[]);post('response',{id,mapping});}
    else if(type==='removeCache')await removeCache();
  }catch(error){const message=String(error?.message||error||'Local AI operation failed.');if(type==='load')post('error',{message});else if(type==='mapColumns')post('response-error',{id,message});else if(type==='removeCache')post('error',{message});}
});
