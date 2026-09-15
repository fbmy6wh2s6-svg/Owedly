import {wavDuration} from '../_shared/wav.ts'
import {authenticate,requirePro,reserve,adminClient,preflight,response,failure,AccessError} from '../_shared/access.ts'
Deno.serve(async(req:Request)=>{
 const early=preflight(req);if(early)return early
 try{
  const {db,user}=await authenticate(req)
  if(Number(req.headers.get('Content-Length')||0)>2*1024*1024+16384)throw new AccessError('Recording is too large. Maximum 2 MB.',413)
  const form=await req.formData(),audio=form.get('audio'),businessId=String(form.get('business_id')||'')
  const plan=await requirePro(db,businessId)
  if(plan.ai_limit!==undefined&&plan.ai_used>=plan.ai_limit)throw new AccessError('No AI commands remain this month. Use the manual forms; transcription has not been started.',429)
  if(form.get('ai_consent')!=='true')throw new AccessError('Consent to third-party voice processing is required.',400)
  if(!(audio instanceof File)||audio.size<128||audio.size>2*1024*1024)throw new AccessError('Use a recording between 128 bytes and 2 MB.',400)
  const mime=audio.type.split(';')[0].toLowerCase()
  if(mime!=='audio/wav')throw new AccessError('Unsupported audio format.',415)
  let duration:number
  try{duration=wavDuration(new Uint8Array(await audio.arrayBuffer()))}catch(e){throw new AccessError(e instanceof Error?e.message:'Invalid audio.',400)}
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)throw new AccessError('Voice processing is not configured.',503)
  await reserve(businessId,user.id,'voice',String(form.get('request_id')||''))
  const payload=new FormData();payload.append('file',audio,audio.name);payload.append('model','gpt-4o-mini-transcribe');payload.append('response_format','json')
  const provider=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:payload,signal:AbortSignal.timeout(30000)})
  if(!provider.ok)throw new AccessError('Voice processing failed. This attempt counts toward your limit.',502)
  const result=await provider.json(),transcript=String(result.text||'').trim()
  if(!transcript||transcript.length>6000)throw new AccessError('No usable transcript was returned.',502)
  const {data,error}=await adminClient().from('voice_transcriptions').insert({business_id:businessId,user_id:user.id,provider:'openai',model:'gpt-4o-mini-transcribe',transcript,duration_seconds:duration}).select('id').single()
  if(error)throw new AccessError('The transcript could not be saved.',500)
  return response(req,200,{transcript,transcription_id:data.id})
 }catch(e){return failure(req,e)}
})
