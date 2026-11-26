// Private service; browser-facing gateways forward the original same-origin request.
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export const MONTHLY_LIMIT=500000;
// Pacific calendar month matches the quota reset timezone. Count Unicode code points.
export const billingMonth=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'}).format(date);
export function validTranslation(body){return body&&typeof body.text==='string'&&body.text.trim()&&[...body.text].length<=5000&&body.source==='zh-CN'&&body.target==='en';}
export class TranslationBudget {
 constructor(ctx){this.ctx=ctx;}
 async fetch(request){
  const {count}=await request.json();if(!Number.isInteger(count)||count<1||count>5000)return json({error:'Invalid character count'},400);
  const month=billingMonth();
  const accepted=await this.ctx.storage.transaction(async tx=>{
   const old=await tx.get('usage');const used=old?.month===month?old.used:0;
   if(used+count>MONTHLY_LIMIT)return false;
   await tx.put('usage',{month,used:used+count});return true;
  });
  return json({accepted},accepted?200:429);
 }
}
// Only fixed codes, numeric statuses and timings are logged. Never log text,
// cookies, provider response bodies, keys, or user identifiers.
export function createTranslationWorker(fetchGoogle=globalThis.fetch,log=event=>console.log(JSON.stringify(event))){return {async fetch(request,env,ctx){
 const requestId=crypto.randomUUID(),started=Date.now();let stage='request',characters=0;
 const result=(body,status=200,upstreamStatus)=>{
  const event={kind:'translation',requestId,stage,code:body.code||'OK',status,durationMs:Date.now()-started,characters,...(Number.isInteger(upstreamStatus)?{upstreamStatus}:{})};
  try{log(event);}catch{}
  // Only actual Google attempts after a successful budget reservation count.
  // This does not alter the quota reservation or the translation response.
  if(stage==='google'&&ctx?.waitUntil)try{const sample={id:requestId,operation:'request',outcome:status===200?'success':'error',status:upstreamStatus||status,characters,durationMs:event.durationMs};ctx.waitUntil(Promise.resolve().then(()=>env.PROFILES.translationUsage(new URL(request.url).origin,request.headers.get('Cookie')||'',sample)).catch(()=>{}));}catch{}
  return json({...body,requestId,...(Number.isInteger(upstreamStatus)?{upstreamStatus}:{})},status);
 };
 const fail=(code,error,status,upstreamStatus)=>result({code,error},status,upstreamStatus);
 try{
  const url=new URL(request.url);
  if(url.pathname!=='/_translation/translate'||request.method!=='POST')return fail('ROUTE','Translation route not found',404);
  if(!String(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).includes(url.origin)||request.headers.get('X-PWA-CSRF')!=='1'||(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return fail('ORIGIN','Invalid translation request origin',403);
  stage='configuration';
  if(!env.PROFILES)return fail('PROFILE_BINDING','Profile service binding missing in pwa-core-api',503);
  if(!env.TRANSLATION_BUDGET)return fail('BUDGET_BINDING','Translation budget binding missing in pwa-core-api',503);
  if(!env.GOOGLE_TRANSLATE_API_KEY)return fail('API_KEY_MISSING','Google Translation API key missing in pwa-core-api',503);
  stage='authentication';
  const auth=await env.PROFILES.fetch(new Request(new URL('/_profiles/v1/status',url),{headers:{Cookie:request.headers.get('Cookie')||''}}));
  if(!auth.ok)return fail('PROFILE_HTTP','Google Drive session verification service failed',502,auth.status);
  let profile;try{profile=await auth.json();}catch{return fail('PROFILE_RESPONSE','Invalid Google Drive verification response',502);}
  if(profile?.connected===false)return fail('DISCONNECTED','Connect Google Drive to translate',401);
  if(profile?.connected!==true)return fail('PROFILE_RESPONSE','Invalid Google Drive verification response',502);
  stage='request';
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return fail('CONTENT_TYPE','Expected JSON',415);
  const raw=await request.text();if(raw.length>32000)return fail('LENGTH','Paragraph too long',413);
  let body;try{body=JSON.parse(raw);}catch{return fail('INVALID_JSON','Invalid JSON',400);}
  if(!validTranslation(body))return fail('INVALID_INPUT','Expected a Chinese paragraph of at most 5,000 characters',400);
  characters=[...body.text].length;stage='budget';
  const budget=env.TRANSLATION_BUDGET.get(env.TRANSLATION_BUDGET.idFromName('global'));
  const reservation=await budget.fetch('https://internal/reserve',{method:'POST',body:JSON.stringify({count:characters})});
  if(reservation.status===429)return fail('MONTHLY_LIMIT','Monthly translation allowance exhausted',429);
  if(!reservation.ok)return fail('BUDGET_HTTP','Translation quota unavailable',503,reservation.status);
  // Reserve before calling Google. Never automatically retry/refund uncertain requests.
  stage='google';
  const response=await fetchGoogle('https://translation.googleapis.com/language/translate/v2',{method:'POST',headers:{'X-Goog-Api-Key':env.GOOGLE_TRANSLATE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({q:body.text,source:body.source,target:body.target,format:'text'}),signal:AbortSignal.timeout(20000)});
  if(!response.ok){
   // Do not expose provider bodies: they can contain project identifiers or input.
   const message=response.status===400?'Google rejected the translation request; check API key and request settings':response.status===401||response.status===403?'Google denied translation; check the API key, enabled API and billing':response.status===429?'Google translation quota or rate limit reached':'Google Translation is temporarily unavailable';
   return fail('GOOGLE_HTTP',message,502,response.status);
  }
  let translated;try{translated=(await response.json())?.data?.translations?.[0]?.translatedText;}catch{}
  if(typeof translated!=='string')return fail('GOOGLE_RESPONSE','Invalid translation response',502);
  return result({text:translated,provider:'google'});
 }catch(e){return fail(stage==='authentication'?'PROFILE_UNAVAILABLE':stage==='budget'?'BUDGET_UNAVAILABLE':stage==='google'?'GOOGLE_UNAVAILABLE':'SERVICE_UNAVAILABLE',stage==='authentication'?'Google Drive verification unavailable':stage==='budget'?'Translation quota service unavailable':stage==='google'?'Google Translation request failed or timed out':'Translation service unavailable',502);}
}};}
export default createTranslationWorker();
