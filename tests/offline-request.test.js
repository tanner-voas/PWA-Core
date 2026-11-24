import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineRequest} from '../src/offline-request.js';

test('offline requests use the controlling worker and return progress independently',async()=>{
 const calls=[];const progress=[];
 const service={ready:Promise.resolve({active:{postMessage(){assert.fail('wrong worker')}}}),controller:{postMessage(data,[port]){calls.push(data);port.postMessage({progress:1,total:2});port.postMessage({ok:true,groups:[{group:'reader:original',complete:true}]});port.close();}}};
 const groups=await offlineRequest('download','reader:original',(done,total)=>progress.push([done,total]),service);
 assert.deepEqual(calls,[{type:'offline-pack',action:'download',group:'reader:original'}]);
 assert.deepEqual(progress,[[1,2]]);assert.deepEqual(groups,[{group:'reader:original',complete:true}]);
});
test('worker failure rejects without claiming a successful download',async()=>{
 const service={ready:Promise.resolve({active:{postMessage(data,[port]){port.postMessage({ok:false,error:'quota'});port.close();}}})};
 await assert.rejects(offlineRequest('download','app:example',()=>{},service),/quota/);
 await assert.rejects(offlineRequest('status',undefined,()=>{},{}),/not ready/);
});
