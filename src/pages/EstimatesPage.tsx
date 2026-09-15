import { FormEvent, useEffect, useMemo, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { convertEstimateToInvoice, createEstimate, listEstimates, updateEstimateStatus } from '../services/estimates'
import { createApprovalLink } from '../services/approvals'
import { sendDocumentEmail } from '../services/communications'
import ApprovalLinkDialog from '../components/ApprovalLinkDialog'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Estimate = { id: string; estimate_number: string | null; status: string; issue_date: string; expires_on: string | null; subtotal: number; tax_amount: number; total: number; customers: Customer[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }
type ApprovalLinkState = { url: string; title: string; expiresAt: string }

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })

export default function EstimatesPage({ business }: { business: CurrentBusiness }) {
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(false)
  const [convertTarget, setConvertTarget] = useState<Estimate | null>(null)
  const [convertDueDate, setConvertDueDate] = useState('')
  const [approvalLink, setApprovalLink] = useState<ApprovalLinkState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine()])

  async function refresh() {
    const [estimateRows, customerRows] = await Promise.all([listEstimates(business.id), listCustomers(business.id)])
    setEstimates(estimateRows as Estimate[])
    setCustomers(customerRows as Customer[])
  }

  useEffect(() => { refresh().catch(err=>setError(err instanceof Error?err.message:'Unable to load data. Please retry.')) }, [business.id])

  const previewTotal = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity || 0)
    const price = Number(line.unit_price || 0)
    const tax = Number(line.tax_rate || 0)
    const base = Number.isFinite(quantity * price) ? quantity * price : 0
    return sum + base + (base * tax / 100)
  }, 0), [lines])

  function customerName(customer?: Customer) {
    if (!customer) return 'Customer'
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
  }

  function resetForm() {
    setCustomerId(''); setExpiresOn(''); setNotes(''); setLines([blankLine()]); setError(''); setNotice('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      await createEstimate(business.id, {
        customer_id: customerId,
        expires_on: expiresOn || undefined,
        notes,
        items: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          tax_rate: Number(line.tax_rate || 0),
        })),
      })
      resetForm(); setShowForm(false); await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create estimate')
    } finally { setBusy(false) }
  }

  async function changeStatus(id: string, status: Estimate['status']) {
    setError(''); setNotice('')
    await updateEstimateStatus(id, status as 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted')
    await refresh()
  }

  async function shareForApproval(estimate: Estimate) {
    setBusy(true); setError(''); setNotice('')
    try {
      const link = await createApprovalLink(business.id, 'estimate', estimate.id)
      setApprovalLink({ url: link.url, title: `${estimate.estimate_number || 'Estimate'} approval link`, expiresAt: link.expires_at })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create approval link')
    } finally { setBusy(false) }
  }

  async function emailForApproval(estimate: Estimate) {
    setBusy(true); setError(''); setNotice('')
    try {
      const sent = await sendDocumentEmail(business.id, 'estimate', estimate.id)
      setNotice(`Estimate sent to ${sent.recipient}.`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to email estimate')
    } finally { setBusy(false) }
  }

  async function convert(event: FormEvent) {
    event.preventDefault()
    if (!convertTarget) return
    setBusy(true); setError(''); setNotice('')
    try {
      await convertEstimateToInvoice(convertTarget.id, convertDueDate || undefined)
      setConvertTarget(null); setConvertDueDate('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to convert estimate')
    } finally { setBusy(false) }
  }

  return <div className="page-stack">{error&&!showForm&&<p className="banner error-text" role="alert">{error}</p>}
    <div className="page-heading split-heading"><div><p className="eyebrow">Estimates</p><h1>Quote the work without the paperwork.</h1></div>{canWrite(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New estimate</button>}</div>
    {notice && <p className="form-message success-text">{notice}</p>}
    {error && !showForm && !convertTarget && <p className="form-message error-text">{error}</p>}
    <section className="list-card">
      {estimates.length === 0 ? <div className="empty-state"><div className="empty-icon">E</div><h2>No estimates yet</h2><p>Create one here or tell Owedly what you want to quote.</p></div> : estimates.map((estimate) => {
        const customer = estimate.customers?.[0]
        const terminal = ['accepted', 'declined', 'converted'].includes(estimate.status)
        return <article className="document-row" key={estimate.id}>
          <div className="row-main"><strong>{estimate.estimate_number || 'Draft estimate'}</strong><span>{customerName(customer)} · {new Date(estimate.issue_date).toLocaleDateString()}</span></div>
          <strong className="money">${Number(estimate.total).toFixed(2)}</strong>
          <div className="document-actions">
            {terminal ? <span className={`status-chip ${estimate.status === 'accepted' ? 'paid' : ''}`}>{estimate.status}</span> : <select value={estimate.status} disabled={!canWrite(business.role)} onChange={(e) => changeStatus(estimate.id, e.target.value)}><option value="draft">Draft</option><option value="sent">Sent</option><option value="expired">Expired</option></select>}
            {canWrite(business.role) && !['converted','expired','accepted'].includes(estimate.status) && <button className="primary-button compact" disabled={busy} onClick={() => emailForApproval(estimate)}>Email customer</button>}
            {canWrite(business.role) && !['converted','expired','accepted'].includes(estimate.status) && <button className="secondary-button compact" disabled={busy} onClick={() => shareForApproval(estimate)}>Copy approval link</button>}
            {canWrite(business.role) && estimate.status === 'accepted' && <button className="conversion-button" onClick={() => { setError(''); setNotice(''); setConvertTarget(estimate) }}>Create invoice</button>}
          </div>
        </article>
      })}
    </section>
    {showForm && <div className="modal-backdrop" onMouseDown={() => { setShowForm(false); resetForm() }}><section className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">New estimate</p><h2>Create an estimate</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }}>×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid"><label className="full">Customer<select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required><option value="">Choose customer…</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customerName(customer)}</option>)}</select></label><label>Expires on<input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></label><label>Internal notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
        <div className="line-items"><div className="line-items-head"><strong>Line items</strong><button type="button" className="text-button" onClick={() => setLines([...lines, blankLine()])}>+ Add line</button></div>{lines.map((line, index) => <div className="line-item" key={index}><input placeholder="Description" value={line.description} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} required /><input type="number" min="0.01" step="0.01" placeholder="Qty" value={line.quantity} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} required /><input type="number" min="0" step="0.01" placeholder="Unit price" value={line.unit_price} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} required /><input type="number" min="0" max="100" step="0.01" placeholder="Tax %" value={line.tax_rate} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} /><button type="button" className="remove-line" onClick={() => setLines(lines.length === 1 ? [blankLine()] : lines.filter((_, i) => i !== index))}>×</button></div>)}</div>
        <div className="estimate-total"><span>Preview total</span><strong>${previewTotal.toFixed(2)}</strong><small>Final totals are calculated by Owedly when saved.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Create estimate'}</button></div>
      </form>
    </section></div>}
    {convertTarget && <div className="modal-backdrop" onMouseDown={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}><section className="modal conversion-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Accepted estimate</p><h2>Create the invoice</h2></div><button className="icon-button" onClick={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}>×</button></div>
      <div className="conversion-summary"><span>{convertTarget.estimate_number || 'Estimate'}</span><strong>${Number(convertTarget.total).toFixed(2)}</strong><p>{customerName(convertTarget.customers?.[0])}</p></div>
      <form onSubmit={convert} className="conversion-form"><label>Invoice due date<input type="date" value={convertDueDate} onChange={(e) => setConvertDueDate(e.target.value)} /></label><p className="quiet">Owedly will copy every line item and tax rate into a new draft invoice. The database recalculates the final invoice total.</p>{error && <p className="form-message error-text">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setConvertTarget(null); setConvertDueDate(''); setError('') }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</button></div></form>
    </section></div>}
    {approvalLink && <ApprovalLinkDialog url={approvalLink.url} title={approvalLink.title} expiresAt={approvalLink.expiresAt} onClose={() => setApprovalLink(null)} />}
  </div>
}
