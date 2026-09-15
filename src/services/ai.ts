import { supabase } from '../lib/supabase'

export type AiCommandSource = 'text' | 'voice'

export async function interpretCommand(businessId: string, transcript: string, source: AiCommandSource = 'text', consent=false) {
  const clean = transcript.trim()
  if (!clean) throw new Error('Command is empty')

  const { data, error } = await supabase.functions.invoke('ai-command', {
    body: { business_id: businessId, transcript: clean, source, ai_consent: consent, request_id: crypto.randomUUID() },
  })

  if (error) throw new Error(error.message)
  return data
}

export async function confirmAiAction(actionId: string) {
  const { error } = await supabase
    .from('ai_actions')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('status', 'proposed')

  if (error) throw new Error(error.message)
}

export async function rejectAiAction(actionId: string) {
  const { error } = await supabase
    .from('ai_actions')
    .update({ status: 'rejected' })
    .eq('id', actionId)
    .eq('status', 'proposed')

  if (error) throw new Error(error.message)
}

export async function executeAiAction(actionId: string) {
  const { data, error } = await supabase.functions.invoke('execute-ai-action', {
    body: { action_id: actionId },
  })

  if (error) throw new Error(error.message)
  return data
}

export async function transcribeVoice(businessId: string, audio: Blob, durationSeconds?: number, prompt?: string, consent=false) {
  const form = new FormData()
  const wav=await toPcmWav(audio)
  form.append('audio', wav, 'owedly-command.wav')
  form.append('ai_consent', String(consent))
  form.append('request_id', crypto.randomUUID())
  form.append('business_id', businessId)
  if (durationSeconds && Number.isFinite(durationSeconds)) form.append('duration_seconds', durationSeconds.toFixed(2))
  if (prompt) form.append('prompt', prompt)

  const { data, error } = await supabase.functions.invoke('transcribe-voice', {
    body: form,
  })

  if (error) throw new Error(error.message)
  return data as { transcript: string; transcription_id: string }
}

// Convert recorder output locally so the server can verify the actual duration.
async function toPcmWav(audio:Blob):Promise<Blob>{
 const context=new AudioContext()
 try{
  const decoded=await context.decodeAudioData(await audio.arrayBuffer())
  if(decoded.duration>61)throw new Error('Record one minute or less.')
  const length=Math.floor(decoded.duration*16000),bytes=new ArrayBuffer(44+length*2),view=new DataView(bytes)
  const text=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i))}
  text(0,'RIFF');view.setUint32(4,36+length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*2,true)
  const samples=decoded.getChannelData(0),ratio=decoded.sampleRate/16000
  for(let i=0;i<length;i++){const position=i*ratio,index=Math.floor(position),fraction=position-index;const value=Math.max(-1,Math.min(1,(samples[index]||0)*(1-fraction)+(samples[Math.min(index+1,samples.length-1)]||0)*fraction));view.setInt16(44+i*2,value<0?value*32768:value*32767,true)}
  return new Blob([bytes],{type:'audio/wav'})
 }finally{await context.close()}
}
