import { supabase } from '../lib/supabase'
import { listCustomerProperties } from './properties'

export async function getCustomerDetail(businessId: string, customerId: string) {
  const [customer, properties, jobs, estimates, invoices] = await Promise.all([
    supabase.from('customers').select('*').eq('business_id', businessId).eq('id', customerId).single(),
    listCustomerProperties(businessId, customerId),
    supabase.from('jobs').select('id,title,status,scheduled_start,completed_at,description').eq('business_id', businessId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(20),
    supabase.from('estimates').select('id,estimate_number,status,total,issue_date,expires_on').eq('business_id', businessId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(20),
    supabase.from('invoices').select('id,invoice_number,status,total,amount_paid,balance_due,issue_date,due_date').eq('business_id', businessId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(20),
  ])

  if (customer.error) throw new Error(customer.error.message)
  if (jobs.error) throw new Error(jobs.error.message)
  if (estimates.error) throw new Error(estimates.error.message)
  if (invoices.error) throw new Error(invoices.error.message)

  return {
    customer: customer.data,
    properties,
    jobs: jobs.data ?? [],
    estimates: estimates.data ?? [],
    invoices: invoices.data ?? [],
  }
}
