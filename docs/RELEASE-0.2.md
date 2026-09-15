# Owedly 0.2 — payments, plans and reliability

## Implemented scope

- Merchant-owned Stripe, Venmo, PayPal, Square and Cash App payment links, business defaults and per-draft overrides, rendered on invoice previews, downloads, printed PDFs and Pro invoice emails. Links are not payment processing, connected-account onboarding, or automatic reconciliation. Only an explicit verified manual receipt updates a balance.
- Free Basic: 100 new invoices/estimates/change orders combined per UTC calendar month; 250 customers; 1,000 stored documents; one workspace and member; no AI, transcription, in-app email, hosted approval-link creation or logo/photo uploads. Additional jobs, appointments, reminders and messages have 1,000-row limits each. Existing records and exports remain available after a creation limit. Hosting/database costs still exist.
- Pro entitlements: 1,000 new documents/month; 5,000 customers; 20,000 stored documents; up to five members; one re-encoded PNG logo/photo up to 128 KiB; 50 AI parsing attempts, 50 voice transcription attempts and 250 email attempts/month. Attempts can count even when the provider fails. No automatic overages. Paid checkout is not configured: only trusted server-side subscription/trial activation may grant Pro.
- Expanded business dashboard: issued receivables, overdue amounts, recorded payments (before fees, not profit), estimates ready to invoice, due follow-ups, aging buckets, upcoming appointments, recent receipts and plan/storage usage. SQL aggregates are not limited to the displayed rows.
- Atomic invoice/estimate/change-order creation, draft editing with optimistic locking, accepted-estimate conversion, request fingerprints and idempotent manual payment recording. Correct percent-tax math and decimal rounding. Issued document/payment history is protected.
- Explicit AI/voice consent, Pro-only server gates and usage reservations before provider requests; verified one-minute PCM audio limits; server-authored proposals; user confirmation; atomic execution of confirmed actions.
- Business-scoped RLS and relationship constraints; restricted payment URL hosts; customer-facing output excludes internal notes; no card details or service keys in the browser; unneeded TRUNCATE/TRIGGER/REFERENCES grants removed.

## Migration order

Apply to a test project first, then the production project after validation:

1. `db/patches/commerce.sql`
2. `db/patches/ai-transactions.sql`
3. `db/patches/draft-editing.sql`
4. `db/patches/identity-and-retries.sql`
5. `db/patches/ai-payment-match.sql`
6. `db/patches/change-order-atomic.sql`

These patches target the existing Owedly schema; they are not a bootstrap for a blank database. Preserve a database backup before applying. Do not automatically rewrite previously issued document totals. No original customer records may be deleted to make a migration pass.

Deploy the five versioned Edge Functions together with their `_shared` dependencies after their SQL dependencies. JWT authentication remains enabled. The server must have its normal Supabase secrets plus `OPENAI_API_KEY` and `RESEND_API_KEY`; set `APP_BASE_URL` to the matching approved frontend origin. Never put service-role keys in Vite variables or the public repository.

## Verification and release boundaries

`npm run build`, `npm run test:unit`, browser regression checks and Deno checks/tests are mandatory. Database regression scripts run in transactions and roll back their synthetic fixtures. Browser and provider tests use mocked APIs and cannot prove actual inbox delivery, real card settlement or real-device microphone operation.

Before inviting external users: verify the live hosting deployment, DNS, sign-up/recovery redirects and SMTP, actual provider credentials, complete workflows on actual iPhones, backup restoration, error monitoring and account deletion. This is still a web app: no iOS wrapper, signed build or App Store approval is implied.

Not included: automatic provider webhooks/reconciliation, card-on-file, subscription checkout, recurring billing, full accounting, partial refunds, tax filing, offline sync, native push notifications, platform-owner administration or independent penetration testing. Internal notes and exports contain business data; handle them accordingly.

## Competitive assessment

This release improves Owedly's focused estimate-to-invoice workflow and cost controls. It does not substantiate a claim of exceeding most competitors. Wave advertises unlimited free invoices/estimates plus bookkeeping; Square advertises recurring invoices, deposits and automated reminders; Jobber covers broader field-service operations; Zoho Invoice includes more mature billing/reporting workflows. Feature breadth, platform uptime and independently assessed security must be compared separately. Published vendor information is not an audit of either product.
