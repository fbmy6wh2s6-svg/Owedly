import {useEffect,useState} from 'react'
import type {CurrentBusiness} from '../lib/business'
import {supabase} from '../lib/supabase'
import {errorMessage,money,customerName,dateLabel} from '../lib/commerce'
import {useWorkspace} from '../components/WorkspaceContext'
export default function DashboardPage({business,onNavigate}:{business:CurrentBusiness;onNavigate?:(view:string,id?:string)=>void}){
 const {workspace}=useWorkspace()
 const [metrics,setMetrics]=useState<any>(null),[overdue,setOverdue]=useState<any[]>([]),[reminders,setReminders]=useState<any[]>([]),[appointments,setAppointments]=useState<any[]>([]),[activity,setActivity]=useState<any[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 async function load(){setLoading(true);setError('');try{
  const result=await supabase.rpc('get_dashboard_metrics',{target_business_id:business.id});if(result.error)throw result.error
  const today=result.data.today
  const [inv,rem,app,events]=await Promise.all([
   supabase.from('invoices').select('id,invoice_number,due_date,balance_due,customers:customers!invoices_customer_id_fkey(first_name,last_name,company)').eq('business_id',business.id).not('status','in','(draft,void)').lt('due_date',today).gt('balance_due',0).order('due_date').limit(8),
   supabase.from('reminders').select('id,note,due_at,invoice_id,estimate_id,job_id,status').eq('business_id',business.id).eq('status','pending').lte('due_at',new Date().toISOString()).order('due_at').limit(8),
   supabase.from('appointments').select('id,title,starts_at,status').eq('business_id',business.id).gte('starts_at',new Date().toISOString()).not('status','in','(canceled,completed,no_show)').order('starts_at').limit(8),
   supabase.from('payments').select('id,invoice_id,amount,method,status,paid_at').eq('business_id',business.id).order('paid_at',{ascending:false}).limit(8),
  ])
  for(const r of [inv,rem,app,events])if(r.error)throw r.error
  setMetrics(result.data);setOverdue(inv.data||[]);setReminders(rem.data||[]);setAppointments(app.data||[]);setActivity(events.data||[])
 }catch(e){setError(errorMessage(e))}finally{setLoading(false)}}
 useEffect(()=>{load()},[business.id])
 async function complete(id:string){try{const {error}=await supabase.from('reminders').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',id).eq('business_id',business.id);if(error)throw error;await load()}catch(e){setError(errorMessage(e))}}
 const cash=(v:number)=>money(v,workspace.profile.currency), pro=workspace.plan.plan==='pro'
 return <div className="page-stack dashboard-upgraded"><div className="page-heading split-heading"><div><p className="eyebrow">{workspace.profile.name}</p><h1>Your business, at a glance.</h1><p className="quiet">See what needs attention, then get back to work.</p></div><button className="secondary-button" disabled={loading} onClick={load}>Refresh</button></div>
 <div className="quick-actions"><button className="primary-button" onClick={()=>onNavigate?.('invoices')}>Create or manage invoices</button><button className="secondary-button" onClick={()=>onNavigate?.('estimates')}>Create or manage estimates</button><button className="secondary-button" onClick={()=>onNavigate?.('customers')}>Add a customer</button></div>
 {error&&<p className="banner error-text" role="alert">Dashboard unavailable: {error}. No totals should be assumed from missing data.</p>}
 {loading?<div className="detail-card" role="status">Refreshing your totals…</div>:metrics&&!error?<>
 <section className="metric-grid">
 <button className="metric-card" onClick={()=>onNavigate?.('invoices')}><span>Outstanding — issued invoices</span><strong>{cash(metrics.outstanding)}</strong><small>{metrics.open_count} open invoices · excludes drafts and voids</small></button>
 <button className="metric-card" onClick={()=>onNavigate?.('invoices')}><span>Overdue</span><strong>{cash(metrics.overdue)}</strong><small>{metrics.overdue_count} unpaid invoices past their due date</small></button>
 <button className="metric-card" onClick={()=>onNavigate?.('payments')}><span>Payments recorded this month</span><strong>{cash(metrics.collected_month)}</strong><small>Before processing fees · not verified bank deposits or profit</small></button>
 <button className="metric-card" onClick={()=>onNavigate?.('estimates')}><span>Estimates ready to invoice</span><strong>{metrics.accepted_estimates}</strong><small>{metrics.awaiting_estimates} estimates awaiting a decision</small></button>
 </section>
 <div className="dashboard-columns"><section className="detail-card"><h2>Needs your attention</h2>
 {metrics.draft_count>0&&<button className="attention-row" onClick={()=>onNavigate?.('invoices')}><span>Draft invoices not yet shared</span><strong>{metrics.draft_count} →</strong></button>}
 {metrics.failed_emails>0&&<div className="banner warning">{metrics.failed_emails} email attempts failed this month. Review the affected documents before retrying.</div>}
 {overdue.map(i=><button className="attention-row" key={i.id} onClick={()=>onNavigate?.('invoices',i.id)}><span><strong>{i.invoice_number}</strong><small>{customerName(i.customers)} · due {dateLabel(i.due_date)}</small></span><strong>{cash(i.balance_due)} →</strong></button>)}
 {!overdue.length&&!metrics.draft_count&&!metrics.failed_emails&&<p className="quiet">No overdue invoices, unsent drafts, or failed emails in this view.</p>}
 {metrics.overdue_count>overdue.length&&<button className="text-button" onClick={()=>onNavigate?.('invoices')}>View all {metrics.overdue_count} overdue invoices</button>}
 </section><section className="detail-card"><h2>Follow-ups due</h2>{reminders.length?reminders.map(r=><div className="attention-row" key={r.id}><button className="text-button left" onClick={()=>onNavigate?.(r.invoice_id?'invoices':r.estimate_id?'estimates':'jobs',r.invoice_id||r.estimate_id||r.job_id)}>{r.note||'Follow up'}<small>{new Date(r.due_at).toLocaleString(undefined,{timeZone:metrics.timezone})}</small></button><button className="secondary-button compact" onClick={()=>complete(r.id)}>Done</button></div>):<p className="quiet">No pending follow-ups are due.</p>}<p className="quiet">These are in-app reminders, not automatic email or push notifications.</p></section></div>
 <details className="detail-card" open><summary>Receivables aging</summary><div className="aging-grid">{Object.entries(metrics.aging).map(([key,value])=><div key={key}><span>{({current:'Current / no due date',days_1_30:'1–30 days late',days_31_60:'31–60 days late',days_61_90:'61–90 days late',days_90_plus:'Over 90 days late'} as Record<string,string>)[key]}</span><strong>{cash(Number(value))}</strong></div>)}</div><p className="quiet">Dates use your business timezone: {metrics.timezone}. Totals are calculated from all matching records, not only this page.</p></details>
 <details className="detail-card"><summary>Upcoming schedule & recent payments</summary><div className="dashboard-columns"><div><h3>Next appointments</h3>{appointments.length?appointments.map(a=><div className="attention-row" key={a.id}><span>{a.title}<small>{new Date(a.starts_at).toLocaleString(undefined,{timeZone:metrics.timezone})}</small></span><span>{a.status}</span></div>):<p>No upcoming appointments.</p>}<button className="text-button" onClick={()=>onNavigate?.('schedule')}>Open schedule</button></div><div><h3>Recent recorded payments</h3>{activity.length?activity.map(p=><button className="attention-row" key={p.id} onClick={()=>onNavigate?.('invoices',p.invoice_id)}><span>{p.method||'Payment'} · {p.status}<small>{dateLabel(p.paid_at)}</small></span><strong>{cash(p.amount)}</strong></button>):<p>No recorded payments.</p>}</div></div></details>
 <details className="detail-card"><summary>Your plan & storage</summary><div className="usage-grid"><div><strong>{pro?'Pro':'Free Basic'}</strong><span>{workspace.plan.documents_used}/{workspace.plan.documents_limit} new documents this month</span></div><div><strong>{workspace.plan.customers_used}/{workspace.plan.customers_limit}</strong><span>Stored customers</span></div><div><strong>{workspace.plan.stored_documents}/{workspace.plan.stored_limit}</strong><span>Stored documents</span></div></div><button className="text-button" onClick={()=>onNavigate?.('settings')}>View plan, payment settings, branding & data export</button></details>
 </>:null}</div>
}
