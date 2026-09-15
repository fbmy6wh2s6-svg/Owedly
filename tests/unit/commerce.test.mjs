import {test} from 'node:test'
import assert from 'node:assert/strict'
import {calculateLines,validatePaymentLinks,localDate,customerName,escapeHtml,hundredths} from '../../.test-build/src/lib/commerce.js'
import {wavDuration} from '../../.test-build/supabase/functions/_shared/wav.js'
const line=(price=100,tax=7,q=1)=>({description:'Service',quantity:q,unit_price:price,tax_rate:tax})
test('tax percentage agrees with server: $100 at 7% is $107',()=>assert.equal(calculateLines([line()]).total,107))
test('line and tax rounding are deterministic in cents',()=>{const r=calculateLines([line('0.05','10','1'),line('1.01','7','1.5')]);assert.equal(r.subtotal,1.57);assert.equal(r.tax_amount,.12);assert.equal(r.total,1.69)})
test('0.1 plus 0.2 is exactly 30 cents',()=>assert.equal(calculateLines([line('0.1',0),line('0.2',0)]).total,.3))
test('zero price is allowed; zero quantity is not',()=>{assert.equal(calculateLines([line(0,0)]).total,0);assert.throws(()=>calculateLines([line(2,0,0)]))})
test('invalid, infinite, negative and fractional-cent inputs rejected',()=>{for(const n of [-1,NaN,Infinity,'1e4','.01','0.001'])assert.throws(()=>hundredths(n));assert.throws(()=>calculateLines([line(1,101)]))})
test('description and item-count limits enforced',()=>{assert.throws(()=>calculateLines([]));assert.throws(()=>calculateLines(Array(51).fill(line())));assert.throws(()=>calculateLines([{...line(),description:'x'.repeat(1001)}]))})
test('five supported official payment providers accepted',()=>{const links=[{provider:'stripe',url:'https://buy.stripe.com/test_123'},{provider:'venmo',url:'https://venmo.com/business-test'},{provider:'paypal',url:'https://paypal.me/example'},{provider:'square',url:'https://square.link/u/example'},{provider:'cashapp',url:'https://cash.app/$Example'}];assert.equal(validatePaymentLinks(links).length,5)})
test('payment URL scheme, phishing hosts, credentials, CRLF and duplicate providers rejected',()=>{for(const url of ['javascript:alert(1)','http://buy.stripe.com/a','https://buy.stripe.com.evil.test/a','https://user@buy.stripe.com/a','https://buy.stripe.com:443/a','https://buy.stripe.com/a%0Aanything','https://buy.stripe.com/a\\b'])assert.throws(()=>validatePaymentLinks([{provider:'stripe',url}]));assert.throws(()=>validatePaymentLinks([{provider:'venmo',url:'https://venmo.com/a'},{provider:'venmo',url:'https://venmo.com/b'}]))})
test('business dates respect timezone at month boundary',()=>assert.equal(localDate('America/New_York',new Date('2026-10-01T01:00:00Z')),'2026-09-30'))
test('embedded customer object and array shapes display correctly',()=>{assert.equal(customerName({first_name:'Test',last_name:'User'}),'Test User');assert.equal(customerName([{company:'Acme'}]),'Acme')})
test('customer text is HTML escaped',()=>assert.equal(escapeHtml('<img src=x onerror="x"> &'), '&lt;img src=x onerror=&quot;x&quot;&gt; &amp;'))
function wav(seconds){const n=Math.round(seconds*32000),b=new ArrayBuffer(44+n),v=new DataView(b),s=(o,t)=>[...t].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));s(0,'RIFF');v.setUint32(4,36+n,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,n,true);return new Uint8Array(b)}
test('WAV duration measured from server-visible PCM bytes',()=>assert.equal(wavDuration(wav(30)),30))
test('long or forged audio cannot bypass duration limits',()=>{assert.throws(()=>wavDuration(wav(62)));const b=wav(1);new DataView(b.buffer).setUint32(4,10,true);assert.throws(()=>wavDuration(b));assert.throws(()=>wavDuration(new Uint8Array(0)))})
