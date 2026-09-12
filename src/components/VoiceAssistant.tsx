import { useRef, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { confirmAiAction, executeAiAction, interpretCommand, rejectAiAction, transcribeVoice } from '../services/ai'

type ParsedAction = {
  action_id: string
  intent: string
  confidence?: number
  requires_confirmation?: boolean
  fields?: Record<string, any>
  clarification_question?: string | null
}

function friendlyIntent(intent: string) {
  return intent.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
}

function describe(action: ParsedAction) {
  const f = action.fields ?? {}
  const customer = f.customer_name || f.company_name
  const parts = [customer, f.job_title, f.job_description].filter(Boolean)
  if (Array.isArray(f.line_items) && f.line_items.length) {
    parts.push(f.line_items.map((x: any) => `${x.description} — ${x.quantity} × $${Number(x.unit_price).toFixed(2)}`).join(', '))
  }
  if (f.payment_amount) parts.push(`$${Number(f.payment_amount).toFixed(2)}`)
  if (f.scheduled_at_text) parts.push(String(f.scheduled_at_text))
  return parts.join(' · ') || 'Owedly is ready to perform this action.'
}

function ResultView({ result }: { result: any }) {
  if (!result) return null
  const payload = result.result ?? result
  if (payload.total_outstanding !== undefined) return <p className="assistant-result">{payload.count} unpaid invoice{payload.count === 1 ? '' : 's'} · ${Number(payload.total_outstanding).toFixed(2)} outstanding</p>
  if (payload.outstanding !== undefined) return <p className="assistant-result">{payload.customers} customers · {payload.active_jobs} active jobs · ${Number(payload.outstanding).toFixed(2)} outstanding</p>
  if (payload.invoice) return <p className="assistant-result">Invoice {payload.invoice.invoice_number ?? ''} is ready. Balance: ${Number(payload.invoice.balance_due ?? payload.invoice.total ?? 0).toFixed(2)}</p>
  if (payload.estimate) return <p className="assistant-result">Estimate {payload.estimate.estimate_number ?? ''} created for ${Number(payload.estimate.total ?? 0).toFixed(2)}</p>
  if (payload.job) return <p className="assistant-result">Job “{payload.job.title}” created.</p>
  if (payload.customer) return <p className="assistant-result">Customer saved.</p>
  if (payload.payment) return <p className="assistant-result">Payment of ${Number(payload.payment.amount).toFixed(2)} recorded.</p>
  if (Array.isArray(payload.jobs) || Array.isArray(payload.invoices)) return <p className="assistant-result">Found {payload.jobs?.length ?? 0} jobs and {payload.invoices?.length ?? 0} invoices in this customer’s history.</p>
  return <p className="assistant-result">Done.</p>
}

export default function VoiceAssistant({ business, onChanged }: { business: CurrentBusiness; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [action, setAction] = useState<ParsedAction | null>(null)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  function reset() {
    setAction(null); setResult(null); setError(''); setText('')
  }

  async function parseCommand(command: string) {
    setBusy(true); setError(''); setResult(null)
    try {
      const parsed = await interpretCommand(business.id, command) as ParsedAction
      setAction(parsed)
      setText(command)
      if (parsed.clarification_question) return
      if (!parsed.requires_confirmation && parsed.action_id) {
        const executed = await executeAiAction(parsed.action_id)
        setResult(executed)
        onChanged()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Owedly could not understand that request')
    } finally {
      setBusy(false)
    }
  }

  async function submitText() {
    if (text.trim()) await parseCommand(text.trim())
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    setError(''); setAction(null); setResult(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        setRecording(false); setBusy(true)
        try {
          const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const transcribed = await transcribeVoice(business.id, audio)
          setText(transcribed.transcript)
          await parseCommand(transcribed.transcript)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Voice transcription failed')
          setBusy(false)
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access is unavailable')
    }
  }

  async function confirm() {
    if (!action?.action_id) return
    setBusy(true); setError('')
    try {
      await confirmAiAction(action.action_id)
      const executed = await executeAiAction(action.action_id)
      setResult(executed)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally { setBusy(false) }
  }

  async function reject() {
    if (action?.action_id) await rejectAiAction(action.action_id)
    reset()
  }

  return <>
    <button className="voice-fab" onClick={() => { setOpen(true); reset() }} aria-label="Talk to Owedly"><span className="mic-dot">●</span><span>Talk to Owedly</span></button>
    {open && <div className="assistant-backdrop" onMouseDown={() => !recording && setOpen(false)}><section className="assistant-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="assistant-head"><div><p className="eyebrow">Owedly AI</p><h2>What do you need done?</h2></div><button className="icon-button" onClick={() => !recording && setOpen(false)}>×</button></div>
      <button className={`record-button ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={busy}><span className="record-orb">●</span>{recording ? 'Tap to stop' : busy ? 'Working…' : 'Tap and speak'}</button>
      <div className="assistant-divider"><span>or type it</span></div>
      <div className="command-box"><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Create an invoice for Bob Smith…" /><button className="primary-button compact" onClick={submitText} disabled={busy || !text.trim()}>Send</button></div>
      {action && !result && <div className="action-preview"><span className="intent-pill">{friendlyIntent(action.intent)}</span><h3>{action.clarification_question || 'Ready to do this?'}</h3><p>{action.clarification_question ? 'Add the missing detail and send the command again.' : describe(action)}</p>{action.requires_confirmation && !action.clarification_question && <div className="preview-actions"><button className="secondary-button" onClick={reject}>Cancel</button><button className="primary-button" onClick={confirm} disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button></div>}</div>}
      <ResultView result={result} />
      {error && <p className="form-message error-text">{error}</p>}
      <div className="assistant-hints"><span>“Who hasn’t paid me?”</span><span>“Create a customer named Bob Smith.”</span><span>“Schedule Williams Tuesday at 10.”</span></div>
    </section></div>}
  </>
}
