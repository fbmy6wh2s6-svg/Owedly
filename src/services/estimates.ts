import {normalizeRelations} from '../lib/relations'
import { supabase } from '../lib/supabase'

export interface EstimateLineInput {
  description: string
  quantity: number
  unit_price: number
  tax_rate?: number
}

export async function listEstimates(businessId: string) {
  const { data, error } = await supabase
    .from('estimates')
    .select('id,estimate_number,status,issue_date,expires_on,subtotal,tax_amount,total,customer_id,customers:customers!estimates_customer_id_fkey(id,first_name,last_name,company)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return normalizeRelations(data)
}

export async function createEstimate(
  businessId: string,
  input: { customer_id: string; expires_on?: string; notes?: string; customer_message?: string; items: EstimateLineInput[] },
) {
  if (!input.customer_id) throw new Error('Choose a customer')
  const {data,error}=await supabase.rpc('create_document',{target_business_id:businessId,document_kind:'estimate',request_id:crypto.randomUUID(),payload:input})
  if(error)throw new Error(error.message)
  return normalizeRelations(data)
}

export async function updateEstimateStatus(estimateId: string, status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted') {
  const { error } = await supabase.from('estimates').update({ status }).eq('id', estimateId)
  if (error) throw new Error(error.message)
}

export async function convertEstimateToInvoice(estimateId: string, dueDate?: string) {
  const { data, error } = await supabase.rpc('convert_estimate_to_invoice', {
    target_estimate_id: estimateId,
    target_due_date: dueDate || null,
  })

  if (error) throw new Error(error.message)
  return data as string
}
