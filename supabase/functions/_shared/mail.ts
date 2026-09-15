import {authenticate,requirePro,reserve,preflight,response,failure,AccessError,uuid} from './access.ts'
const emailPattern=/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/
const escape=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const providerLabels:Record<string,string>={stripe:'Stripe',venmo:'Venmo',paypal:'PayPal',square:'Square',cashapp:'Cash App'}
async function hash(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('')}
export async function sendMail(req:Request,invoiceMode:boolean){
 const early=preflight(req);if(early)return early
 try{
  const {db,user}=await authenticate(req)
  let input:any;try{input=await req.json()}catch{throw new AccessError('Invalid request.',400)}
  const businessId=String(input.business_id||''),requestId=String(input.request_id||''),documentId=String(invoiceMode?input.invoice_id:input.document_id),type=invoiceMode?'invoice':String(input.document_type||'')
  if(!['invoice','estimate','change_order'].includes(type)||![businessId,requestId,documentId].every(v=>uuid.test(v)))throw new AccessError('Valid business, document and request IDs are required.',400)
  await requirePro(db,businessId)
  const key=Deno.env.get('RESEND_API_KEY');if(!key)throw new AccessError('Email is not configured. Nothing was sent.',503)
  const {data:membership,error:memberError}=await db.from('business_members').select('role').eq('business_id',businessId).eq('user_id',user.id).maybeSingle()
  if(memberError||!membership||!['owner','admin','office','technician'].includes(membership.role))throw new AccessError('You do not have permission to send this document.',403)
  const table=type==='invoice'?'invoices':type==='estimate'?'estimates':'change_orders'
  const docFields=type==='invoice'?'id,customer_id,invoice_number,status,issue_date,due_date,subtotal,tax_amount,total,amount_paid,balance_due,customer_message,payment_links,payment_instructions':type==='estimate'?'id,customer_id,estimate_number,status,issue_date,expires_on,subtotal,tax_amount,total,customer_message':'id,customer_id,change_order_number,status,issue_date,subtotal,tax_amount,total,customer_message,title,schedule_impact_days'
  const {data:raw,error:docError}=await db.from(table).select(docFields).eq('business_id',businessId).eq('id',documentId).maybeSingle()
  const doc=raw as any
  if(docError)throw new AccessError('Unable to load document.',500)
  if(!doc)throw new AccessError('Document not found.',404)
  if(['void','converted','expired'].includes(doc.status)||type!=='invoice'&&['accepted','approved','declined'].includes(doc.status))throw new AccessError('This document is no longer available for sending.',409)
  const [businessResult,customerResult,itemResult,brandResult]=await Promise.all([
   db.from('businesses').select('name,email,phone,currency,timezone,address_line1,city,state,postal_code').eq('id',businessId).single(),
   db.from('customers').select('id,first_name,last_name,company,email').eq('business_id',businessId).eq('id',doc.customer_id).single(),
   db.from(type==='invoice'?'invoice_items':type==='estimate'?'estimate_items':'change_order_items').select('description,quantity,unit_price,tax_rate,line_total').eq('business_id',businessId).eq(`${type}_id`,documentId).order('sort_order').order('id'),
   db.from('business_branding').select('logo_data_url').eq('business_id',businessId).maybeSingle(),
  ])
  if(businessResult.error||customerResult.error||itemResult.error||brandResult.error)throw new AccessError('Unable to load document details.',500)
  const business=businessResult.data,customer=customerResult.data,items=itemResult.data
  const recipient=String(customer.email||'').trim()
  if(!emailPattern.test(recipient))throw new AccessError('Add a valid email address to this customer.',409)
  if(!items.length)throw new AccessError('Add line items before sending.',409)
  const {data:existing,error:existingError}=await db.from('messages').select('id,business_id,invoice_id,estimate_id,change_order_id,recipient,subject,body,status,provider_message_id,created_at,email_payload_hash').eq('business_id',businessId).eq('id',requestId).maybeSingle()
  if(existingError)throw new AccessError('Unable to check the previous send status.',500)
  if(existing&&(existing as any)[`${type}_id`]!==documentId)throw new AccessError('This request belongs to another document.',409)
  if(existing?.provider_message_id&&['sent','delivered'].includes(existing.status))return response(req,200,{status:'accepted',email_id:existing.provider_message_id,recipient:existing.recipient,already_sent:true})
  if(existing&&Date.now()-Date.parse(existing.created_at)>23*3600000)throw new AccessError('This attempt is too old to retry safely. Check delivery activity before starting a new send.',409)
  await reserve(businessId,user.id,'email',requestId)
  const number=String(doc.invoice_number||doc.estimate_number||doc.change_order_number||'').replace(/[\r\n]/g,' '),label=type==='change_order'?'Change order':type==='invoice'?'Invoice':'Estimate'
  const customerName=[customer.first_name,customer.last_name].filter(Boolean).join(' ')||customer.company||'Customer',money=(v:unknown)=>new Intl.NumberFormat('en-US',{style:'currency',currency:business.currency||'USD'}).format(Number(v||0))
  const subject=existing?.subject||`${String(business.name).replace(/[\r\n]/g,' ')}: ${label} ${number}`
  let approvalUrl=''
  if(type!=='invoice'&&!existing){
   const bytes=crypto.getRandomValues(new Uint8Array(32)),token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
   const {error}=await db.from('document_approval_links').insert({business_id:businessId,document_type:type,[`${type}_id`]:documentId,token_hash:await hash(token),expires_at:new Date(Date.now()+14*86400000).toISOString(),created_by_user_id:user.id})
   if(error)throw new AccessError('The approval link could not be created. Nothing was sent.',500)
   const base=(Deno.env.get('APP_BASE_URL')||'https://app.owedlyworks.com').replace(/\/$/,'')
   approvalUrl=`${base}/?approval=${token}`
  }
  const paymentLines=type==='invoice'&&Number(doc.balance_due)>0?(doc.payment_links||[]).map((link:any)=>`${providerLabels[link.provider]||'Payment'}: ${link.url}`):[]
  const text=existing?.body||[business.name,[business.address_line1,business.city,business.state,business.postal_code].filter(Boolean).join(', '),`${label} ${number}`,`Hi ${customerName},`,`Issued: ${doc.issue_date}`,doc.due_date?`Due: ${doc.due_date}`:'',doc.expires_on?`Valid through: ${doc.expires_on}`:'','',...items.map((item:any)=>`${item.description}\n${item.quantity} × ${money(item.unit_price)} = ${money(item.line_total)}; tax ${item.tax_rate}%`),'',`Subtotal: ${money(doc.subtotal)}`,`Tax: ${money(doc.tax_amount)}`,`Total: ${money(doc.total)}`,type==='invoice'?`Paid: ${money(doc.amount_paid)}\nBalance due: ${money(doc.balance_due)}`:'',doc.customer_message||'',type==='invoice'?doc.payment_instructions||'':'',...paymentLines,paymentLines.length?`Verify the business, amount, currency, and invoice ${number} before paying. Provider fees may apply. Payment is confirmed separately by the business.`:'',approvalUrl?`Review and respond: ${approvalUrl}`:'',business.email||'',business.phone||''].join('\n')
  const logo=brandResult.data?.logo_data_url
  const logoContent=typeof logo==='string'&&logo.startsWith('data:image/png;base64,')&&logo.length<=174800?logo.slice('data:image/png;base64,'.length):null
  const linked=escape(text).replace(/https:\/\/[^\s<]+/g,url=>`<a href="${url}" style="color:#2457a7;overflow-wrap:anywhere">${url}</a>`)
  const payload:any={from:'Owedly Office <notifications@owedlyworks.com>',to:[existing?.recipient||recipient],subject,text,html:`<!doctype html><html><head><meta charset="utf-8"></head><body><div style="max-width:640px;margin:auto;padding:24px;font-family:Arial,sans-serif">${logoContent?'<img src="cid:company-logo" alt="Company logo" style="max-width:180px;max-height:100px">':''}<div style="white-space:pre-wrap;line-height:1.6;overflow-wrap:anywhere">${linked}</div></div></body></html>`}
  if(logoContent)payload.attachments=[{filename:'company-logo.png',content:logoContent,content_type:'image/png',content_id:'company-logo'}]
  if(emailPattern.test(business.email||''))payload.reply_to=business.email
  const fingerprint=await hash(JSON.stringify(payload))
  if(existing?.email_payload_hash&&existing.email_payload_hash!==fingerprint)throw new AccessError('The logo or sender information changed since this send. Check delivery activity before creating a new send.',409)
  if(!existing){const {error}=await db.from('messages').insert({id:requestId,business_id:businessId,customer_id:customer.id,[`${type}_id`]:documentId,direction:'outbound',channel:'email',recipient,subject,body:text,provider:'resend',status:'queued',email_payload_hash:fingerprint});if(error)throw new AccessError('Unable to record the send attempt. Retry the same request.',error.code==='23505'?409:500)}
  let provider:Response
  try{provider=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`owedly-${type}-${businessId}-${requestId}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)})}catch{throw new AccessError('The email provider did not confirm the outcome. Retry the same request, not a separate send.',504)}
  if(!provider.ok){await db.from('messages').update({status:'failed'}).eq('business_id',businessId).eq('id',requestId);throw new AccessError('The email provider did not accept this request. Retry the same send.',provider.status===429?429:502)}
  const sent=await provider.json();if(typeof sent.id!=='string')throw new AccessError('The provider returned an unexpected response. Retry this same request.',502)
  const now=new Date().toISOString(),[logUpdate,docUpdate]=await Promise.all([
   db.from('messages').update({status:'sent',provider_message_id:sent.id,sent_at:now}).eq('business_id',businessId).eq('id',requestId),
   db.from(table).update(type==='invoice'?{status:'sent',sent_at:now}:{status:'sent'}).eq('business_id',businessId).eq('id',documentId).eq('status','draft'),
  ])
  return response(req,200,{status:'accepted',email_id:sent.id,recipient:payload.to[0],warning:logUpdate.error||docUpdate.error?'Email accepted, but activity could not be fully updated. Do not resend just to update the status.':null})
 }catch(e){return failure(req,e)}
}
