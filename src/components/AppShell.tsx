import { useState } from 'react'
import type { CurrentBusiness } from '../lib/business'
import { supabase } from '../lib/supabase'
import DashboardPage from '../pages/DashboardPage'
import CustomersPage from '../pages/CustomersPage'
import JobsPage from '../pages/JobsPage'
import ChangeOrdersPage from '../pages/ChangeOrdersPage'
import DocumentsPage from '../pages/DocumentsPage'
import SettingsPage from '../pages/SettingsPage'
import WorkspaceProvider, {useWorkspace} from './WorkspaceContext'
import {useEffect,useRef} from 'react'
import SchedulePage from '../pages/SchedulePage'
import PaymentsPage from '../pages/PaymentsPage'
import VoiceAssistant from './VoiceAssistant'

type View = 'dashboard' | 'customers' | 'jobs' | 'change_orders' | 'estimates' | 'invoices' | 'schedule' | 'payments' | 'settings'
const nav: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'customers', label: 'Customers', icon: 'C' },
  { id: 'jobs', label: 'Jobs', icon: 'J' },
  { id: 'change_orders', label: 'Change Orders', icon: 'CO' },
  { id: 'estimates', label: 'Estimates', icon: 'E' },
  { id: 'invoices', label: 'Invoices', icon: 'I' },
  { id: 'schedule', label: 'Schedule', icon: 'S' },
  { id: 'payments', label: 'Payments', icon: '$' },
  { id: 'settings', label: 'Settings & plan', icon: '⚙' },
]
const mobilePrimary: View[] = ['dashboard', 'customers', 'estimates', 'invoices']
const mobileMore: View[] = ['jobs', 'schedule', 'change_orders', 'payments', 'settings']
export default function AppShell({business}:{business:CurrentBusiness}) {
 return <WorkspaceProvider businessId={business.id}><Shell business={business}/></WorkspaceProvider>
}
function Shell({ business }: { business: CurrentBusiness }) {
  const {workspace}=useWorkspace()
  const [targetId,setTargetId]=useState<string|undefined>()
  const [offline,setOffline]=useState(!navigator.onLine)
  const dirty=useRef(false)
  useEffect(()=>{const change=()=>setOffline(!navigator.onLine);const draft=(e:Event)=>{dirty.current=(e as CustomEvent).detail};window.addEventListener('online',change);window.addEventListener('offline',change);window.addEventListener('owedly:dirty',draft);return()=>{window.removeEventListener('online',change);window.removeEventListener('offline',change);window.removeEventListener('owedly:dirty',draft)}},[])
  const [view, setView] = useState<View>('dashboard')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [showMobileMore, setShowMobileMore] = useState(false)
  function navigate(next: string, id?:string) {
    if(!nav.some(n=>n.id===next))return
    if(dirty.current&&!window.confirm('Discard the unsaved document before leaving this page?'))return
    setTargetId(id);setView(next as View);setShowMobileMore(false)
  }
  function page() {
    if (view === 'dashboard') return <DashboardPage business={business} onNavigate={navigate} />
    if (view === 'customers') return <CustomersPage business={business} />
    if (view === 'jobs') return <JobsPage business={business} />
    if (view === 'change_orders') return <ChangeOrdersPage business={business} />
    if (view === 'estimates') return <DocumentsPage business={business} kind="estimate" initialId={targetId} onNavigate={navigate} />
    if (view === 'invoices') return <DocumentsPage business={business} kind="invoice" initialId={targetId} onNavigate={navigate} />
    if (view === 'settings') return <SettingsPage business={business} />
    if (view === 'schedule') return <SchedulePage business={business} />
    return <PaymentsPage business={business} onNavigate={navigate} />
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="logo-mark small">O</div><span>Owedly</span></div>
        <nav aria-label="Main navigation">{nav.map((item) => <button aria-label={item.label} key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-footer"><div className="business-chip"><strong>{workspace.profile.name}</strong><span>{business.role}</span></div><button className="text-button left" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </aside>
      <main className="workspace">{offline&&<p className="banner warning" role="alert">You are offline. Changes cannot be saved or sent until your connection returns. Unsaved forms remain on this screen.</p>}
        <header className="topbar"><div className="mobile-brand"><div className="logo-mark small">O</div><strong>Owedly</strong></div><div className="topbar-business"><span>{workspace.profile.name}</span><span className="role-pill">{business.role}</span></div></header>
        <div className="workspace-inner" key={`${view}-${targetId||''}-${refreshVersion}`}>{page()}</div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobilePrimary.map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button aria-label={item.label} key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></button>
        })}
        <button aria-label="More" className={mobileMore.includes(view) || showMobileMore ? 'active' : ''} onClick={() => setShowMobileMore(true)}><span aria-hidden="true">•••</span><small>More</small></button>
      </nav>
      {showMobileMore && <div className="mobile-more-backdrop" onMouseDown={() => setShowMobileMore(false)}><section className="mobile-more-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mobile-more-handle" />
        <div className="mobile-more-head"><div><p className="eyebrow">Owedly</p><h2>More</h2></div><button className="icon-button" aria-label="Close menu" onClick={() => setShowMobileMore(false)}>×</button></div>
        <div className="mobile-more-grid">{mobileMore.map((id) => {
          const item = nav.find((entry) => entry.id === id)!
          return <button aria-label={item.label} key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><span className="more-icon" aria-hidden="true">{item.icon}</span><strong>{item.label}</strong></button>
        })}</div>
        <div className="mobile-more-account"><div><strong>{workspace.profile.name}</strong><span>{business.role}</span></div><button className="secondary-button" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </section></div>}
      {workspace.plan.plan==='pro'&&<VoiceAssistant business={business} onChanged={() => setRefreshVersion((v) => v + 1)} />}
    </div>
  )
}
