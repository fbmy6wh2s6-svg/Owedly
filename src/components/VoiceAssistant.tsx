import { useEffect, useRef, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { confirmAiAction, executeAiAction, interpretCommand, rejectAiAction, transcribeVoice, type AiCommandSource } from '../services/ai'

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
  const parts = [customer, f.job_title, f.change_order_title, f.job_description].filter(Boolean)
  if (f.invoice_number) parts.push(`Invoice ${f.invoice_number}`)
  if (Array.isArray(f.line_items) && f.line_items.length) {
    parts.push(f.line_items.map((x: any) => {
      const tax = Number(x.tax_rate ?? 0)
      return `${x.description} — ${x.quantity} × $${Number(x.unit_price).toFixed(2)}${tax ? ` + ${tax}% tax` : ''}`
    }).join(', '))
  }
  if (f.payment_amount) parts.push(`Payment $${Number(f.payment_amount).toFixed(2)}`)
  if (f.payment_method) parts.push(String(f.payment_method).toUpperCase())
  if (f.scheduled_at_text) parts.push(`Starts ${String(f.scheduled_at_text)}`)
  if (f.scheduled_end_text) parts.push(`Ends ${String(f.scheduled_end_text)}`)
  if (Number.isInteger(f.schedule_impact_days) && f.schedule_impact_days !== 0) parts.push(`${f.schedule_impact_days > 0 ? '+' : ''}${f.schedule_impact_days} day schedule impact`)
  return parts.join(' · ') || 'Owedly is ready to perform this action.'
}

function ResultView({ result }: { result: any }) {
  if (!result) return null
  const payload = result.result ?? result
  if (payload.total_outstanding !== undefined) return <p className="assistant-result">{payload.count} unpaid invoice{payload.count === 1 ? '' : 's'} · ${Number(payload.total_outstanding).toFixed(2)} outstanding</p>
  if (payload.outstanding !== undefined) return <p className="assistant-result">{payload.customers} customers · {payload.active_jobs} active jobs · ${Number(payload.outstanding).toFixed(2)} outstanding</p>
  if (payload.change_order) return <p className="assistant-result">Change order {payload.change_order.change_order_number ?? ''} created for ${Number(payload.change_order.total ?? 0).toFixed(2)}. Customer approval is still required.</p>
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
  const [consent,setConsent]=useState(false)
  const [verifiedPayment,setVerifiedPayment]=useState(false)
  const timeoutRef=useRef<ReturnType<typeof setTimeout>|null>(null)
  const streamRef=useRef<MediaStream|null>(null)
  useEffect(()=>()=>{if(timeoutRef.current)clearTimeout(timeoutRef.current);if(recorderRef.current){recorderRef.current.onstop=null;if(recorderRef.current.state==='recording')recorderRef.current.stop()}streamRef.current?.getTracks().forEach(t=>t.stop())},[])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [action, setAction] = useState<ParsedAction | null>(null)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef<number | null>(null)

  function reset() {
    setAction(null); setResult(null); setError(''); setText('')
  }

  async function parseCommand(command: string, source: AiCommandSource) {
    setBusy(true); setError(''); setResult(null)
    try {
      const parsed = await interpretCommand(business.id, command, source, consent) as ParsedAction
      setAction(parsed); setVerifiedPayment(false)
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
    if (text.trim()) await parseCommand(text.trim(), 'text')
  }

  async function toggleRecording() {
    if(!consent){setError('Please consent to AI processing before recording.');return}
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    setError(''); setAction(null); setResult(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current=stream
      const supported=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t))
      const recorder = new MediaRecorder(stream,supported?{mimeType:supported}:undefined)
      chunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        if(timeoutRef.current)clearTimeout(timeoutRef.current)
        stream.getTracks().forEach((track) => track.stop());streamRef.current=null
        setRecording(false); setBusy(true)
        const startedAt = recordingStartedAtRef.current
        recordingStartedAtRef.current = null
        const durationSeconds = startedAt ? Math.max((Date.now() - startedAt) / 1000, 0.01) : undefined
        try {
          const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const transcribed = await transcribeVoice(business.id, audio, durationSeconds, undefined, consent)
          setText(transcribed.transcript)
          await parseCommand(transcribed.transcript, 'voice')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Voice transcription failed')
          setBusy(false)
        }
      }
      recorderRef.current = recorder
      recorder.start()
      timeoutRef.current=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},60000)
      setRecording(true)
    } catch (err) {
      recordingStartedAtRef.current = null
      streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null
      setError(err instanceof Error ? err.message : 'Microphone access is unavailable')
    }
  }

  async function confirm() {
    if (!action?.action_id||(action.intent==='record_payment'&&!verifiedPayment)) return
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
      <div className="assistant-head"><div><p className="eyebrow">Owedly Office</p><h2>What do you need done?</h2></div><button className="icon-button" onClick={() => !recording && setOpen(false)}>×</button></div>
      <label className="checkbox-label"><input type="checkbox" checked={consent} disabled={busy||recording} onChange={e=>setConsent(e.target.checked)}/>I agree to send this command or recording to OpenAI for processing. Do not include passwords, card details, or unnecessary personal information. AI drafts require my review.</label><p className="quiet">One spoken command uses one voice transcription and one AI request. Maximum recording: 60 seconds. Failed provider attempts count toward the monthly limit.</p>
      <button className={`record-button ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={busy||!consent}><span className="record-orb">●</span>{recording ? 'Tap to stop' : busy ? 'Working…' : 'Tap and speak'}</button>
      <div className="assistant-divider"><span>or type it</span></div>
      <div className="command-box"><textarea maxLength={6000} disabled={busy||recording} value={text} onChange={(e) => setText(e.target.value)} placeholder="Create an invoice for Bob Smith…" /><button className="primary-button compact" onClick={submitText} disabled={busy || recording || !consent || !text.trim()}>Send</button></div>
      {action && !result && <div className="action-preview"><span className="intent-pill">{friendlyIntent(action.intent)}</span><h3>{action.clarification_question || 'Ready to do this?'}</h3><p>{action.clarification_question ? 'Add the missing detail and send the command again.' : describe(action)}</p>{action.requires_confirmation && !action.clarification_question && <div>{action.intent==='record_payment'&&<label className="checkbox-label"><input type="checkbox" checked={verifiedPayment} onChange={e=>setVerifiedPayment(e.target.checked)}/>I have independently verified this money was received.</label>}<div className="preview-actions"><button className="secondary-button" onClick={reject}>Cancel</button><button className="primary-button" onClick={confirm} disabled={busy||(action.intent==='record_payment'&&!verifiedPayment)}>{busy ? 'Working…' : 'Confirm'}</button></div></div>}</div>}
      <ResultView result={result} />
      {error && <p className="form-message error-text">{error}</p>}
      <div className="assistant-hints"><span>“Who hasn’t paid me?”</span><span>“Create a customer named Bob Smith.”</span><span>“Add $475 labor to Smith’s kitchen job as a change order.”</span></div>
    </section></div>}
  </>
}
