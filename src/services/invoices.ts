import {normalizeRelations} from '../lib/relations'
import { supabase } from '../lib/supabase'

export interface InvoiceLineInput {
  description: string
  quantity: number
  unit_price: number
  tax_rate?: number
}

export async function listInvoices(businessId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id,invoice_number,status,issue_date,due_date,subtotal,tax_amount,total,amount_paid,balance_due,customer_id,customers:customers!invoices_customer_id_fkey(id,first_name,last_name,company)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return normalizeRelations(data)
}

export async function createInvoice(
  businessId: string,
  input: { customer_id: string; due_date?: string; notes?: string; customer_message?: string; items: InvoiceLineInput[] },
) {
  if (!input.customer_id) throw new Error('Choose a customer')
  const {data,error}=await supabase.rpc('create_document',{target_business_id:businessId,document_kind:'invoice',request_id:crypto.randomUUID(),payload:input})
  if(error)throw new Error(error.message)
  return normalizeRelations(data)
}

export async function updateInvoiceStatus(invoiceId: string, status: 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'void') {
  const updates: Record<string, unknown> = { status }
  if (status === 'sent') updates.sent_at = new Date().toISOString()
  const { error } = await supabase.from('invoices').update(updates).eq('id', invoiceId)
  if (error) throw new Error(error.message)
}
