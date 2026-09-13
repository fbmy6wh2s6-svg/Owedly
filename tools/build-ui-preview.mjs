// Visual preview only. No production source edits, credentials, or live API access.
// The preview deliberately supplies synthetic data, not backend test evidence.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';

function createFixtures() {
  const business = { id: '11111111-1111-4111-8111-111111111111', name: 'Harbor Home Services', role: 'owner', timezone: 'America/New_York', currency: 'USD' };
  const stamp = '2026-09-13T12:34:00.000Z';
  const row = (id, values) => ({ id, business_id: business.id, created_at: stamp, updated_at: stamp, ...values });
  const customers = [
    row('customer-smith', { first_name: 'Bob', last_name: 'Smith', company: null, email: 'bob@example.test', phone: '(757) 555-0101', notes: 'Sample customer. Prefers afternoon appointments.', archived: false }),
    row('customer-johnson', { first_name: 'Amy', last_name: 'Johnson', company: null, email: 'amy@example.test', phone: '(757) 555-0102', notes: null, archived: false }),
    row('customer-williams', { first_name: 'David', last_name: 'Williams', company: null, email: 'david@example.test', phone: '(757) 555-0103', notes: null, archived: false }),
    row('customer-cafe', { first_name: null, last_name: null, company: 'Sample Corner Cafe', email: 'cafe@example.test', phone: '(757) 555-0104', notes: null, archived: false }),
  ];
  const cref = (i) => ({ customer_id: customers[i].id, customers: [customers[i]] });
  const jobs = [
    row('job-water', { ...cref(0), title: 'Water heater replacement', description: 'Replace existing water heater and test connections.', status: 'scheduled', scheduled_start: '2026-09-13T13:00:00.000Z', scheduled_end: '2026-09-13T15:00:00.000Z', completed_at: null }),
    row('job-lights', { ...cref(1), title: 'Kitchen lighting', description: 'Install kitchen fixtures and recessed lighting.', status: 'in_progress', scheduled_start: '2026-09-13T17:00:00.000Z', scheduled_end: '2026-09-13T19:00:00.000Z', completed_at: null }),
    row('job-bath', { ...cref(2), title: 'Bathroom fixture repair', description: 'Inspect and replace the leaking fixture.', status: 'scheduled', scheduled_start: '2026-09-15T14:00:00.000Z', scheduled_end: '2026-09-15T15:00:00.000Z', completed_at: null }),
    row('job-door', { ...cref(0), title: 'Entry door repair', description: 'Adjust hinges and replace weather seal.', status: 'completed', scheduled_start: '2026-09-04T14:00:00.000Z', scheduled_end: '2026-09-04T15:00:00.000Z', completed_at: '2026-09-04T15:00:00.000Z' }),
  ];
  const estimates = [
    row('estimate-smith', { ...cref(0), job_id: jobs[0].id, estimate_number: 'EST-1001', status: 'sent', issue_date: '2026-09-10', expires_on: '2026-09-24', subtotal: 1450, tax_amount: 0, total: 1450, notes: null, customer_message: 'Please review the proposed work and pricing below.' }),
    row('estimate-johnson', { ...cref(1), job_id: jobs[1].id, estimate_number: 'EST-1002', status: 'accepted', issue_date: '2026-09-09', expires_on: '2026-09-23', subtotal: 2200, tax_amount: 0, total: 2200, notes: null, customer_message: null }),
    row('estimate-williams', { ...cref(2), job_id: jobs[2].id, estimate_number: 'EST-1003', status: 'draft', issue_date: '2026-09-12', expires_on: '2026-09-26', subtotal: 425, tax_amount: 0, total: 425, notes: null, customer_message: null }),
  ];
  const invoices = [
    row('invoice-smith', { ...cref(0), job_id: jobs[0].id, invoice_number: 'INV-1001', status: 'partial', issue_date: '2026-08-30', due_date: '2026-09-10', subtotal: 1450, tax_amount: 0, total: 1450, amount_paid: 500, balance_due: 950, notes: 'Sample internal note: deposit recorded.', customer_message: 'Thank you for choosing Harbor Home Services.', sent_at: '2026-08-30T15:00:00.000Z', paid_at: null }),
    row('invoice-johnson', { ...cref(1), job_id: jobs[1].id, invoice_number: 'INV-1002', status: 'sent', issue_date: '2026-09-11', due_date: '2026-09-25', subtotal: 2200, tax_amount: 0, total: 2200, amount_paid: 0, balance_due: 2200, notes: null, customer_message: null, sent_at: stamp, paid_at: null }),
    row('invoice-door', { ...cref(0), job_id: jobs[3].id, invoice_number: 'INV-1003', status: 'paid', issue_date: '2026-09-04', due_date: '2026-09-18', subtotal: 325, tax_amount: 0, total: 325, amount_paid: 325, balance_due: 0, notes: null, customer_message: null, sent_at: '2026-09-04T15:00:00.000Z', paid_at: '2026-09-05T16:00:00.000Z' }),
  ];
  const changeOrders = [
    row('change-lights', { ...cref(1), job_id: jobs[1].id, jobs: [jobs[1]], job_title: jobs[1].title, change_order_number: 'CO-1001', title: 'Add two recessed lights', description: 'Supply and install two additional recessed lights in the kitchen.', reason: 'Customer requested additional lighting.', schedule_impact_days: 1, schedule_note: 'Adds one working day to completion.', issue_date: '2026-09-12', status: 'sent', subtotal: 595, tax_amount: 0, total: 595, approved_at: null, customer_message: null }),
    row('change-valve', { ...cref(0), job_id: jobs[0].id, jobs: [jobs[0]], job_title: jobs[0].title, change_order_number: 'CO-1002', title: 'Replace shutoff valve', description: 'Replace the worn shutoff valve.', reason: 'Existing valve is worn.', schedule_impact_days: 0, schedule_note: null, issue_date: '2026-09-13', status: 'draft', subtotal: 125, tax_amount: 0, total: 125, approved_at: null, customer_message: null }),
  ];
  const items = [
    row('line-labor', { invoice_id: invoices[0].id, estimate_id: estimates[0].id, description: 'Installation labor', quantity: 2, unit_price: 300, tax_rate: 0, line_total: 600, sort_order: 0 }),
    row('line-water', { invoice_id: invoices[0].id, estimate_id: estimates[0].id, description: 'Water heater', quantity: 1, unit_price: 850, tax_rate: 0, line_total: 850, sort_order: 1 }),
  ];
  const changeItems = [row('co-labor', { change_order_id: changeOrders[0].id, description: 'Additional lighting labor', quantity: 1, unit_price: 475, tax_rate: 0, line_total: 475, sort_order: 0 }), row('co-material', { change_order_id: changeOrders[0].id, description: 'Two recessed lights', quantity: 2, unit_price: 60, tax_rate: 0, line_total: 120, sort_order: 1 })];
  const data = {
    customers, jobs, estimates, invoices, change_orders: changeOrders, invoice_items: items, estimate_items: items, change_order_items: changeItems,
    businesses: [business], business_members: [{ business_id: business.id, role: 'owner', user_id: 'preview-user', businesses: [business] }],
    properties: [row('property-home', { customer_id: customers[0].id, label: 'Home', address_line1: '100 Sample Lane', address_line2: null, city: 'Chesapeake', state: 'VA', postal_code: '23322', access_notes: 'Sample address for this visual preview only.' })],
    payments: [row('payment-deposit', { invoice_id: invoices[0].id, invoices: [invoices[0]], amount: 500, method: 'check', status: 'succeeded', paid_at: '2026-09-02T16:00:00.000Z', notes: 'Sample deposit' }), row('payment-door', { invoice_id: invoices[2].id, invoices: [invoices[2]], amount: 325, method: 'cash', status: 'succeeded', paid_at: '2026-09-05T16:00:00.000Z', notes: null })],
    appointments: jobs.slice(0, 3).map((job, i) => row('appointment-' + i, { customer_id: job.customer_id, customers: job.customers, job_id: job.id, jobs: [job], title: job.title, starts_at: job.scheduled_start, ends_at: job.scheduled_end, status: i === 1 ? 'confirmed' : 'scheduled', notes: null })),
    reminders: [row('reminder-invoice', { customer_id: customers[0].id, invoice_id: invoices[0].id, estimate_id: null, job_id: null, kind: 'invoice_followup', due_at: '2026-09-13T12:00:00.000Z', status: 'pending', note: 'Follow up on Smith invoice' }), row('reminder-supplies', { customer_id: customers[1].id, invoice_id: null, estimate_id: null, job_id: jobs[1].id, kind: 'task', due_at: '2026-09-13T12:15:00.000Z', status: 'pending', note: 'Order recessed lights for kitchen job' })],
    messages: [row('message-demo', { invoice_id: invoices[0].id, customer_id: customers[0].id, direction: 'outbound', channel: 'system', body: 'Sample activity entry for this visual preview.', subject: null, recipient: null, status: 'sent', sent_at: '2026-09-10T14:00:00.000Z' })],
  };
  class Query {
    constructor(table) { this.table = table; this.tests = []; this.max = Infinity; this.one = false; this.head = false; this.sorts = []; }
    select(fields, options = {}) { this.head = !!options.head; return this; }
    eq(k, v) { this.tests.push(r => r[k] === v); return this; }
    neq(k, v) { this.tests.push(r => r[k] !== v); return this; }
    gt(k, v) { this.tests.push(r => r[k] != null && r[k] > v); return this; }
    gte(k, v) { this.tests.push(r => r[k] != null && r[k] >= v); return this; }
    lt(k, v) { this.tests.push(r => r[k] != null && r[k] < v); return this; }
    lte(k, v) { this.tests.push(r => r[k] != null && r[k] <= v); return this; }
    is(k, v) { return this.eq(k, v); }
    in(k, vs) { this.tests.push(r => vs.includes(r[k])); return this; }
    order(k, opts = {}) { this.sorts.push([k, opts.ascending !== false]); return this; }
    limit(n) { this.max = n; return this; }
    range(a, b) { this.start = a; this.max = b - a + 1; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    update() { this.write = true; return this; }
    insert() { this.write = true; return this; }
    delete() { this.write = true; return this; }
    then(done, fail) {
      if (this.write) return Promise.resolve({ data: null, error: new Error('Visual preview only: saving is disabled.') }).then(done, fail);
      let rows = new URLSearchParams(location.search).get('empty') === '1' ? [] : [...(data[this.table] || [])];
      rows = rows.filter(r => this.tests.every(t => t(r)));
      const count = rows.length;
      rows.sort((a, b) => { for (const [k, asc] of this.sorts) { const x = String(a[k] ?? '').localeCompare(String(b[k] ?? '')); if (x) return asc ? x : -x; } return 0; });
      rows = rows.slice(this.start || 0, (this.start || 0) + this.max);
      return Promise.resolve({ data: this.head ? null : this.one ? rows[0] || null : rows, count, error: null }).then(done, fail);
    }
  }
  const supabase = {
    from: table => new Query(table),
    auth: { signInWithPassword: async () => ({ error: new Error('Visual preview only. No real login occurs.') }), signUp: async () => ({ error: new Error('Visual preview only. No account is created.') }), signOut: async () => ({ error: null }) },
    functions: { invoke: async (name, args) => {
      if (name === 'customer-approval') {
        const co = String(args.body.token).includes('change');
        const completed = String(args.body.token).includes('complete');
        return { error: null, data: { business_name: business.name, document_type: co ? 'change_order' : 'estimate', document: co ? changeOrders[0] : estimates[0], items: co ? changeItems : items, customer: customers[co ? 1 : 0], expires_at: '2026-09-27T23:59:00.000Z', completed: completed ? { action: 'approved', typed_name: co ? 'Amy Johnson' : 'Bob Smith', amount: co ? 595 : 1450, created_at: stamp } : null } };
      }
      if (name === 'ai-command') return { error: null, data: { action_id: 'visual-preview-only', intent: 'create_change_order', requires_confirmation: true, confidence: 0.95, clarification_question: null, fields: { customer_name: 'Amy Johnson', job_title: 'Kitchen lighting', change_order_title: 'Add two recessed lights', schedule_impact_days: 1, line_items: [{ description: 'Additional lighting labor', quantity: 1, unit_price: 475, tax_rate: 0 }, { description: 'Two recessed lights', quantity: 2, unit_price: 60, tax_rate: 0 }] } } };
      if (name === 'create-approval-link') return { error: null, data: { approval_link_id: 'demo-only', token: 'DEMO-NOT-A-REAL-LINK', expires_at: '2026-09-27T23:59:00.000Z', relative_url: '/?approval=DEMO-NOT-A-REAL-LINK' } };
      return { data: null, error: new Error('Visual preview only. Live operations are disabled.') };
    } },
  };
  return { business, supabase };
}

mkdirSync('.ui-preview', { recursive: true });
mkdirSync('preview-assets', { recursive: true });
writeFileSync('.ui-preview/fixtures.js', 'const createFixtures = ' + createFixtures.toString() + ';\nexport const { business, supabase } = createFixtures();\n');
const cssImports = [...readFileSync('src/main.tsx', 'utf8').matchAll(/import\s+['"]\.\/([^'"]+\.css)['"]/g)].map(m => `import '../src/${m[1]}';`).join('\n');
writeFileSync('.ui-preview/entry.tsx', `import React from 'react';
import {createRoot} from 'react-dom/client';
import AppShell from '../src/components/AppShell';
import AuthScreen from '../src/components/AuthScreen';
import BusinessOnboarding from '../src/components/BusinessOnboarding';
import CustomerApprovalPage from '../src/pages/CustomerApprovalPage';
import {business} from './fixtures';
${cssImports}
const params = new URLSearchParams(location.search);
const screen = params.get('screen');
const app = screen === 'auth' ? <AuthScreen/> : screen === 'onboarding' ? <BusinessOnboarding onCreated={()=>{}}/> : screen === 'approval' ? <CustomerApprovalPage token={params.get('document') || 'estimate'}/> : <AppShell business={business}/>;
createRoot(document.getElementById('root')!).render(<React.StrictMode>{app}</React.StrictMode>);
`);
await build({ entryPoints: ['.ui-preview/entry.tsx'], bundle: true, format: 'esm', outfile: 'preview-assets/app.js', jsx: 'automatic', minify: false, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'offline-preview-only', setup(b) { b.onResolve({ filter: /supabase$/ }, args => { if (resolve(args.resolveDir, args.path) === resolve('src/lib/supabase')) return { path: resolve('.ui-preview/fixtures.js') }; }); } }] });
writeFileSync('preview-assets/index.html', '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Owedly current UI - SAMPLE DATA PREVIEW</title><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>');
writeFileSync('preview-assets/README.txt', 'Owedly current-UI visual preview. UI source snapshot: d7680f9ae87dbdf61188d68d2b2df3f4b613a8b7. All business records and AI responses are synthetic fixtures. No live services, real credentials, or database operations. Components and CSS are unchanged. This is not evidence of functional or native iOS testing. Serve the directory over local HTTP to view.');
cpSync('src', 'preview-assets/source-snapshot', { recursive: true });
console.log('Built offline visual preview with original UI and synthetic data.');
