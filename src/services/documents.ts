import {supabase} from '../lib/supabase'
import {calculateLines,escapeHtml,customerName,money,providerNames,validatePaymentLinks,type PaymentLink,type LineInput} from '../lib/commerce'
import type {Workspace} from './workspace'
export type Kind='invoice'|'estimate'
export type DocumentRow={id:string;business_id:string;customer_id:string;invoice_number?:string;estimate_number?:string;status:string;issue_date:string;due_date?:string|null;expires_on?:string|null;subtotal:number;tax_amount:number;total:number;amount_paid?:number;balance_due?:number;notes?:string;customer_message?:string;updated_at:string;payment_links?:PaymentLink[];payment_instructions?:string;customers:any}
export type DocumentDetail={document:DocumentRow;items:LineInput[];payments:any[]}
export async function listDocuments(businessId:string,kind:Kind,page=0){
 const table=kind==='invoice'?'invoices':'estimates'
 const {data,error,count}=await supabase.from(table).select(`*,customers:customers!${table}_customer_id_fkey(id,first_name,last_name,company,email,phone)`,{count:'exact'}).eq('business_id',businessId).order('created_at',{ascending:false}).range(page*50,page*50+49)
 if(error) throw new Error(error.message)
 return {rows:(data||[]) as unknown as DocumentRow[],count:count||0}
}
export async function getDocument(businessId:string,kind:Kind,id:string):Promise<DocumentDetail>{
 const table=kind==='invoice'?'invoices':'estimates'
 const [doc,items,payments]=await Promise.all([
 supabase.from(table).select(`*,customers:customers!${table}_customer_id_fkey(id,first_name,last_name,company,email,phone)`).eq('business_id',businessId).eq('id',id).single(),
 supabase.from(kind==='invoice'?'invoice_items':'estimate_items').select('id,description,quantity,unit_price,tax_rate,line_total,sort_order').eq('business_id',businessId).eq(`${kind}_id`,id).order('sort_order'),
 kind==='invoice'?supabase.from('payments').select('id,amount,method,status,paid_at,notes').eq('business_id',businessId).eq('invoice_id',id).order('paid_at',{ascending:false}):Promise.resolve({data:[],error:null}),
 ])
 for(const result of [doc,items,payments])if(result.error)throw new Error(result.error.message)
 return {document:doc.data as unknown as DocumentRow,items:items.data||[],payments:payments.data||[]}
}
export async function createDocument(businessId:string,kind:Kind,requestId:string,input:{customer_id:string;due_date?:string;expires_on?:string;notes?:string;customer_message?:string;items:LineInput[]}){
 const checked=calculateLines(input.items)
 const {data,error}=await supabase.rpc('create_document',{target_business_id:businessId,document_kind:kind,request_id:requestId,payload:{...input,items:checked.items}})
 if(error)throw new Error(error.message)
 return data as DocumentRow
}
export async function updateDraft(businessId:string,kind:Kind,id:string,updatedAt:string,input:any){
 const checked=calculateLines(input.items)
 const {data,error}=await supabase.rpc('update_draft_document',{target_business_id:businessId,document_kind:kind,document_id:id,expected_updated_at:updatedAt,payload:{...input,items:checked.items}})
 if(error)throw new Error(error.message)
 return data as DocumentRow
}
export async function changeDocumentStatus(businessId:string,kind:Kind,id:string,status:string){
 const {error,data}=await supabase.from(kind==='invoice'?'invoices':'estimates').update({status}).eq('business_id',businessId).eq('id',id).select('id').single()
 if(error)throw new Error(error.message)
 return data
}
export async function setInvoicePaymentOptions(businessId:string,id:string,links:PaymentLink[],instructions:string){
 const {error}=await supabase.from('invoices').update({payment_links:validatePaymentLinks(links),payment_instructions:instructions}).eq('business_id',businessId).eq('id',id).eq('status','draft').select('id').single()
 if(error)throw new Error(error.message)
}
export function documentHtml(detail:DocumentDetail,workspace:Workspace):string{
 const d=detail.document,w=workspace.profile,invoice=!!d.invoice_number,title=invoice?'Invoice':'Estimate',number=d.invoice_number||d.estimate_number||title
 const e=escapeHtml,m=(v:number|string)=>e(money(v,w.currency))
 const links=invoice&&d.status!=='void'&&Number(d.balance_due)>0?validatePaymentLinks(d.payment_links||[]):[]
 const logo=workspace.plan.plan==='pro'&&workspace.logo?.startsWith('data:image/png;base64,')?`<img class="logo" src="${e(workspace.logo)}" alt="Company logo">`:''
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${e(number)} — ${e(w.name)}</title><style>body{font-family:Arial,sans-serif;color:#172033;max-width:820px;margin:36px auto;padding:20px;line-height:1.5}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:3px solid #172033;padding-bottom:24px}h1,h2,p{margin:0 0 10px}.logo{max-width:170px;max-height:100px;object-fit:contain;margin-bottom:12px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:12px 8px;text-align:right;border-bottom:1px solid #dce1e9}th:first-child,td:first-child{text-align:left;max-width:320px;overflow-wrap:anywhere}small,.muted{color:#596579}.totals{margin-left:auto;width:280px}.totals p{display:flex;justify-content:space-between}.total{font-size:21px;font-weight:bold}.message{white-space:pre-wrap;overflow-wrap:anywhere;margin:24px 0}.pay{display:inline-block;border:1px solid #172033;border-radius:6px;padding:10px 16px;margin:4px;text-decoration:none;color:#172033}.payment-url{font-size:11px;overflow-wrap:anywhere}footer{border-top:1px solid #dce1e9;margin-top:30px;padding-top:15px;font-size:12px}@media(max-width:550px){body{margin:0;padding:18px}header{display:block}th,td{padding:8px 3px;font-size:13px}.totals{width:100%}}@media print{body{margin:0;max-width:none;padding:0}.pay{padding:5px}tr{break-inside:avoid}header,footer{break-inside:avoid}}</style></head><body><header><div>${logo}<h2>${e(w.name)}</h2><p>${e([w.address_line1,w.city,w.state,w.postal_code].filter(Boolean).join(', '))}</p><p>${e([w.email,w.phone].filter(Boolean).join(' · '))}</p></div><div><h1>${title}</h1><strong>${e(number)}</strong><p class="muted">${e(d.status.toUpperCase())}</p></div></header><section style="margin-top:24px"><p><strong>${invoice?'Bill to':'Prepared for'}: ${e(customerName(d.customers))}</strong></p><p>Issued ${e(d.issue_date)}${d.due_date?` · Due ${e(d.due_date)}`:''}${d.expires_on?` · Valid through ${e(d.expires_on)}`:''}</p></section><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th>Amount</th></tr></thead><tbody>${detail.items.map(i=>`<tr><td>${e(i.description)}</td><td>${e(i.quantity)}</td><td>${m(i.unit_price)}</td><td>${e(i.tax_rate||0)}%</td><td>${m((i as any).line_total??calculateLines([i]).subtotal)}</td></tr>`).join('')}</tbody></table><div class="totals"><p><span>Subtotal</span><span>${m(d.subtotal)}</span></p><p><span>Tax</span><span>${m(d.tax_amount)}</span></p><p class="total"><span>Total</span><span>${m(d.total)}</span></p>${invoice?`<p><span>Paid</span><span>${m(d.amount_paid||0)}</span></p><p class="total"><span>Balance due</span><span>${m(d.balance_due||0)}</span></p>`:''}</div>${d.customer_message?`<div class="message">${e(d.customer_message)}</div>`:''}${links.length?`<section><h2>Payment options</h2>${links.map(l=>`<div><a class="pay" href="${e(l.url)}" rel="noopener noreferrer" target="_blank">Pay with ${e(providerNames[l.provider])}</a><p class="payment-url">${e(l.url)}</p></div>`).join('')}<p class="muted">You will leave Owedly. Verify the business, amount (${m(d.balance_due||0)}), currency and reference ${e(number)} before paying. Provider fees may apply. Payment is confirmed separately by the business.</p></section>`:''}${invoice&&d.payment_instructions?`<div class="message">${e(d.payment_instructions)}</div>`:''}<footer>${workspace.plan.plan==='free'?'Created with Owedly · ':''}This ${title.toLowerCase()} contains only customer-facing information. ${invoice?'Keep your payment receipt.':'This estimate is not a payment receipt.'}</footer></body></html>`
}
export function downloadText(filename:string,text:string,mime='text/plain'){
 const blob=new Blob([text],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export async function printDocument(html:string){
 const frame=document.createElement('iframe');frame.style.position='fixed';frame.style.width='0';frame.style.height='0';frame.style.border='0';frame.setAttribute('title','Printable document');frame.srcdoc=html;document.body.appendChild(frame)
 await new Promise<void>((resolve,reject)=>{frame.onload=()=>resolve();setTimeout(()=>reject(new Error('The print preview did not load. Download the HTML document instead.')),10000)})
 const win=frame.contentWindow;if(!win){frame.remove();throw new Error('Printing is unavailable.')}
 await Promise.all([...win.document.images].map(i=>i.decode().catch(()=>{})))
 win.addEventListener('afterprint',()=>frame.remove(),{once:true});win.focus();win.print();setTimeout(()=>frame.remove(),120000)
}
export async function exportWorkspace(businessId:string){
 const tables=['businesses','business_members','customers','properties','jobs','estimates','estimate_items','invoices','invoice_items','payments','reminders','appointments','change_orders','change_order_items','business_settings','messages']
 const out:Record<string,unknown>={format:'owedly-export-v1',exported_at:new Date().toISOString()}
 for(const table of tables){const rows:unknown[]=[];let offset=0;for(;;){const {data,error}=await supabase.from(table).select('*').eq(table==='businesses'?'id':'business_id',businessId).order(table==='business_members'?'user_id':table==='business_settings'?'business_id':'id').range(offset,offset+499);if(error)throw new Error(`Export failed for ${table}: ${error.message}`);rows.push(...data);if(data.length<500)break;offset+=500;}out[table]=rows}
 downloadText(`owedly-export-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(out,null,2),'application/json')
}
