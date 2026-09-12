import { supabase } from '../lib/supabase'

export type DocumentEmailType = 'estimate' | 'change_order'

export type SendDocumentEmailResult = {
  email_id: string | null
  recipient: string
  approval_link_id: string
  expires_at: string
  status: 'sent'
}

export async function sendDocumentEmail(
  businessId: string,
  documentType: DocumentEmailType,
  documentId: string,
) {
  const { data, error } = await supabase.functions.invoke('send-document-email', {
    body: {
      business_id: businessId,
      document_type: documentType,
      document_id: documentId,
    },
  })

  if (error) throw error
  return data as SendDocumentEmailResult
}
