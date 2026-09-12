import { FormEvent, useEffect, useMemo, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { listCustomers } from '../services/customers'
import { createEstimate, listEstimates, updateEstimateStatus } from '../services/estimates'

type Customer = { id: string; first_name: string | null; last_name: string | null; company: string | null }
type Estimate = { id: string; estimate_number: string | null; status: string; issue_date: string; expires_on: string | null; subtotal: number; tax_amount: number; total: number; customers: Customer[] | null }
type Line = { description: string; quantity: string; unit_price: string; tax_rate: string }

const blankLine = (): Line => ({ description: '', quantity: '1', unit_price: '', tax_rate: '0' })

export default function EstimatesPage({ business }: { business: CurrentBusiness }) {
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blankLine()])

  async function refresh() {
    const [estimateRows, customerRows] = await Promise.all([listEstimates(business.id), listCustomers(business.id)])
    setEstimates(estimateRows as Estimate[])
    setCustomers(customerRows as Customer[])
  }

  useEffect(() => { refresh() }, [business.id])

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
    setCustomerId(''); setExpiresOn(''); setNotes(''); setLines([blankLine()]); setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
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
    await updateEstimateStatus(id, status as 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted')
    await refresh()
  }

  return <div className="page-stack">
    <div className="page-heading split-heading"><div><p className="eyebrow">Estimates</p><h1>Quote the work without the paperwork.</h1></div>{canWrite(business.role) && <button className="primary-button compact" onClick={() => setShowForm(true)}>+ New estimate</button>}</div>
    <section className="list-card">
      {estimates.length === 0 ? <div className="empty-state"><div className="empty-icon">E</div><h2>No estimates yet</h2><p>Create one here or tell Owedly what you want to quote.</p></div> : estimates.map((estimate) => {
        const customer = estimate.customers?.[0]
        return <article className="document-row" key={estimate.id}>
          <div className="row-main"><strong>{estimate.estimate_number || 'Draft estimate'}</strong><span>{customerName(customer)} · {new Date(estimate.issue_date).toLocaleDateString()}</span></div>
          <strong className="money">${Number(estimate.total).toFixed(2)}</strong>
          <select value={estimate.status} disabled={!canWrite(business.role)} onChange={(e) => changeStatus(estimate.id, e.target.value)}><option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="declined">Declined</option><option value="expired">Expired</option><option value="converted">Converted</option></select>
        </article>
      })}
    </section>
    {showForm && <div className="modal-backdrop" onMouseDown={() => { setShowForm(false); resetForm() }}><section className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">New estimate</p><h2>Create an estimate</h2></div><button className="icon-button" onClick={() => { setShowForm(false); resetForm() }}>×</button></div>
      <form onSubmit={submit} className="estimate-form">
        <div className="form-grid"><label className="full">Customer<select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required><option value="">Choose customer…</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customerName(customer)}</option>)}</select></label><label>Expires on<input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></label><label>Internal notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
        <div className="line-items"><div className="line-items-head"><strong>Line items</strong><button type="button" className="text-button" onClick={() => setLines([...lines, blankLine()])}>+ Add line</button></div>{lines.map((line, index) => <div className="line-item" key={index}><input placeholder="Description" value={line.description} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} required /><input type="number" min="0.01" step="0.01" placeholder="Qty" value={line.quantity} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} required /><input type="number" min="0" step="0.01" placeholder="Unit price" value={line.unit_price} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} required /><input type="number" min="0" step="0.01" placeholder="Tax %" value={line.tax_rate} onChange={(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} /><button type="button" className="remove-line" onClick={() => setLines(lines.length === 1 ? [blankLine()] : lines.filter((_, i) => i !== index))}>×</button></div>)}</div>
        <div className="estimate-total"><span>Preview total</span><strong>${previewTotal.toFixed(2)}</strong><small>Final totals are calculated by Owedly when saved.</small></div>
        {error && <p className="form-message error-text">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Create estimate'}</button></div>
      </form>
    </section></div>}
  </div>
}
