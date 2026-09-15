import {sendMail} from '../_shared/mail.ts'
type Handler=(req:Request)=>Promise<Response>
const handlers:Record<string,Handler>={}
const serve=Deno.serve
Deno.env.set('SUPABASE_URL','https://example.supabase.co');Deno.env.set('SUPABASE_ANON_KEY','test-key');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-service-key');Deno.env.set('OPENAI_API_KEY','test-openai-key')
for(const name of ['ai-command','transcribe-voice','execute-ai-action']){
 Deno.serve=((fn:Handler)=>{handlers[name]=fn;return {}}) as typeof Deno.serve
 await import(`../${name}/index.ts`)
}
Deno.serve=serve
const b='11111111-1111-4111-8111-111111111111',u='33333333-3333-4333-8333-333333333333',rid='55555555-5555-4555-8555-555555555555'
function assert(c:unknown,msg:string):asserts c{if(!c)throw new Error(msg)}
function req(body:any,auth=true){return new Request('https://example.supabase.co/functions/v1/test',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test'}:{})},body:JSON.stringify(body)})}
async function mock(pro:boolean,run:(calls:string[])=>Promise<void>,quota=false){const old=globalThis.fetch,calls:string[]=[];globalThis.fetch=async(input,init)=>{const request=new Request(input,init),url=new URL(request.url);calls.push(url.href);const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});if(url.host!=='example.supabase.co')throw new Error('Unexpected provider call in blocked-request test');if(url.pathname.endsWith('/user'))return json({id:u});if(url.pathname.endsWith('/get_plan_usage'))return json({plan:pro?'pro':'free'});if(url.pathname.endsWith('/business_members'))return json({role:'owner'});if(url.pathname.endsWith('/businesses'))return json({timezone:'America/New_York'});if(url.pathname.endsWith('/reserve_feature'))return quota?json({code:'P0001',message:'Quota reached'},400):json(true);throw new Error('Unexpected request '+url)};try{await run(calls)}finally{globalThis.fetch=old}}
Deno.test('free account cannot invoke AI even by calling the endpoint directly',()=>mock(false,async calls=>{const r=await handlers['ai-command'](req({business_id:b,transcript:'Create an invoice',request_id:rid,ai_consent:true}));assert(r.status===403,'Free denied');assert(!calls.some(c=>c.includes('openai.com')),'No provider call')}))
Deno.test('AI endpoint requires consent before provider processing',()=>mock(true,async calls=>{const r=await handlers['ai-command'](req({business_id:b,transcript:'Create an invoice',request_id:rid,ai_consent:false}));assert(r.status===400,'Consent required');assert(!calls.some(c=>c.includes('openai.com')),'No provider call')}))
Deno.test('AI quota exhaustion blocks provider calls',()=>mock(true,async calls=>{const r=await handlers['ai-command'](req({business_id:b,transcript:'Create an invoice',request_id:rid,ai_consent:true}));assert(r.status===429,'Quota rejected');assert(!calls.some(c=>c.includes('openai.com')),'No provider call')},true))
Deno.test('unauthenticated requests cannot execute AI actions',()=>mock(true,async()=>{const r=await handlers['execute-ai-action'](req({action_id:rid},false));assert(r.status===401,'Authentication required')}))
Deno.test('free account cannot upload voice for paid transcription',()=>mock(false,async calls=>{const form=new FormData();form.set('business_id',b);form.set('request_id',rid);form.set('ai_consent','true');form.set('audio',new Blob(['not audio'],{type:'audio/wav'}),'voice.wav');const r=await handlers['transcribe-voice'](new Request('https://example.supabase.co/functions/v1/transcribe-voice',{method:'POST',headers:{Authorization:'Bearer test'},body:form}));assert(r.status===403,'Free denied');assert(!calls.some(c=>c.includes('openai.com')),'No provider call')}))
