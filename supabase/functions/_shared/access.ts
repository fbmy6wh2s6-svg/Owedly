import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const allowed=new Set(['https://app.owedlyworks.com','https://owedlyworks.com','http://localhost:5173','http://localhost:4173','http://localhost','capacitor://localhost'])
const configured=Deno.env.get('APP_BASE_URL');if(configured){try{allowed.add(new URL(configured).origin)}catch{}}
export function headers(req:Request){const origin=req.headers.get('Origin')||'';return {'Content-Type':'application/json','Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://app.owedlyworks.com','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'}}
export function response(req:Request,status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:headers(req)})}
export function preflight(req:Request){const origin=req.headers.get('Origin');if(origin&&!allowed.has(origin))return response(req,403,{error:'This app address is not authorized.'});if(req.method==='OPTIONS')return new Response('ok',{headers:headers(req)});if(req.method!=='POST')return response(req,405,{error:'Method not allowed'});return null}
export class AccessError extends Error{constructor(message:string,public status:number){super(message)}}
export async function authenticate(req:Request){
 const authorization=req.headers.get('Authorization')||''
 if(!authorization.startsWith('Bearer '))throw new AccessError('Sign in to continue.',401)
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY')
 if(!url||!key)throw new AccessError('The service is not configured.',503)
 const db=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
 const {data,error}=await db.auth.getUser()
 if(error||!data.user)throw new AccessError('Your session expired. Sign in again.',401)
 return {db,user:data.user}
}
export async function requirePro(db:ReturnType<typeof createClient>,businessId:string){
 if(!uuid.test(businessId))throw new AccessError('Invalid business identifier.',400)
 const {data,error}=await db.rpc('get_plan_usage',{target_business_id:businessId})
 if(error)throw new AccessError('You do not have access to this business.',403)
 if(data?.plan!=='pro')throw new AccessError('This feature requires Pro. Free Basic never uses AI, transcription, or in-app email.',403)
 return data
}
export function adminClient(){const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)throw new AccessError('Usage controls are not configured. Nothing was sent.',503);return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
export async function reserve(businessId:string,userId:string,feature:'ai'|'voice'|'email',requestId:string){
 if(!uuid.test(requestId))throw new AccessError('A valid request ID is required.',400)
 const {data,error}=await adminClient().rpc('reserve_feature',{target_business_id:businessId,target_user_id:userId,feature,request_id:requestId})
 if(error)throw new AccessError(error.message,error.code==='42501'?403:error.code==='23505'?409:429)
 return data
}
export function failure(req:Request,error:unknown){return response(req,error instanceof AccessError?error.status:500,{error:error instanceof AccessError?error.message:'Unable to complete the request. No success has been confirmed.'})}
