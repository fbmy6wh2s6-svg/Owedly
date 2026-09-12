import { supabase } from '../lib/supabase'

export interface DashboardSnapshot {
  customers: number
  openInvoices: number
  outstandingBalance: number
  jobsThisWeek: number
  overdueInvoices: Array<{
    id: string
    invoice_number: string | null
    due_date: string | null
    balance_due: number
    customers: Array<{ first_name: string | null; last_name: string | null; company: string | null }> | null
  }>
  dueReminders: Array<{
    id: string
    kind: string
    due_at: string
    note: string | null
    invoice_id: string | null
    customer_id: string | null
  }>
  todayAppointments: Array<{
    id: string
    title: string
    starts_at: string
    ends_at: string | null
    status: string
    customers: Array<{ first_name: string | null; last_name: string | null; company: string | null }> | null
  }>
}

export async function getDashboardSnapshot(businessId: string): Promise<DashboardSnapshot> {
  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(now.getDate() + 7)

  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(todayStart.getDate() + 1)
  const todayDate = todayStart.toISOString().slice(0, 10)

  const [customers, invoices, jobs, overdueInvoices, dueReminders, todayAppointments] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('archived', false),
    supabase.from('invoices').select('balance_due').eq('business_id', businessId).gt('balance_due', 0).neq('status', 'void'),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', businessId).gte('scheduled_start', now.toISOString()).lt('scheduled_start', weekEnd.toISOString()).neq('status', 'canceled'),
    supabase.from('invoices').select('id,invoice_number,due_date,balance_due,customers(first_name,last_name,company)').eq('business_id', businessId).lt('due_date', todayDate).gt('balance_due', 0).neq('status', 'void').order('due_date', { ascending: true }).limit(10),
    supabase.from('reminders').select('id,kind,due_at,note,invoice_id,customer_id').eq('business_id', businessId).eq('status', 'pending').lte('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(10),
    supabase.from('appointments').select('id,title,starts_at,ends_at,status,customers(first_name,last_name,company)').eq('business_id', businessId).gte('starts_at', todayStart.toISOString()).lt('starts_at', tomorrowStart.toISOString()).neq('status', 'canceled').order('starts_at', { ascending: true }).limit(20),
  ])

  if (customers.error) throw customers.error
  if (invoices.error) throw invoices.error
  if (jobs.error) throw jobs.error
  if (overdueInvoices.error) throw overdueInvoices.error
  if (dueReminders.error) throw dueReminders.error
  if (todayAppointments.error) throw todayAppointments.error

  return {
    customers: customers.count ?? 0,
    openInvoices: invoices.data.length,
    outstandingBalance: invoices.data.reduce((sum, row) => sum + Number(row.balance_due ?? 0), 0),
    jobsThisWeek: jobs.count ?? 0,
    overdueInvoices: overdueInvoices.data ?? [],
    dueReminders: dueReminders.data ?? [],
    todayAppointments: todayAppointments.data ?? [],
  }
}

export async function completeReminder(reminderId: string) {
  const { error } = await supabase
    .from('reminders')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', reminderId)
    .eq('status', 'pending')

  if (error) throw error
}
