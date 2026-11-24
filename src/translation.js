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
export async function translate(text,{source='zh-CN',target='en',fetcher=globalThis.fetch}={}){
 const key=await translationKey(text,source,target);const hit=await cached(key,Date.now());if(hit!=null)return hit;
 if(inflight.has(key))return inflight.get(key);
 const promise=(async()=>{const response=await fetcher('/_translation/translate',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-PWA-CSRF':'1'},body:JSON.stringify({text,source,target}),cache:'no-store'});let data;try{data=await response.json();}catch{}if(!response.ok||typeof data?.text!=='string')throw Error(data?.error||'Translation unavailable; retry when connected.');await storeTranslation(key,data.text,Date.now());return data.text;})();
 inflight.set(key,promise);try{return await promise;}finally{inflight.delete(key);}
}
