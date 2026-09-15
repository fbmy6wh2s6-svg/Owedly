# Owedly build scope and plan rules

Updated September 13, 2026.

## Owner-requested changes

Resume building Owedly. Add an onboarding dropdown for the specific field or type of business so quote assistance can use relevant business context. Offer a free manual-entry estimate/invoice tier. The owner explicitly changed the free allowance from 10 to **5**. Pro is **USD 19.99** and includes voice-to-text, change orders, and up to **50 voice-to-text prompts**.

## Working interpretations, not additional confirmed requirements

- Interpret the free tier as manually entered documents (without paid voice/AI generation), not as a decision about SMS delivery.
- Treat the allowance as **five estimates and invoices combined per month**, not five of each. The owner did not explicitly specify the reset period; monthly was disclosed as the working interpretation in the conversation.
- Treat Pro as USD 19.99 per month, with one shared allowance of 50 voice prompts per monthly subscription period. Do not reset on page refresh, device change, or re-login.
- Continue manual Pro document creation after voice usage is exhausted. No separate Pro manual-document ceiling has been requested; the initial code uses no cap. This is an implementation assumption, not a separately approved unlimited-use promise.
- A voice prompt used for a change order consumes the same voice allowance as a prompt used for an estimate or invoice. Fifty is a prompt allowance, not a cap of fifty change orders.
- Proposed counting policy: first issuance of a unique estimate or invoice counts once; drafts, edits, retries, and resends do not count again. Issuing an invoice converted from an estimate counts as a second document. Deleting a document must not restore quota. This policy requires integration and has not been activated.
- Proposed voice policy: a successful user-submitted recording counts once; a failed request or idempotent retry does not count again. Duration limits, rollover, typed-AI usage, and add-on purchases remain undecided. Do not add automatic overage charges.

## Industry onboarding and quote assistance

The dropdown remains part of the requested build. Persist the selection per business, allow later changes, and keep a general/other option. Candidate categories include handyman/home repair, fencing, painting, cleaning, lawn care/landscaping, pressure washing, parking-lot restriping, auto detailing, plumbing, electrical, HVAC, roofing, flooring, concrete, and remodeling. These category names are context labels, not a claim that specialized calculation engines for every trade exist.

Quote assistance should use the selected industry, services, and business-approved prices. It should ask for missing quantities and rates, show the source of reused prices, calculate totals deterministically, and require user review before sending. Do not imply that choosing an industry trains a model, that one business's information is shared with others, or that local prices, regulations, and material quantities can be invented. Historical-price retrieval and richer personalization are separate implementation tasks.

## What this branch implements

- `src/lib/plans.ts`: immutable Free/Pro definitions, combined-document allowance helpers, a separate voice allowance helper, change-order entitlement checks, and invalid-input rejection.
- `tests/plans.test.mjs`: six unit tests covering the five-document boundary, 50-prompt boundary, plan pricing, unsupported values, frozen configuration, and continued manual Pro use after voice exhaustion.

These helpers are a foundation only. They do **not** establish a user's actual subscription and are not yet imported into the application screens or server functions. No live database, live entitlement, Stripe product/price, payment collection, or customer subscription was changed by this branch. The industry dropdown and its persistence are not implemented in this branch.

## Required next integration work

1. Persist industry and business-approved quoting context under existing business access controls; implement and test onboarding and settings.
2. Add server-owned subscription state. Only verified billing events or authorized administration may grant Pro; users must never self-upgrade by editing client state or profile metadata.
3. Implement server-authoritative combined usage across every issuance path, including AI actions, conversions, links, email, and exports as determined by the final counting policy. Enforce atomically with idempotency and concurrency tests.
4. Enforce Pro voice and change-order entitlements at server boundaries, not only with hidden buttons. Reserve voice capacity before paid work, finalize or release reliably, and prevent parallel requests exceeding quota.
5. Show actual usage and reset dates from the server. Preserve read/export access to existing records on downgrade. Implement paid checkout and subscription management only after test-mode verification.
6. Verify Free counts 1 through 5, blocks a sixth new counted document, shares counts between estimates and invoices, and does not double-count retries. Verify 49/50/51 voice boundaries, reset periods, failures, and downgrades.

## Validation performed

The new TypeScript module passed standalone strict compilation with TypeScript 5.8.3. All six Node unit tests passed locally. This is **not** a complete application build, browser test, production quota test, or end-to-end Stripe test.

After installing the existing development dependencies, run:

```sh
node --test tests/plans.test.mjs
npx tsc --noEmit --strict --target ES2020 --module ESNext src/lib/plans.ts
npm run build
```

Use the existing Owedly test environment for integration. Do not activate production restrictions or charges merely by merging these configuration helpers.
