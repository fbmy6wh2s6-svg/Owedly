import {test,expect} from '@playwright/test'
import fs from 'node:fs/promises'
const b='11111111-1111-4111-8111-111111111111',c='44444444-4444-4444-8444-444444444444',uid='33333333-3333-4333-8333-333333333333'
const user={id:uid,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}
const customer={id:c,business_id:b,first_name:'Sample',last_name:'Customer',company:null,email:'payer@example.test',archived:false}
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII='
async function setup(page,{pro=false,quota=false,dashboardError=false,brand=false}={}){
 const exp=Math.floor(Date.now()/1000)+3600,token=[{alg:'HS256',typ:'JWT'},{sub:uid,role:'authenticated',aud:'authenticated',exp}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.test-signature'
 await page.addInitScript(s=>localStorage.setItem('sb-example-auth-token',JSON.stringify(s)),{access_token:token,refresh_token:'test-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user})
 const state={invoices:[],estimates:[],invoice_items:[],estimate_items:[],payments:[],customers:[customer],reminders:[],requests:[],profile:{id:b,name:'Sample Services',email:'office@example.test',phone:'555-0100',timezone:'America/New_York',currency:'USD'},settings:{payment_links:[{provider:'stripe',url:'https://buy.stripe.com/test_123'},{provider:'venmo',url:'https://venmo.com/SampleBusiness'}],payment_instructions:'Include your invoice number.'},logo:brand?png:null,counter:0}
 const id=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++state.counter).padStart(12,'0')}`
 function newDoc(kind,payload){const key=kind+'s',rid=id(),items=(payload.items||[]).map((item,index)=>({...item,id:id(),[kind+'_id']:rid,line_total:Math.round(item.quantity*item.unit_price*100)/100,sort_order:index}));const subtotal=items.reduce((s,i)=>s+i.line_total,0),tax=items.reduce((s,i)=>s+Math.round(i.line_total*i.tax_rate)/100,0);const doc={id:rid,business_id:b,customer_id:payload.customer_id,[kind+'_number']:(kind==='invoice'?'INV':'EST')+'-'+(1001+state[key].length),status:'draft',issue_date:new Date().toISOString().slice(0,10),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),subtotal,tax_amount:tax,total:subtotal+tax,amount_paid:0,balance_due:subtotal+tax,notes:payload.notes||'',customer_message:payload.customer_message||'',...state.settings};state[key].unshift(doc);state[kind+'_items'].push(...items);return doc}
 await page.route('https://example.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,table=path.split('/').pop();let body;try{body=req.postDataJSON()}catch{}
  state.requests.push({table,method:req.method(),body,url:url.href})
  const json=(data,status=200,count)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*',...(count===undefined?{}:{'content-range':`0-${Math.max(0,count-1)}/${count}`})},body:JSON.stringify(data)})
  if(req.method()==='OPTIONS')return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}})
  if(table==='user')return json(user)
  if(table==='logout')return route.fulfill({status:204})
  if(table==='business_members')return json({business_id:b,role:'owner',businesses:{id:b,name:state.profile.name}})
  if(table==='businesses'){if(req.method()==='PATCH'){Object.assign(state.profile,body);return route.fulfill({status:204})}return json(state.profile)}
  if(table==='get_plan_usage')return json({plan:pro?'pro':'free',period_end:'2026-10-01',documents_used:quota?100:state.invoices.length+state.estimates.length,documents_limit:pro?1000:100,stored_documents:state.invoices.length+state.estimates.length,stored_limit:pro?20000:1000,customers_used:state.customers.length,customers_limit:pro?5000:250,ai_used:0,ai_limit:pro?50:0,voice_used:0,voice_limit:pro?50:0,email_used:0,email_limit:pro?250:0,logo_bytes_limit:pro?131072:0})
  if(table==='business_settings'){if(req.method()==='POST'){state.settings=body;return route.fulfill({status:201})}return json(state.settings)}
  if(table==='business_branding'){if(req.method()==='POST'){state.logo=body.logo_data_url;return route.fulfill({status:201})}if(req.method()==='DELETE'){state.logo=null;return route.fulfill({status:204})}return json(pro&&state.logo?{logo_data_url:state.logo}:null)}
  if(table==='get_dashboard_metrics'){if(dashboardError)return json({message:'Test service unavailable'},503);const issued=state.invoices.filter(i=>!['draft','void'].includes(i.status));return json({today:new Date().toISOString().slice(0,10),timezone:'America/New_York',outstanding:issued.reduce((s,i)=>s+i.balance_due,0),open_count:issued.filter(i=>i.balance_due>0).length,overdue:0,overdue_count:0,draft_count:state.invoices.filter(i=>i.status==='draft').length,collected_month:state.payments.reduce((s,p)=>s+p.amount,0),customer_count:state.customers.length,awaiting_estimates:0,accepted_estimates:state.estimates.filter(e=>e.status==='accepted').length,failed_emails:0,aging:{current:issued.reduce((s,i)=>s+i.balance_due,0),days_1_30:0,days_31_60:0,days_61_90:0,days_90_plus:0}})}
  if(table==='create_document')return json(newDoc(body.document_kind,body.payload))
  if(table==='update_draft_document'){const doc=state[body.document_kind+'s'].find(d=>d.id===body.document_id);const originalNumber=doc[body.document_kind+'_number'];const updated=newDoc(body.document_kind,body.payload);state[body.document_kind+'s']=state[body.document_kind+'s'].filter(d=>d.id!==updated.id);state[body.document_kind+'_items']=state[body.document_kind+'_items'].filter(i=>i[body.document_kind+'_id']!==doc.id).map(i=>i[body.document_kind+'_id']===updated.id?{...i,[body.document_kind+'_id']:doc.id}:i);Object.assign(doc,updated,{id:doc.id,[body.document_kind+'_number']:originalNumber});return json(doc)}
  if(table==='convert_estimate_to_invoice'){const est=state.estimates.find(d=>d.id===body.target_estimate_id);const inv=newDoc('invoice',{customer_id:c,items:state.estimate_items.filter(i=>i.estimate_id===est.id),customer_message:est.customer_message,notes:est.notes});est.status='converted';return json(inv.id)}
  if(table==='record_manual_payment'){const inv=state.invoices.find(i=>i.id===body.invoice_id),p={id:id(),invoice_id:inv.id,amount:body.payment_amount,method:body.payment_method,status:'succeeded',paid_at:new Date().toISOString()};state.payments.push(p);inv.amount_paid+=p.amount;inv.balance_due=Math.round((inv.total-inv.amount_paid)*100)/100;inv.status=inv.balance_due===0?'paid':'partial';return json(p)}
  if(table==='send-invoice-email'||table==='send-document-email')return json({status:'accepted',recipient:customer.email,email_id:'test-email'})
  if(['invoices','estimates'].includes(table)){
   const eq=url.searchParams.get('id')?.replace('eq.','');let rows=state[table]
   if(eq)rows=rows.filter(i=>i.id===eq)
   if(req.method()==='PATCH'){Object.assign(rows[0],body);return json(rows[0])}
   if(url.searchParams.has('due_date'))rows=[]
   if(req.headers()['accept']?.includes('vnd.pgrst.object'))return json({...rows[0],customers:customer})
   return json(rows.map(r=>({...r,customers:customer})),200,rows.length)
  }
  if(table==='invoice_items'||table==='estimate_items'){const fk=table==='invoice_items'?'invoice_id':'estimate_id',eq=url.searchParams.get(fk)?.replace('eq.','');return json(state[table].filter(i=>!eq||i[fk]===eq))}
  if(table==='payments')return json(state.payments.map(p=>({...p,invoices:{invoice_number:state.invoices.find(i=>i.id===p.invoice_id)?.invoice_number,customers:customer}})),200,state.payments.length)
  if(table==='customers'){if(req.method()==='POST'){const row={...body,id:id(),created_at:new Date().toISOString()};state.customers.push(row);return json(row,201)}return json(state.customers)}
  if(table==='reminders'){if(req.method()==='POST'){state.reminders.push({...body,id:id()});return route.fulfill({status:201})}return json([])}
  if(['appointments','messages','jobs','properties','change_orders','user_profiles'].includes(table))return json([])
  return json({message:`Unexpected mock request ${table}`},400)
 })
 page.on('dialog',dialog=>dialog.accept())
 await page.goto('/')
 await expect(page.getByRole('heading',{name:'Your business, at a glance.'})).toBeVisible()
 return state
}
async function nav(page,name,mobile=false){if(mobile&&name==='Settings & plan')await page.locator('.mobile-nav').getByRole('button',{name:'More'}).click();const scope=mobile?(name==='Settings & plan'?page.locator('.mobile-more-sheet'):page.locator('.mobile-nav')):page.locator('.sidebar');await scope.getByRole('button',{name,exact:true}).click()}
async function create(page,kind='invoice'){
 await page.getByRole('button',{name:`+ New ${kind}`}).click()
 const form=page.getByRole('dialog')
 await form.getByLabel('Customer',{exact:true}).selectOption(c)
 await form.getByLabel('Description 1',{exact:true}).fill('Repair <script>alert(1)</script>')
 await form.getByLabel('Unit price 1',{exact:true}).fill('100')
 await form.getByLabel('Tax percent 1',{exact:true}).fill('7')
 await form.getByLabel('Message to customer',{exact:true}).fill('Thank you for your business.')
 await form.getByLabel('Internal notes — never shared').fill('PRIVATE-DO-NOT-SEND')
 await expect(form.getByText('Total $107.00',{exact:true})).toBeVisible()
 await form.getByRole('button',{name:`Create ${kind}`,exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.frameLocator('.document-preview').getByText('PRIVATE-DO-NOT-SEND')).toHaveCount(0)
}
test('complete free invoice flow: create, preview, download, partial and full payment, dashboard',async({page})=>{
 const s=await setup(page);await nav(page,'Invoices');await create(page)
 const frame=page.frameLocator('.document-preview')
 await expect(frame.getByRole('link',{name:'Pay with Stripe',exact:true})).toHaveAttribute('href','https://buy.stripe.com/test_123')
 await expect(frame.getByRole('link',{name:'Pay with Venmo',exact:true})).toHaveAttribute('href','https://venmo.com/SampleBusiness')
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download document'}).click();const file=await download;const out='test-results/free-invoice.html';await file.saveAs(out);const html=await fs.readFile(out,'utf8');expect(html).not.toContain('PRIVATE-DO-NOT-SEND');expect(html).toContain('&lt;script&gt;');expect(html).toContain('https://venmo.com/SampleBusiness')
 await page.getByRole('button',{name:'Mark shared manually'}).click()
 await page.getByRole('button',{name:'Record payment received'}).click()
 const pay=page.getByRole('dialog');await pay.getByLabel('Amount',{exact:true}).fill('40');await expect(pay.getByRole('button',{name:'Record verified payment'})).toBeDisabled();await pay.getByRole('checkbox').check();await pay.getByRole('button',{name:'Record verified payment'}).click();await expect(page.getByRole('dialog')).toHaveCount(0)
 expect(s.invoices[0].balance_due).toBe(67)
 await page.getByRole('button',{name:'Record payment received'}).click();await page.getByRole('dialog').getByRole('checkbox').check();await page.getByRole('dialog').getByRole('button',{name:'Record verified payment'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(s.invoices[0].status).toBe('paid')
 await expect(frame.getByRole('link',{name:'Pay with Stripe',exact:true})).toHaveCount(0)
 await nav(page,'Dashboard');await expect(page.getByText('Payments recorded this month')).toBeVisible();await expect(page.locator('.metric-card').filter({hasText:'Payments recorded'})).toContainText('$107.00')
 expect(s.requests.filter(r=>['ai-command','transcribe-voice','send-invoice-email','send-document-email'].includes(r.table))).toHaveLength(0)
 await page.screenshot({path:'test-results/desktop-dashboard.png',fullPage:true})
})
test('estimate creation, offline acceptance and conversion preserve totals',async({page})=>{const s=await setup(page);await nav(page,'Estimates');await create(page,'estimate');await page.getByRole('button',{name:'Record acceptance'}).click();await page.getByRole('button',{name:'Create invoice'}).click();await expect(page.getByRole('heading',{name:'INV-1001'})).toBeVisible();expect(s.invoices[0].total).toBe(107);expect(s.estimates[0].status).toBe('converted')})
test('draft can be edited without creating another document',async({page})=>{const s=await setup(page);await nav(page,'Invoices');await create(page);await page.getByRole('button',{name:'Edit draft'}).click();await page.getByRole('dialog').getByLabel('Unit price 1',{exact:true}).fill('200');await page.getByRole('dialog').getByRole('button',{name:'Save draft'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(s.invoices).toHaveLength(1);expect(s.invoices[0].total).toBe(214)})
test('free settings exclude upload and AI controls while saving own payment links',async({page})=>{const s=await setup(page);await nav(page,'Settings & plan');await expect(page.locator('input[type=file]')).toHaveCount(0);await page.getByLabel('Venmo payment link',{exact:true}).fill('https://venmo.com/NewBusiness');await page.getByRole('button',{name:'Save payment options'}).click();await expect(page.getByRole('status')).toContainText('Payment options saved');expect(s.settings.payment_links.find(l=>l.provider==='venmo').url).toBe('https://venmo.com/NewBusiness');await expect(page.locator('.voice-fab')).toHaveCount(0)})
test('payment links with a lookalike hostname are not saved',async({page})=>{const s=await setup(page);await nav(page,'Settings & plan');await page.getByLabel('Stripe payment link',{exact:true}).fill('https://buy.stripe.com.evil.example/pay');await page.getByRole('button',{name:'Save payment options'}).click();await expect(page.getByRole('alert')).toContainText('official Stripe');expect(s.requests.filter(r=>r.table==='business_settings'&&r.method==='POST')).toHaveLength(0)})
test('creation stops at the free quota but data remains accessible',async({page})=>{await setup(page,{quota:true});await nav(page,'Invoices');await expect(page.getByRole('button',{name:'+ New invoice'})).toBeDisabled();await nav(page,'Settings & plan');await expect(page.getByRole('button',{name:'Export workspace records'})).toBeEnabled()})
test('paid branding is present in invoice preview and paid email requires confirmation',async({page})=>{const s=await setup(page,{pro:true,brand:true});await nav(page,'Invoices');await create(page);await expect(page.frameLocator('.document-preview').getByRole('img')).toHaveAttribute('src',png);await page.getByRole('button',{name:'Email customer',exact:true}).click();expect(s.requests.filter(r=>r.table==='send-invoice-email')).toHaveLength(0);await page.getByRole('button',{name:'Send invoice',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'accepted for delivery'})).toBeVisible();expect(s.requests.filter(r=>r.table==='send-invoice-email')).toHaveLength(1)})
test('phone-sized invoice and expandable dashboard do not overflow',async({page})=>{await page.setViewportSize({width:390,height:844});await setup(page);await expect(page.getByText('Receivables aging',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await nav(page,'Invoices',true);await create(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:'test-results/mobile-invoice.png',fullPage:true});await nav(page,'Settings & plan',true);await expect(page.getByRole('heading',{name:'Settings & plan',exact:true})).toBeVisible()})
test('failed dashboard load never claims there is no work due',async({page})=>{await setup(page,{dashboardError:true});await expect(page.getByRole('alert')).toContainText('Dashboard unavailable');await expect(page.getByText('No overdue invoices, unsent drafts, or failed emails in this view.')).toHaveCount(0)})
