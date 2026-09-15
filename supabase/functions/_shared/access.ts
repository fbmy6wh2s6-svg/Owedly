import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export class AccessError extends Error{constructor(message:string,public status=403){super(message)}}
export function cors(req:Request){
 const allowed=new Set(['https://app.owedlyworks.com','https://owedlyworks.com','http://localhost:5173','http://localhost','capacitor://localhost']);const configured=Deno.env.get('APP_BASE_URL');if(configured){try{allowed.add(new URL(configured).origin)}catch{}}
 const origin=req.headers.get('Origin')||''
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://app.owedlyworks.com','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'}
 return {headers,allowed:!origin||allowed.has(origin)}
}
export function reply(req:Request,status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:cors(req).headers})}
export async function authenticate(req:Request){
 const authorization=req.headers.get('Authorization')||''
 if(!authorization.startsWith('Bearer '))throw new AccessError('Sign in to continue.',401)
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY')
 if(!url||!key)throw new AccessError('Service is not configured.',503)
 const db=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
 const {data,error}=await db.auth.getUser();if(error||!data.user)throw new AccessError('Your session expired. Sign in again.',401)
 return {db,user:data.user,url}
}
// Extract the concrete client from our factory, not from generic createClient.
// The latter loses the schema parameters under current TypeScript/Deno checks.
export async function requirePro(db:Awaited<ReturnType<typeof authenticate>>['db'],businessId:string){
 const {data,error}=await db.rpc('get_plan_usage',{target_business_id:businessId})
 if(error)throw new AccessError('Unable to verify your plan or workspace access.',403)
 if(data?.plan!=='pro')throw new AccessError('This feature requires Pro. Free Basic never uses AI, transcription, or in-app email.',403)
 return data
}
export function admin(){const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)throw new AccessError('Server usage protection is not configured.',503);return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
export async function reserve(businessId:string,userId:string,feature:'ai'|'voice'|'email',requestId:string){const {error}=await admin().rpc('reserve_feature',{target_business_id:businessId,target_user_id:userId,feature,request_id:requestId});if(error)throw new AccessError(error.message,429)}
export function errorReply(req:Request,error:unknown){if(error instanceof AccessError)return reply(req,error.status,{error:error.message});return reply(req,500,{error:'Unable to complete this request. Reload the result before starting a new request.'})}
export async function jsonBody(req:Request,maxBytes=24000){const text=await req.text();if(new TextEncoder().encode(text).length>maxBytes)throw new AccessError('Request is too large.',413);let value;try{value=JSON.parse(text)}catch{throw new AccessError('Invalid JSON request.',400)}if(!value||typeof value!=='object'||Array.isArray(value))throw new AccessError('Invalid request.',400);return value as Record<string,unknown>}
