import { supabase } from '../lib/supabase'

export type DocumentEmailType = 'estimate' | 'change_order'

export type SendDocumentEmailResult = {
  email_id: string | null
  recipient: string
  approval_link_id: string
  expires_at: string
  status: 'accepted'
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
      request_id: pendingRequest(businessId,documentType,documentId),
    },
  })

  if(error){let message=error.message;try{const body=await (error as any).context?.json();if(typeof body?.error==='string')message=body.error}catch{}throw new Error(message)}
  sessionStorage.removeItem(`owedly-mail-${businessId}-${documentType}-${documentId}`)
  return data as SendDocumentEmailResult
}

function pendingRequest(businessId:string,type:string,id:string){
 const key=`owedly-mail-${businessId}-${type}-${id}`
 let value=sessionStorage.getItem(key)
 if(!value){value=crypto.randomUUID();sessionStorage.setItem(key,value)}
 return value
}
