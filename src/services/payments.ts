import {normalizeRelations} from '../lib/relations'
import { supabase } from '../lib/supabase'

export async function listPayments(businessId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('id,amount,method,status,paid_at,notes,invoice_id,invoices:invoices!payments_invoice_id_fkey(invoice_number,total,balance_due,customers:customers!invoices_customer_id_fkey(id,first_name,last_name,company))')
    .eq('business_id', businessId)
    .order('paid_at', { ascending: false })

  if (error) throw new Error(error.message)
  return normalizeRelations(data)
}

export async function listOpenInvoices(businessId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id,invoice_number,total,amount_paid,balance_due,customers:customers!invoices_customer_id_fkey(id,first_name,last_name,company)')
    .eq('business_id', businessId)
    .gt('balance_due', 0)
    .not('status', 'in', '(draft,void)')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return normalizeRelations(data)
}

export async function recordPayment(
  businessId: string,
  input: { invoice_id: string; amount: number; method: 'cash' | 'check' | 'card' | 'ach' | 'other'; notes?: string; request_id?: string },
) {
  if (!input.invoice_id) throw new Error('Choose an invoice')
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Enter a valid payment amount')

  const {data,error}=await supabase.rpc('record_manual_payment',{
    target_business_id:businessId,invoice_id:input.invoice_id,request_id:input.request_id||crypto.randomUUID(),
    payment_amount:input.amount,payment_method:input.method,payment_note:input.notes||'',
  })
  if(error)throw new Error(error.message)
  return normalizeRelations(data)
}
