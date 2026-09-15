import { supabase } from '../lib/supabase'
import { validatePaymentLinks, type PaymentLink } from '../lib/commerce'
export type PlanUsage={plan:'free'|'pro';period_end:string;documents_used:number;documents_limit:number;stored_documents:number;stored_limit:number;customers_used:number;customers_limit:number;ai_used:number;ai_limit:number;voice_used:number;voice_limit:number;email_used:number;email_limit:number;logo_bytes_limit:number}
export type BusinessProfile={id:string;name:string;email:string|null;phone:string|null;address_line1:string|null;city:string|null;state:string|null;postal_code:string|null;timezone:string;currency:string}
export type Workspace={plan:PlanUsage;profile:BusinessProfile;payment_links:PaymentLink[];payment_instructions:string;logo:string|null}
export async function getWorkspace(businessId:string):Promise<Workspace>{
 const [plan,profile,settings,branding]=await Promise.all([
  supabase.rpc('get_plan_usage',{target_business_id:businessId}),
  supabase.from('businesses').select('id,name,email,phone,address_line1,city,state,postal_code,timezone,currency').eq('id',businessId).single(),
  supabase.from('business_settings').select('payment_links,payment_instructions').eq('business_id',businessId).maybeSingle(),
  supabase.from('business_branding').select('logo_data_url').eq('business_id',businessId).maybeSingle(),
 ])
 for(const r of [plan,profile,settings,branding]) if(r.error) throw new Error(r.error.message)
 return {plan:plan.data as PlanUsage,profile:profile.data as BusinessProfile,payment_links:settings.data?.payment_links||[],payment_instructions:settings.data?.payment_instructions||'',logo:plan.data.plan==='pro'?branding.data?.logo_data_url||null:null}
}
export async function savePaymentSettings(businessId:string,links:PaymentLink[],instructions:string){
 const valid=validatePaymentLinks(links)
 if(instructions.length>2000) throw new Error('Payment instructions must be 2,000 characters or less.')
 const {error}=await supabase.from('business_settings').upsert({business_id:businessId,payment_links:valid,payment_instructions:instructions.trim(),updated_at:new Date().toISOString()})
 if(error) throw new Error(error.message)
}
export async function saveProfile(businessId:string,profile:BusinessProfile){
 if(!profile.name.trim()) throw new Error('Enter your business name.')
 if(profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new Error('Enter a valid business email.')
 const {error}=await supabase.from('businesses').update({name:profile.name.trim(),email:profile.email||null,phone:profile.phone||null,address_line1:profile.address_line1||null,city:profile.city||null,state:profile.state||null,postal_code:profile.postal_code||null}).eq('id',businessId)
 if(error) throw new Error(error.message)
}
export async function prepareLogo(file:File):Promise<string>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024) throw new Error('Choose a PNG, JPG, or WebP image under 5 MB. SVG and animated files are not accepted.')
 const url=URL.createObjectURL(file)
 try {
  const image=new Image();image.src=url;await image.decode()
  if(image.naturalWidth*image.naturalHeight>16000000) throw new Error('Choose an image below 16 megapixels.')
  let size=512
  while(size>=64){
   const scale=Math.min(1,size/image.naturalWidth,size/image.naturalHeight)
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale))
   const context=canvas.getContext('2d');if(!context) throw new Error('Image processing is unavailable in this browser.')
   context.drawImage(image,0,0,canvas.width,canvas.height)
   const data=canvas.toDataURL('image/png')
   if(data.length<=174800) return data
   size=Math.floor(size*.75)
  }
  throw new Error('This image is too complex. Choose a simpler logo.')
 }finally{URL.revokeObjectURL(url)}
}
export async function saveLogo(businessId:string,data:string|null){
 const r=data?await supabase.from('business_branding').upsert({business_id:businessId,logo_data_url:data,updated_at:new Date().toISOString()}):await supabase.from('business_branding').delete().eq('business_id',businessId)
 if(r.error) throw new Error(r.error.message)
}
