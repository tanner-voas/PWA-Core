import test from 'node:test';
import assert from 'node:assert/strict';
import {checkForUpdatesAndReload,runUpdateButton} from '../src/pwa-update.js';

test('shared updater does not hang when no update is waiting',async()=>{
 let checks=0,reloads=0;
 const registration={waiting:null,installing:null,async update(){checks++;}};
 await checkForUpdatesAndReload({navigatorRef:{onLine:true,serviceWorker:{register:async()=>registration}},locationRef:{reload(){reloads++;}},timeoutMs:100});
 assert.equal(checks,1);assert.equal(reloads,1);
});

test('shared updater activates a waiting worker before reloading',async()=>{
 let reloads=0;const listeners=new Map();
 const service={controller:{},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
 const worker={state:'installed',addEventListener(){},removeEventListener(){},postMessage(message){
  assert.equal(message,'activate-update');this.state='activated';service.controller=this;listeners.get('controllerchange')?.();
 }};
 service.register=async()=>({waiting:worker,installing:null,async update(){}});
 await checkForUpdatesAndReload({navigatorRef:{onLine:true,serviceWorker:service},locationRef:{reload(){reloads++;}},timeoutMs:100});
 assert.equal(reloads,1);
});

test('update button restores its controls after a bounded timeout',async()=>{
 const button={innerHTML:'<svg></svg>',disabled:false,textContent:'',setAttribute(){},removeAttribute(){}};
 let message='';
 const navigatorRef={onLine:true,serviceWorker:{register:async()=>({waiting:null,installing:null,update:()=>new Promise(()=>{})})}};
 assert.equal(await runUpdateButton(button,{navigatorRef,locationRef:{reload(){assert.fail('should not reload')}},timeoutMs:15,onError:e=>message=e}),false);
 assert.match(message,/timed out/);assert.equal(button.disabled,false);assert.equal(button.innerHTML,'<svg></svg>');
});

test('update indicator keeps its icon while checking and restores it after failure',async()=>{
 let during='',error='';const classes=new Set();
 const button={innerHTML:'<svg class="ico"></svg>',disabled:false,
  classList:{add:key=>classes.add(key),remove:key=>classes.delete(key)},
  attrs:new Map([['aria-label','Check for updates']]),
  getAttribute(key){return this.attrs.get(key)??null;},setAttribute(key,value){this.attrs.set(key,value);},removeAttribute(key){this.attrs.delete(key);}};
 const navigatorRef={onLine:true,serviceWorker:{register:async()=>({waiting:null,installing:null,update:()=>new Promise(()=>{})})}};
 const promise=runUpdateButton(button,{navigatorRef,timeoutMs:15,onStatus:()=>{during=button.innerHTML;},onError:e=>{error=e;}});
 assert.equal(classes.has('pwa-updating'),true);
 assert.equal(await promise,false);
 assert.equal(during,'<svg class="ico"></svg>');
 assert.equal(button.innerHTML,during);
 assert.equal(button.attrs.get('aria-label'),'Check for updates');
 assert.equal(classes.has('pwa-updating'),false);
 assert.match(error,/timed out/);
});
