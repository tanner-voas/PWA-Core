import test from 'node:test';
import assert from 'node:assert/strict';
import {hasLauncherHost,returnToLauncher,runHostedOrLocalUpdate,registerStandaloneWorker} from '../src/browser-host.js';
import {downloadBlob,downloadText,shareFileOrDownload} from '../src/browser-files.js';

test('host detection is live, callable only and preserves the receiver',()=>{
 const env={};assert.equal(hasLauncherHost(env),false);assert.throws(()=>returnToLauncher(env),/no launcher/);
 env.__APP_LAUNCHER__={returnToLauncher:true};assert.equal(hasLauncherHost(env),false);
 env.__APP_LAUNCHER__={returnToLauncher(){return this;}};
 assert.equal(hasLauncherHost(env),true);assert.equal(returnToLauncher(env),env.__APP_LAUNCHER__);
 delete env.__APP_LAUNCHER__;assert.equal(hasLauncherHost(env),false);
});
test('host updater is authoritative, local fallback is lazy, errors are propagated',async()=>{
 const button={},options={};let localCalls=0;const local=(b,o)=>{assert.equal(b,button);assert.equal(o,options);localCalls++;return 'local';};
 const host={runUpdateButton(b,o){assert.equal(this,host);assert.equal(b,button);assert.equal(o,options);return Promise.resolve('host');}};
 const env={__APP_LAUNCHER__:host};assert.equal(await runHostedOrLocalUpdate(button,options,local,env),'host');assert.equal(localCalls,0);
 host.runUpdateButton=()=>Promise.reject(Error('host failure'));await assert.rejects(runHostedOrLocalUpdate(button,options,local,env),/host failure/);assert.equal(localCalls,0);
 delete host.runUpdateButton;assert.equal(runHostedOrLocalUpdate(button,options,local,env),'local');assert.equal(localCalls,1);
});
test('standalone registration is best effort and preserves URL and update policy',async()=>{
 const calls=[],errors=[],env={navigator:{serviceWorker:{register(...args){calls.push(args);return Promise.resolve('ok');}}},location:{protocol:'https:'}};
 const onError=e=>errors.push(e.message);
 assert.equal(await registerStandaloneWorker({env,onError}),'ok');assert.deepEqual(calls,[['./sw.js',{updateViaCache:'none'}]]);
 env.location.protocol='file:';assert.equal(registerStandaloneWorker({env,onError}),undefined);assert.equal(calls.length,1);
 env.location.protocol='http:';env.navigator.serviceWorker.register=()=>Promise.reject(Error('offline'));await registerStandaloneWorker({env,onError});
 env.navigator.serviceWorker.register=()=>{throw Error('denied');};registerStandaloneWorker({env,onError});assert.deepEqual(errors,['offline','denied']);
 assert.equal(registerStandaloneWorker({env:{}}),undefined);
});
function fileEnv({clickError=false}={}){
 const log=[],timers=[];const anchor={style:{},click(){log.push(['click',this.href,this.download,this.style.display]);if(clickError)throw Error('click failed');},remove(){log.push(['remove']);}};
 const env={Blob,URL:{createObjectURL(blob){log.push(['url',blob]);return 'blob:test';},revokeObjectURL(url){log.push(['revoke',url]);}},document:{createElement(tag){assert.equal(tag,'a');return anchor;},body:{appendChild(a){assert.equal(a,anchor);log.push(['attach']);}}},navigator:{},setTimeout(fn,ms){timers.push({fn,ms});}};
 return {env,log,timers};
}
test('download keeps exact blob and filename, removes anchor, defers revocation',()=>{
 const {env,log,timers}=fileEnv(),blob=new Blob(['abc'],{type:'image/png'});
 downloadBlob(blob,'map.png',{env,revokeDelay:15000});assert.deepEqual(log,[['url',blob],['attach'],['click','blob:test','map.png','none'],['remove']]);
 assert.equal(timers[0].ms,15000);timers[0].fn();assert.deepEqual(log.at(-1),['revoke','blob:test']);
});
test('text download preserves bytes and caller MIME type',async()=>{
 const {env,log,timers}=fileEnv();downloadText('a,中\n','report.csv',{env,type:'text/csv',revokeDelay:1000});
 assert.equal(await log[0][1].text(),'a,中\n');assert.equal(log[0][1].type,'text/csv');assert.equal(timers[0].ms,1000);
});
test('failed click still removes anchor and schedules URL cleanup',()=>{
 const {env,log,timers}=fileEnv({clickError:true});assert.throws(()=>downloadBlob(new Blob(),'a',{env}),/click failed/);assert.deepEqual(log.at(-1),['remove']);timers[0].fn();assert.deepEqual(log.at(-1),['revoke','blob:test']);
});
test('share passes the exact file; download fallback only when unavailable or not requested',async()=>{
 const {env,log}=fileEnv(),file=new File(['backup'],'backup.json',{type:'application/json'});let shares=0;
 env.navigator={canShare(args){assert.equal(this,env.navigator);assert.deepEqual(args,{files:[file]});return true;},async share(args){assert.equal(this,env.navigator);assert.deepEqual(args,{files:[file],title:'Backup'});shares++;}};
 assert.equal(await shareFileOrDownload(file,{env,preferShare:true,title:'Backup'}),'shared');assert.equal(shares,1);assert.equal(log.length,0);
 env.navigator.canShare=()=>false;assert.equal(await shareFileOrDownload(file,{env,preferShare:true}),'downloaded');assert.equal(log[0][1],file);
 assert.equal(await shareFileOrDownload(file,{env}),'downloaded');assert.equal(shares,1);
 delete env.navigator.canShare;assert.equal(await shareFileOrDownload(file,{env,preferShare:true}),'downloaded');
});
test('share cancellation and failure propagate without a second download',async()=>{
 const {env,log}=fileEnv(),file=new File(['x'],'x');env.navigator={canShare:()=>true,share:async()=>{throw new DOMException('Cancelled','AbortError');}};
 await assert.rejects(shareFileOrDownload(file,{env,preferShare:true}),{name:'AbortError'});assert.equal(log.length,0);
 env.navigator.share=async()=>{throw Error('share failed');};await assert.rejects(shareFileOrDownload(file,{env,preferShare:true}),/share failed/);assert.equal(log.length,0);
});
