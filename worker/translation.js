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
export function createTranslationWorker(fetchGoogle=globalThis.fetch){return {async fetch(request,env){
 try{
  const url=new URL(request.url);
  if(url.pathname!=='/_translation/translate'||request.method!=='POST')return json({error:'Not found'},404);
  if(!String(env.ALLOWED_ORIGINS||'').split(',').includes(url.origin)||request.headers.get('X-PWA-CSRF')!=='1'||(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Invalid request origin'},403);
  if(!env.PROFILES||!env.TRANSLATION_BUDGET||!env.GOOGLE_TRANSLATE_API_KEY)return json({error:'Translation service not configured'},503);
  const auth=await env.PROFILES.fetch(new Request(new URL('/_profiles/status',url),{headers:{Cookie:request.headers.get('Cookie')||''}}));
  if(!auth.ok||!(await auth.json()).connected)return json({error:'Connect Google Drive to translate'},401);
  // Avoid passing the original paragraph or secret to the profile Worker.
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Expected JSON'},415);
  const raw=await request.text();if(raw.length>32000)return json({error:'Paragraph too long'},413);
  let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON'},400);}
  if(!validTranslation(body))return json({error:'Expected a Chinese paragraph of at most 5,000 characters'},400);
  const budget=env.TRANSLATION_BUDGET.get(env.TRANSLATION_BUDGET.idFromName('global'));
  const reservation=await budget.fetch('https://internal/reserve',{method:'POST',body:JSON.stringify({count:[...body.text].length})});
  if(reservation.status===429)return json({error:'Monthly translation allowance exhausted'},429);
  if(!reservation.ok)return json({error:'Translation quota unavailable'},503);
  // Reserve before calling Google. Never automatically retry/refund uncertain requests.
  const response=await fetchGoogle('https://translation.googleapis.com/language/translate/v2',{method:'POST',headers:{'X-Goog-Api-Key':env.GOOGLE_TRANSLATE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({q:body.text,source:body.source,target:body.target,format:'text'}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)return json({error:'Google Translation is temporarily unavailable'},502);
  const translated=(await response.json())?.data?.translations?.[0]?.translatedText;
  if(typeof translated!=='string')return json({error:'Invalid translation response'},502);
  return json({text:translated,provider:'google'});
 }catch{return json({error:'Translation service unavailable'},502);}
}};}
export default createTranslationWorker();
