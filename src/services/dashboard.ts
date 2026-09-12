import { supabase } from '../lib/supabase'

export interface DashboardSnapshot {
  customers: number
  openInvoices: number
  outstandingBalance: number
  jobsThisWeek: number
}

export async function getDashboardSnapshot(businessId: string): Promise<DashboardSnapshot> {
  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(now.getDate() + 7)

  const [customers, invoices, jobs] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('archived', false),
    supabase.from('invoices').select('balance_due').eq('business_id', businessId).in('status', ['sent', 'viewed', 'partial', 'overdue']),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', businessId).gte('scheduled_start', now.toISOString()).lt('scheduled_start', weekEnd.toISOString()).neq('status', 'canceled'),
  ])

  if (customers.error) throw customers.error
  if (invoices.error) throw invoices.error
  if (jobs.error) throw jobs.error

  return {
    customers: customers.count ?? 0,
    openInvoices: invoices.data.length,
    outstandingBalance: invoices.data.reduce((sum, row) => sum + Number(row.balance_due ?? 0), 0),
    jobsThisWeek: jobs.count ?? 0,
  }
}
