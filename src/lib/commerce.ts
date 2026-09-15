export type PaymentProvider = 'stripe'|'venmo'|'paypal'|'square'|'cashapp'
export type PaymentLink = { provider: PaymentProvider; url: string }
export const providerNames: Record<PaymentProvider,string> = {stripe:'Stripe',venmo:'Venmo',paypal:'PayPal',square:'Square',cashapp:'Cash App'}
const patterns: Record<PaymentProvider,RegExp> = {
 stripe: /^https:\/\/(buy\.stripe\.com|invoice\.stripe\.com|checkout\.stripe\.com)\/[A-Za-z0-9/?&=_%.~+:#-]+$/,
 venmo: /^https:\/\/(www\.|account\.)?venmo\.com\/[A-Za-z0-9/?&=_%.~+:#-]+$/,
 paypal: /^https:\/\/(paypal\.me|www\.paypal\.com|paypal\.com)\/[A-Za-z0-9/?&=_%.~+:#-]+$/,
 square: /^https:\/\/(square\.link|invoice\.squareup\.com)\/[A-Za-z0-9/?&=_%.~+:#-]+$/,
 cashapp: /^https:\/\/cash\.app\/\$[A-Za-z0-9_-]+\/?$/,
}
export function validatePaymentLinks(links: PaymentLink[]): PaymentLink[] {
 if (!Array.isArray(links)||links.length>5) throw new Error('Choose up to five payment services.')
 const seen=new Set<string>()
 return links.map(link=>{
  const url=String(link.url).trim()
  if(seen.has(link.provider)) throw new Error('Only one link per provider is allowed.')
  seen.add(link.provider)
  if(!patterns[link.provider]?.test(url)||url.length>1000||/[\s<>"\\]/.test(url)||/%(0a|0d|09|00)/i.test(url)) throw new Error(`Use an official ${providerNames[link.provider]||'payment provider'} HTTPS payment link. Custom domains are not supported.`)
  const parsed=new URL(url)
  if(parsed.username||parsed.password||parsed.port) throw new Error('Payment links cannot contain credentials or a port.')
  return {provider:link.provider,url}
 })
}
export function errorMessage(error: unknown, fallback='Something went wrong. Please try again.'): string {
 if(error && typeof error==='object' && 'message' in error && typeof error.message==='string') return error.message
 return fallback
}
export function money(value: number|string, currency='USD'): string {
 return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(Number(value))
}
export function localDate(timeZone='America/New_York', date=new Date()): string {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
 const part=(name:string)=>parts.find(p=>p.type===name)!.value
 return `${part('year')}-${part('month')}-${part('day')}`
}
export function dateLabel(value: string|null|undefined):string {
 if(!value) return 'Not specified'
 return new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString()
}
// Convert decimal input to hundredths without floating-point multiplication.
export function hundredths(value: number|string): bigint {
 const s=String(value).trim()
 if(!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Use a non-negative number with at most two decimal places.')
 const [whole,decimal='']=s.split('.')
 const result=BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'))
 if(result>100000000000n) throw new Error('This amount is too large.')
 return result
}
const divideRounded=(n:bigint,d:bigint)=>(n+d/2n)/d
export type LineInput={description:string;quantity:number|string;unit_price:number|string;tax_rate?:number|string}
export function calculateLines(lines: LineInput[]) {
 if(!lines.length||lines.length>50) throw new Error('Add between one and 50 line items.')
 let subtotal=0n, tax=0n
 const items=lines.map(line=>{
  if(!line.description.trim()||line.description.length>1000) throw new Error('Each line needs a description of up to 1,000 characters.')
  const q=hundredths(line.quantity),p=hundredths(line.unit_price),r=hundredths(line.tax_rate||0)
  if(q<=0n||q>10000000n||p>1000000000n||r>10000n) throw new Error('Check quantity, price, and tax. Tax must be between 0 and 100%.')
  const base=divideRounded(q*p,100n),lineTax=divideRounded(base*r,10000n)
  subtotal+=base;tax+=lineTax
  return {...line,quantity:Number(q)/100,unit_price:Number(p)/100,tax_rate:Number(r)/100,line_total:Number(base)/100,tax_amount:Number(lineTax)/100}
 })
 if(subtotal+tax>999999999999n) throw new Error('Document total exceeds the supported amount.')
 return {items,subtotal:Number(subtotal)/100,tax_amount:Number(tax)/100,total:Number(subtotal+tax)/100}
}
export function customerName(customer: any):string {
 const c=Array.isArray(customer)?customer[0]:customer
 return [c?.first_name,c?.last_name].filter(Boolean).join(' ')||c?.company||'Customer'
}
export function escapeHtml(value: unknown):string {
 return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
}
