// Device-local, temporary cache. Not part of any app's profile or backup.
const TTL=7*86400000,MAX=2000;
const inflight=new Map();
let opening;
function db(){
 if(!globalThis.indexedDB)return Promise.resolve(null);
 return opening??=new Promise(resolve=>{const r=indexedDB.open('pwa-translation-cache-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('translations',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>resolve(null);});
}
async function transaction(mode,run){const d=await db();if(!d)return null;return new Promise((resolve,reject)=>{const tx=d.transaction('translations',mode),store=tx.objectStore('translations');let value;try{run(store,v=>{value=v;});}catch(e){reject(e);return;}tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error);});}
export async function translationKey(text,source='zh-CN',target='en'){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['google-v2',source,target,text])));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
async function cached(key,now){return transaction('readwrite',(store,done)=>{const req=store.get(key);req.onsuccess=()=>{const item=req.result;if(!item)return done(null);if(item.expires<=now){store.delete(key);return done(null);}store.put({...item,accessed:now});done(item.text);};}).catch(()=>null);}
async function storeTranslation(key,text,now){return transaction('readwrite',(store,done)=>{store.put({key,text,expires:now+TTL,accessed:now});const req=store.getAll();req.onsuccess=()=>{const live=[];for(const item of req.result){if(item.expires<=now)store.delete(item.key);else live.push(item);}live.sort((a,b)=>b.accessed-a.accessed);for(const item of live.slice(MAX))store.delete(item.key);done();};}).catch(()=>{});}
export async function getCachedTranslation(text,{source='zh-CN',target='en'}={}){return cached(await translationKey(text,source,target),Date.now());}
export async function clearTranslationCache(){await transaction('readwrite',(store,done)=>{store.clear();done();});}
// Small device-local diagnostic ring. Never store text, text hashes, cookies,
// account identifiers, secrets, or arbitrary server messages in diagnostics.
const DIAGNOSTICS_KEY='pwa.translation.diagnostics.v1',DIAGNOSTICS_MAX=100;
let diagnostics=[];
function safeCode(value){return typeof value==='string'&&/^[A-Z_]{1,48}$/.test(value)?value:'UNKNOWN';}
function safeId(value){return typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value)?value:undefined;}
function safeStatus(value){return Number.isInteger(value)&&value>=100&&value<=599?value:undefined;}
function cleanEvent(e){return {kind:'translation',at:typeof e.at==='string'&&Number.isFinite(Date.parse(e.at))?new Date(e.at).toISOString():new Date().toISOString(),code:safeCode(e.code),durationMs:Math.max(0,Math.min(3600000,Number(e.durationMs)||0)),characters:Math.max(0,Math.min(5000,Number(e.characters)||0)),status:safeStatus(e.status),upstreamStatus:safeStatus(e.upstreamStatus),requestId:safeId(e.requestId)};}
function readDiagnostics(){try{const saved=JSON.parse(globalThis.localStorage?.getItem(DIAGNOSTICS_KEY)||'null');if(Array.isArray(saved))return saved.slice(-DIAGNOSTICS_MAX).map(cleanEvent);}catch{}return diagnostics;}
function record(event){diagnostics=[...readDiagnostics(),cleanEvent({...event,at:new Date().toISOString()})].slice(-DIAGNOSTICS_MAX);try{globalThis.localStorage?.setItem(DIAGNOSTICS_KEY,JSON.stringify(diagnostics));}catch{}}
export function getTranslationDiagnostics(){return {schema:1,createdAt:new Date().toISOString(),events:readDiagnostics().map(cleanEvent)};}
export function clearTranslationDiagnostics(){diagnostics=[];try{globalThis.localStorage?.removeItem(DIAGNOSTICS_KEY);}catch{}}
export async function translate(text,{source='zh-CN',target='en',fetcher=globalThis.fetch}={}){
 const start=Date.now(),characters=[...text].length;
 const report=(code,meta={})=>record({code,characters,durationMs:Date.now()-start,...meta});
 const key=await translationKey(text,source,target);const hit=await cached(key,Date.now());if(hit!=null){report('CACHE_HIT');return hit;}
 if(inflight.has(key))return inflight.get(key);
 const promise=(async()=>{
  let response;try{response=await fetcher('/_translation/translate',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-PWA-CSRF':'1'},body:JSON.stringify({text,source,target}),cache:'no-store'});}catch{report('NETWORK');throw Error('Translation network request failed (NETWORK).');}
  let data;try{data=await response.json();}catch{}
  const meta={status:response.status,upstreamStatus:safeStatus(data?.upstreamStatus),requestId:safeId(data?.requestId)};
  if(!response.ok||typeof data?.text!=='string'){
   const code=data?.code?safeCode(data.code):response.status===503?'GATEWAY_UNAVAILABLE':response.status===401?'DISCONNECTED':response.ok?'INVALID_RESPONSE':'HTTP_ERROR';
   report(code,meta);
   const message=typeof data?.error==='string'?data.error:response.status===503?'Translation gateway or Worker unavailable':'Translation unavailable; retry when connected.';
   throw Error(`${message} (${code}; HTTP ${response.status}${meta.upstreamStatus?`; upstream ${meta.upstreamStatus}`:''}${meta.requestId?`; request ${meta.requestId}`:''})`);
  }
  report('OK',meta);await storeTranslation(key,data.text,Date.now());return data.text;
 })();
 inflight.set(key,promise);try{return await promise;}finally{inflight.delete(key);}
}
