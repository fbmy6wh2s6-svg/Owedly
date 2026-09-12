import { useEffect, useState } from 'react'
import { canWrite, type CurrentBusiness } from '../lib/business'
import { completeReminder, getDashboardSnapshot, type DashboardSnapshot } from '../services/dashboard'

const empty: DashboardSnapshot = {
  customers: 0,
  openInvoices: 0,
  outstandingBalance: 0,
  jobsThisWeek: 0,
  overdueInvoices: [],
  dueReminders: [],
  todayAppointments: [],
}

function personName(customer?: { first_name: string | null; last_name: string | null; company: string | null }) {
  if (!customer) return 'Customer'
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Customer'
}

export default function DashboardPage({ business }: { business: CurrentBusiness }) {
  const [snapshot, setSnapshot] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      setSnapshot(await getDashboardSnapshot(business.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [business.id])

  async function finishReminder(reminderId: string) {
    try {
      await completeReminder(reminderId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete reminder')
    }
  }

  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Today</p>
          <h1>Here’s what needs your attention.</h1>
        </div>
      </div>
      <section className="metric-grid">
        <article className="metric-card"><span>Outstanding</span><strong>{loading ? '—' : money.format(snapshot.outstandingBalance)}</strong><small>{snapshot.openInvoices} open invoice{snapshot.openInvoices === 1 ? '' : 's'}</small></article>
        <article className="metric-card"><span>Jobs next 7 days</span><strong>{loading ? '—' : snapshot.jobsThisWeek}</strong><small>Scheduled work</small></article>
        <article className="metric-card"><span>Customers</span><strong>{loading ? '—' : snapshot.customers}</strong><small>Active customer records</small></article>
      </section>

      {error && <p className="form-message error-text">{error}</p>}

      <section className="dashboard-attention-grid">
        <article className="dashboard-panel">
          <div className="dashboard-panel-head"><div><p className="eyebrow">Today’s route</p><h2>Scheduled work</h2></div><span className="count-badge">{snapshot.todayAppointments.length}</span></div>
          {snapshot.todayAppointments.length === 0 ? <p className="quiet">Nothing is scheduled for today.</p> : <div className="dashboard-list">{snapshot.todayAppointments.map((appointment) => <div className="dashboard-list-row" key={appointment.id}><div className="time-box"><strong>{new Date(appointment.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong>{appointment.ends_at && <span>{new Date(appointment.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}</div><div className="row-main"><strong>{appointment.title}</strong><span>{personName(appointment.customers?.[0])} · {appointment.status.replaceAll('_', ' ')}</span></div></div>)}</div>}
        </article>

        <article className="dashboard-panel danger-panel">
          <div className="dashboard-panel-head"><div><p className="eyebrow">Money to collect</p><h2>Overdue invoices</h2></div><span className="count-badge">{snapshot.overdueInvoices.length}</span></div>
          {snapshot.overdueInvoices.length === 0 ? <p className="quiet">No overdue balances need attention.</p> : <div className="dashboard-list">{snapshot.overdueInvoices.map((invoice) => <div className="dashboard-list-row" key={invoice.id}><div className="row-main"><strong>{invoice.invoice_number || 'Invoice'} · {personName(invoice.customers?.[0])}</strong><span>{invoice.due_date ? `Due ${new Date(invoice.due_date + 'T00:00:00').toLocaleDateString()}` : 'Past due'}</span></div><strong className="overdue-money">${Number(invoice.balance_due).toFixed(2)}</strong></div>)}</div>}
        </article>
      </section>

      <section className="dashboard-panel reminders-panel">
        <div className="dashboard-panel-head"><div><p className="eyebrow">Follow-up</p><h2>Reminders that are due</h2></div><span className="count-badge">{snapshot.dueReminders.length}</span></div>
        {snapshot.dueReminders.length === 0 ? <p className="quiet">You’re caught up on reminders.</p> : <div className="dashboard-list">{snapshot.dueReminders.map((reminder) => <div className="dashboard-list-row" key={reminder.id}><div className="reminder-check">!</div><div className="row-main"><strong>{reminder.note || reminder.kind.replaceAll('_', ' ')}</strong><span>Due {new Date(reminder.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div>{canWrite(business.role) && <button className="secondary-button small-button" onClick={() => finishReminder(reminder.id)}>Done</button>}</div>)}</div>}
      </section>

      <section className="attention-card">
        <div>
          <p className="eyebrow">Owedly assistant</p>
          <h2>Tell Owedly what needs to get done.</h2>
          <p>Create customers, jobs, estimates, invoices, payments and schedule changes by voice. Owedly will show you the action before anything important is changed.</p>
        </div>
        <div className="command-examples">
          <span>“Who hasn’t paid me?”</span>
          <span>“Schedule Williams Tuesday at 10.”</span>
          <span>“Create an invoice for Bob Smith.”</span>
        </div>
      </section>
    </div>
  )
}
