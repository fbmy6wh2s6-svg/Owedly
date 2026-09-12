import { supabase } from '../lib/supabase'

export async function listAppointments(businessId: string, from?: string, to?: string) {
  let query = supabase
    .from('appointments')
    .select('id,title,starts_at,ends_at,status,customer_id,job_id,customers(id,first_name,last_name,company),jobs(id,title,status)')
    .eq('business_id', businessId)
    .neq('status', 'canceled')
    .order('starts_at', { ascending: true })

  if (from) query = query.gte('starts_at', from)
  if (to) query = query.lt('starts_at', to)

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function updateAppointmentStatus(appointmentId: string, status: 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'canceled' | 'no_show') {
  const { error } = await supabase.from('appointments').update({ status }).eq('id', appointmentId)
  if (error) throw error
}
