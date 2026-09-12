import { useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { supabase } from '../lib/supabase'
import DashboardPage from '../pages/DashboardPage'
import CustomersPage from '../pages/CustomersPage'
import JobsPage from '../pages/JobsPage'
import EstimatesPage from '../pages/EstimatesPage'
import InvoicesPage from '../pages/InvoicesPage'
import SchedulePage from '../pages/SchedulePage'
import PaymentsPage from '../pages/PaymentsPage'
import VoiceAssistant from './VoiceAssistant'

type View = 'dashboard' | 'customers' | 'jobs' | 'estimates' | 'invoices' | 'schedule' | 'payments'

const nav: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'customers', label: 'Customers', icon: 'C' },
  { id: 'jobs', label: 'Jobs', icon: 'J' },
  { id: 'estimates', label: 'Estimates', icon: 'E' },
  { id: 'invoices', label: 'Invoices', icon: 'I' },
  { id: 'schedule', label: 'Schedule', icon: 'S' },
  { id: 'payments', label: 'Payments', icon: '$' },
]

export default function AppShell({ business }: { business: CurrentBusiness }) {
  const [view, setView] = useState<View>('dashboard')
  const [refreshVersion, setRefreshVersion] = useState(0)

  function page() {
    if (view === 'dashboard') return <DashboardPage business={business} />
    if (view === 'customers') return <CustomersPage business={business} />
    if (view === 'jobs') return <JobsPage business={business} />
    if (view === 'estimates') return <EstimatesPage business={business} />
    if (view === 'invoices') return <InvoicesPage business={business} />
    if (view === 'schedule') return <SchedulePage business={business} />
    return <PaymentsPage business={business} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="logo-mark small">O</div><span>Owedly</span></div>
        <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-footer"><div className="business-chip"><strong>{business.name}</strong><span>{business.role}</span></div><button className="text-button left" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </aside>
      <main className="workspace">
        <header className="topbar"><div className="mobile-brand"><div className="logo-mark small">O</div><strong>Owedly</strong></div><div className="topbar-business"><span>{business.name}</span><span className="role-pill">{business.role}</span></div></header>
        <div className="workspace-inner" key={`${view}-${refreshVersion}`}>{page()}</div>
      </main>
      <nav className="mobile-nav">{nav.slice(0, 5).map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>
      <VoiceAssistant business={business} onChanged={() => setRefreshVersion((v) => v + 1)} />
    </div>
  )
}
