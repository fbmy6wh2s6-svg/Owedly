import {calculateLines} from '../lib/commerce'
import {normalizeRelations} from '../lib/relations'
import { supabase } from '../lib/supabase'

export interface ChangeOrderLineInput {
  description: string
  quantity: number
  unit_price: number
  tax_rate?: number
}

export interface ChangeOrderInput {
  customer_id: string
  job_id: string
  estimate_id?: string
  title: string
  description?: string
  reason?: string
  schedule_impact_days?: number
  schedule_note?: string
  notes?: string
  customer_message?: string
  items: ChangeOrderLineInput[]
}

export async function listChangeOrders(businessId: string) {
  const { data, error } = await supabase
    .from('change_orders')
    .select('id,change_order_number,status,title,description,reason,schedule_impact_days,schedule_note,issue_date,subtotal,tax_amount,total,sent_at,approved_at,declined_at,customer_id,job_id,customers:customers!change_orders_customer_id_fkey(id,first_name,last_name,company),jobs:jobs!change_orders_job_id_fkey(id,title,status)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return normalizeRelations(data)
}

export async function createChangeOrder(businessId:string,input:ChangeOrderInput,requestId:string=crypto.randomUUID()){
 const checked=calculateLines(input.items)
 const {data,error}=await supabase.rpc('create_change_order_document',{target_business_id:businessId,request_id:requestId,payload:{...input,items:checked.items}})
 if(error)throw new Error(error.message)
 return data
}

export async function updateChangeOrderStatus(changeOrderId: string, status: 'draft' | 'sent' | 'approved' | 'declined' | 'void') {
  const { data, error } = await supabase
    .from('change_orders')
    .update({ status })
    .eq('id', changeOrderId)
    .select('id,status,sent_at,approved_at,declined_at')
    .single()
  if (error) throw new Error(error.message)
  return normalizeRelations(data)
}
