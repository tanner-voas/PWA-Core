/** Narrow optional launcher contract. The host owns navigation; apps own saving. */
export function hasLauncherHost(env=globalThis){
  return typeof env.__APP_LAUNCHER__?.returnToLauncher==='function';
}

export function returnToLauncher(env=globalThis){
  const host=env.__APP_LAUNCHER__;
  if(typeof host?.returnToLauncher!=='function')throw new Error('This installation has no launcher.');
  return host.returnToLauncher();
}

/** Lazy local fallback; do not retry locally when the host update itself fails. */
export function runHostedOrLocalUpdate(button,options,localUpdate,env=globalThis){
  const host=env.__APP_LAUNCHER__;
  if(typeof host?.runUpdateButton==='function')return host.runUpdateButton(button,options);
  return localUpdate(button,options);
}

/** Best effort registration for standalone entry points only; never delays boot. */
export function registerStandaloneWorker({env=globalThis,onError=()=>{}}={}){
  const worker=env.navigator?.serviceWorker;
  if(typeof worker?.register!=='function'||!env.location?.protocol?.startsWith('http'))return;
  try{
    return Promise.resolve(worker.register('./sw.js',{updateViaCache:'none'})).catch(onError);
  }catch(error){onError(error);}
}
