import { useEffect, useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { getDashboardSnapshot, type DashboardSnapshot } from '../services/dashboard'

const empty: DashboardSnapshot = { customers: 0, openInvoices: 0, outstandingBalance: 0, jobsThisWeek: 0 }

export default function DashboardPage({ business }: { business: CurrentBusiness }) {
  const [snapshot, setSnapshot] = useState(empty)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDashboardSnapshot(business.id)
      .then(setSnapshot)
      .finally(() => setLoading(false))
  }, [business.id])

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
