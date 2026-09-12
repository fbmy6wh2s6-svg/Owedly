import { supabase } from '../lib/supabase'

export async function interpretCommand(businessId: string, transcript: string) {
  const clean = transcript.trim()
  if (!clean) throw new Error('Command is empty')

  const { data, error } = await supabase.functions.invoke('ai-command', {
    body: { business_id: businessId, transcript: clean },
  })

  if (error) throw error
  return data
}

export async function confirmAiAction(actionId: string) {
  const { error } = await supabase
    .from('ai_actions')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('status', 'proposed')

  if (error) throw error
}

export async function rejectAiAction(actionId: string) {
  const { error } = await supabase
    .from('ai_actions')
    .update({ status: 'rejected' })
    .eq('id', actionId)
    .eq('status', 'proposed')

  if (error) throw error
}

export async function executeAiAction(actionId: string) {
  const { data, error } = await supabase.functions.invoke('execute-ai-action', {
    body: { action_id: actionId },
  })

  if (error) throw error
  return data
}

export async function transcribeVoice(businessId: string, audio: Blob, prompt?: string) {
  const form = new FormData()
  form.append('audio', audio, 'owedly-command.webm')
  form.append('business_id', businessId)
  if (prompt) form.append('prompt', prompt)

  const { data, error } = await supabase.functions.invoke('transcribe-voice', {
    body: form,
  })

  if (error) throw error
  return data as { transcript: string; transcription_id: string | null }
}
