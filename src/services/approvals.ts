import { supabase } from '../lib/supabase'

export type ApprovalDocumentType = 'estimate' | 'change_order'

export async function createApprovalLink(businessId: string, documentType: ApprovalDocumentType, documentId: string, expiresDays = 14) {
  const { data, error } = await supabase.functions.invoke('create-approval-link', {
    body: {
      business_id: businessId,
      document_type: documentType,
      document_id: documentId,
      expires_days: expiresDays,
    },
  })
  if (error) throw new Error(error.message)
  const relative = String(data.relative_url ?? `/?approval=${encodeURIComponent(data.token)}`)
  return {
    ...data,
    url: new URL(relative, window.location.origin).toString(),
  } as { approval_link_id: string; token: string; expires_at: string; relative_url: string; url: string }
}

export async function getCustomerApproval(token: string) {
  const { data, error } = await supabase.functions.invoke('customer-approval', {
    body: { token, mode: 'view' },
  })
  if (error) throw new Error(error.message)
  return data
}

export async function submitCustomerApproval(token: string, action: 'approved' | 'declined', typedName: string) {
  const { data, error } = await supabase.functions.invoke('customer-approval', {
    body: { token, mode: action, typed_name: typedName.trim() },
  })
  if (error) throw new Error(error.message)
  return data
}
