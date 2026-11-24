// MessageChannel keeps offline pack responses separate from update and profile traffic.
export async function offlineRequest(action,group,onProgress=()=>{},service=globalThis.navigator?.serviceWorker){
 if(!service)throw Error('Offline downloads require service worker support.');
 let timer;
 const registration=await Promise.race([service.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Offline support is not ready. Reload while online.')),20000);})]).finally(()=>clearTimeout(timer));
 const worker=service.controller||registration?.active;
 if(!worker)throw Error('Offline support is not ready.');
 const channel=new MessageChannel();
 return new Promise((resolve,reject)=>{
  let timeout;
  const finish=(error,value)=>{clearTimeout(timeout);channel.port1.close();error?reject(error):resolve(value);};
  const arm=()=>{clearTimeout(timeout);timeout=setTimeout(()=>finish(Error('Offline operation timed out. Try again.')),action==='status'?5000:60000);};
  arm();channel.port1.onmessage=({data})=>{if(data.progress!==undefined){arm();onProgress(data.progress,data.total);return;}data.ok?finish(null,data.groups):finish(Error(data.error||'Offline operation failed'));};
  try{worker.postMessage({type:'offline-pack',action,group},[channel.port2]);}catch(error){finish(error);}
 });
}
