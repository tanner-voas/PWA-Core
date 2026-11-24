/** Browser delivery only: serialization, validation, filenames and confirmation belong to the app. */
export function downloadBlob(blob,filename,{env=globalThis,revokeDelay=60000}={}){
  const url=env.URL.createObjectURL(blob);
  let anchor;
  try{
    anchor=env.document.createElement('a');
    anchor.href=url;
    anchor.download=filename;
    anchor.style.display='none';
    // A connected anchor also works in browsers that ignore detached clicks.
    env.document.body.appendChild(anchor);
    anchor.click();
  }finally{
    try{anchor?.remove();}
    finally{env.setTimeout(()=>env.URL.revokeObjectURL(url),revokeDelay);}
  }
}

export function downloadText(text,filename,{type='application/json',env=globalThis,revokeDelay=60000}={}){
  return downloadBlob(new env.Blob([text],{type}),filename,{env,revokeDelay});
}

/** A rejected/cancelled share is not a successful download. Only fall back when unavailable. */
export async function shareFileOrDownload(file,{preferShare=false,title,env=globalThis,revokeDelay=60000}={}){
  const nav=env.navigator;
  if(preferShare&&typeof nav?.share==='function'&&typeof nav.canShare==='function'&&nav.canShare({files:[file]})){
    await nav.share({files:[file],title});
    return 'shared';
  }
  downloadBlob(file,file.name,{env,revokeDelay});
  return 'downloaded';
}
