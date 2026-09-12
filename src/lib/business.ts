import { supabase } from './supabase'

export type BusinessRole = 'owner' | 'admin' | 'office' | 'technician' | 'viewer'

export interface CurrentBusiness {
  id: string
  name: string
  role: BusinessRole
}

export async function getCurrentBusiness(): Promise<CurrentBusiness | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!authData.user) return null

  const { data: membership, error: membershipError } = await supabase
    .from('business_members')
    .select('business_id, role, businesses(id, name)')
    .eq('user_id', authData.user.id)
    .limit(1)
    .maybeSingle()

  if (membershipError) throw membershipError
  if (!membership) return null

  const business = Array.isArray(membership.businesses)
    ? membership.businesses[0]
    : membership.businesses

  if (!business) return null

  return {
    id: business.id,
    name: business.name,
    role: membership.role as BusinessRole,
  }
}

export async function createBusiness(name: string): Promise<CurrentBusiness> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Business name is required')

  const { data, error } = await supabase
    .from('businesses')
    .insert({ name: cleanName })
    .select('id, name')
    .single()

  if (error) throw error

  return { id: data.id, name: data.name, role: 'owner' }
}

export function canWrite(role: BusinessRole) {
  return role !== 'viewer'
}
