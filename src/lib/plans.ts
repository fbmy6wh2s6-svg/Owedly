/** Shared product rules. These are not a substitute for server-side entitlements. */
export type PlanId = 'free' | 'pro'
export type DocumentKind = 'estimate' | 'invoice' | 'change_order'

export interface PlanDefinition {
  readonly id: PlanId
  readonly name: string
  readonly currency: 'USD'
  readonly monthlyPriceCents: number
  readonly combinedDocumentLimit: number | null
  readonly voicePromptLimit: number
  readonly changeOrdersIncluded: boolean
}

export const PLANS: Readonly<Record<PlanId, Readonly<PlanDefinition>>> = Object.freeze({
  free: Object.freeze({
    id: 'free',
    name: 'Free',
    currency: 'USD',
    monthlyPriceCents: 0,
    combinedDocumentLimit: 5,
    voicePromptLimit: 0,
    changeOrdersIncluded: false,
  }),
  pro: Object.freeze({
    id: 'pro',
    name: 'Pro',
    currency: 'USD',
    monthlyPriceCents: 1999,
    combinedDocumentLimit: null,
    voicePromptLimit: 50,
    changeOrdersIncluded: true,
  }),
})

export function getPlan(planId: PlanId): Readonly<PlanDefinition> {
  if (planId !== 'free' && planId !== 'pro') throw new Error('Unknown Owedly plan')
  return PLANS[planId]
}

function validateUsage(used: number): void {
  if (!Number.isSafeInteger(used) || used < 0) {
    throw new Error('Usage must be a non-negative safe integer')
  }
}

/** Supply a single server-authoritative count across estimates AND invoices. */
export function remainingDocuments(planId: PlanId, combinedUsed: number): number | null {
  const plan = getPlan(planId)
  validateUsage(combinedUsed)
  return plan.combinedDocumentLimit === null
    ? null
    : Math.max(0, plan.combinedDocumentLimit - combinedUsed)
}

/** Voice usage is separate from document usage; null is never returned. */
export function remainingVoicePrompts(planId: PlanId, successfulPrompts: number): number {
  const plan = getPlan(planId)
  validateUsage(successfulPrompts)
  return Math.max(0, plan.voicePromptLimit - successfulPrompts)
}

export function canIssueDocument(planId: PlanId, kind: DocumentKind, combinedUsed: number): boolean {
  const plan = getPlan(planId)
  const remaining = remainingDocuments(planId, combinedUsed)
  if (kind !== 'estimate' && kind !== 'invoice' && kind !== 'change_order') {
    throw new Error('Unknown document kind')
  }
  if (kind === 'change_order') return plan.changeOrdersIncluded
  return remaining === null || remaining > 0
}
