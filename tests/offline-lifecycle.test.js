import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const template=readFileSync(new URL('build/sw.template.js',root),'utf8').replace('__CACHE_PREFIXES__',JSON.stringify(['ciyan-shell-','app-launcher-shell-'])).replace('__EXCLUDED_PATH_PREFIXES__',JSON.stringify(['/_profiles/']));
const base='https://offline.test/';
const key=x=>typeof x==='string'?x:x.url;
const cacheStore=()=>{
 const store=new Map();return {store,keys:async()=>[...store.keys()],delete:async k=>store.delete(k),open:async k=>{
  if(!store.has(k))store.set(k,new Map());const m=store.get(k);return {match:async url=>m.get(key(url))?.clone(),put:async(url,r)=>m.set(key(url),r.clone()),delete:async url=>m.delete(key(url))};
 }};
};
const def=(path,text,groups)=>({path:'./'+path,size:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),groups,text});
const old=[def('index.html','old shell',['shell']),def('launcher.js','unchanged',['shell']),def('app.js','app version 1',['app:ciyan']),def('chapters/one.zip','original',['reader:original','reader:hsk6']),def('chapters/graded-v094/1.js','grade 1',['reader:hsk6'])];
const next=old.map(a=>a.path==='./index.html'?def('index.html','new shell',['shell']):a.path==='./app.js'?def('app.js','app version 2',['app:ciyan']):a.path.includes('graded')?def('chapters/graded-v094/1.js','grade 2',['reader:hsk6']):a);
const make=(name,assets,caches,{fail=[],windows=[],network=true}={})=>{
 const handlers={},requests=[],messages=[];let skipped=0;
 const files=new Map(assets.map(a=>[new URL(a.path,base).href,a.text]));
 const script=template.replace('__SHELL_CACHE_NAME__',name).replace('__PRECACHE_ASSETS__',JSON.stringify(assets.map(({text,...a})=>a)));
 const ctx={URL,Request,Response,crypto:webcrypto,caches,fetch:async r=>{const u=key(r);requests.push(u);if(!network||fail.includes(u))throw Error('network failure');return new Response(files.get(u)??'not found',{status:files.has(u)?200:404});},self:{location:{origin:'https://offline.test'},registration:{scope:base},addEventListener:(name,f)=>handlers[name]=f,skipWaiting:async()=>{skipped++;},clients:{matchAll:async()=>windows.map(id=>({id})),claim:async()=>{}}}};
 vm.runInNewContext(script,ctx);
 const event=async(type,fields={})=>{let pending;handlers[type]({...fields,waitUntil:p=>pending=p,respondWith:p=>pending=p});return pending;};
 return {requests,messages,skipCount:()=>skipped,event,group:async(action,group)=>{const out=[];await event('message',{data:{type:'offline-pack',action,group},ports:[{postMessage:x=>out.push(x)}]});return out.at(-1);},activateRequest:async id=>event('message',{data:'activate-update',source:{id,postMessage:x=>messages.push(x)}}),fetch:async(path,{clientId='new',mode='cors',resultingClientId='other'}={})=>event('fetch',{request:{url:new URL(path,base).href,method:'GET',mode},clientId,resultingClientId})};
};
const v1='ciyan-shell-test-1',v2='ciyan-shell-test-2';
test('fresh install downloads only shell; apps and reader packs are on demand',async()=>{
 const c=cacheStore(),w=make(v1,old,c);await w.event('install');await w.event('activate');
 assert.deepEqual(w.requests.sort(),[base+'index.html',base+'launcher.js'].sort());assert.equal(w.skipCount(),0);
 let status=await w.group('status');assert.equal(status.groups.find(g=>g.group==='app:ciyan').complete,false);
 assert.equal((await w.group('download','app:ciyan')).ok,true);
 assert.equal((await w.group('download','reader:hsk6')).ok,true);
 status=await w.group('status');assert.ok(status.groups.every(g=>g.complete));
 const count=w.requests.length;assert.equal(await (await w.fetch('app.js')).text(),'app version 1');assert.equal(w.requests.length,count);
 assert.equal(await w.fetch('_profiles/status'),undefined);assert.equal(await w.fetch('reader-content/private'),undefined);
 await w.group('remove','reader:hsk6');status=await w.group('status');assert.equal(status.groups.find(g=>g.group==='reader:hsk6').complete,false);assert.equal(status.groups.find(g=>g.group==='reader:original').complete,true);
});
test('update reuses unchanged bytes, upgrades installed core, and leaves changed optional pack incomplete',async()=>{
 const c=cacheStore(),a=make(v1,old,c);await a.event('install');await a.event('activate');await a.group('download','app:ciyan');await a.group('download','reader:hsk6');
 const privateCache=await c.open('ciyan-reader-text-v1');await privateCache.put(base+'private',new Response('private content'));
 const b=make(v2,next,c,{windows:['old']});await b.event('install');
 assert.deepEqual(b.requests.sort(),[base+'index.html',base+'app.js'].sort());
 assert.equal((await b.group('status')).groups.find(g=>g.group==='reader:hsk6').complete,false);
 await b.activateRequest('old');assert.equal(b.skipCount(),1);await b.event('activate');
 assert.equal(await (await b.fetch('app.js',{clientId:'old'})).text(),'app version 1');
 assert.equal(await (await b.fetch('app.js')).text(),'app version 2');
 assert.equal(await (await b.fetch('?app=ciyan',{mode:'navigate',clientId:'old'})).text(),'new shell');
 assert.equal(await (await privateCache.match(base+'private')).text(),'private content');
});
test('failed shell or installed core update preserves the previous complete release',async()=>{
 const c=cacheStore(),a=make(v1,old,c);await a.event('install');await a.event('activate');await a.group('download','app:ciyan');
 for(const file of ['index.html','app.js']){
  const b=make(v2,next,c,{fail:[base+file]});await assert.rejects(b.event('install'),/network failure/);
  assert.equal((await c.keys()).includes(v2),false);assert.equal((await c.keys()).includes(v1),true);
  assert.equal(await (await a.fetch('app.js')).text(),'app version 1');
 }
});
test('optional download interruption and digest mismatch do not invalidate shell; multiple windows prevent forced activation',async()=>{
 const c=cacheStore(),w=make(v1,old,c,{fail:[base+'chapters/graded-v094/1.js'],windows:['one','two']});await w.event('install');await w.event('activate');
 assert.equal((await w.group('download','reader:hsk6')).ok,false);
 assert.equal((await w.group('status')).groups.find(g=>g.group==='reader:hsk6').complete,false);
 assert.equal(await (await w.fetch('?app=ciyan',{mode:'navigate'})).text(),'old shell');
 await w.activateRequest('one');assert.equal(w.skipCount(),0);assert.equal(w.messages[0].type,'offline-update-blocked');
 const bad=next.map(a=>a.path==='./index.html'?{...a,text:'tampered!'}:a);const b=make(v2,bad,c);await assert.rejects(b.event('install'),/Asset unavailable or release changed/);
});
