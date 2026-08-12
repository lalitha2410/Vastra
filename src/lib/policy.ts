import type { Order, OrderItem, ReturnReason } from '../types';

/**
 * Deterministic return-eligibility rules. The LLM never decides this itself —
 * it calls checkEligibility() and reports whatever comes back. A brand cannot
 * have a language model improvising refund policy; these are plain functions
 * a QA engineer can unit-test independently of any prompt.
 *
 * Two of these rules (`requiresPrescription`, `sealedOnly`) only ever fire
 * for items that carry those flags — see OrderItem in types.ts. Fashion
 * items never set them, so this same function produces identical behavior
 * for Vastra as it always has; WellNest's catalog is what makes the
 * pharmacy-specific rules real instead of dead code.
 */

export function daysSinceDelivery(deliveryDateIso: string, now: Date = new Date()): number {
  const delivered = new Date(deliveryDateIso);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((now.getTime() - delivered.getTime()) / msPerDay);
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  daysSinceDelivery: number;
  returnWindowDays: number;
  daysRemaining: number;
  finalSale: boolean;
  requiresPrescription: boolean;
  /** True whenever the item is sealed-only, regardless of whether that's
   * actually what blocked eligibility this call — lets the model see the
   * constraint on the very first check (before a reason is even known)
   * and proactively ask about seal condition, rather than only learning
   * about the rule from the refusal itself. */
  sealedOnly: boolean;
}

/**
 * `reason` and `itemCondition` are optional and only matter for the
 * `sealedOnly` rule: they're unknown at the FIRST checkReturnEligibility
 * call (the system prompt checks eligibility before capturing a reason —
 * see systemPrompt.ts step 2 vs step 3), so that first call can only ever
 * report the sealed-only constraint as a heads-up, never enforce it. The
 * enforcement happens where reason (and, for a changed-mind return on a
 * sealed-only item, itemCondition) are actually known: createReturnTicket's
 * own re-check in tools.ts, the same place the window/final-sale rules are
 * already re-validated before anything is actually booked.
 */
export function checkEligibility(
  order: Order,
  item: OrderItem,
  now: Date = new Date(),
  reason?: ReturnReason,
  itemCondition?: 'sealed' | 'opened',
): EligibilityResult {
  const elapsed = daysSinceDelivery(order.deliveryDate, now);
  const windowDays = order.returnWindowDays;
  const withinWindow = elapsed <= windowDays;
  const reasons: string[] = [];

  if (item.requiresPrescription) {
    reasons.push('Prescription medicines cannot be returned once dispensed, for safety and regulatory reasons.');
  }
  if (item.finalSale && !item.requiresPrescription) {
    reasons.push('Item marked as final sale — not eligible for return or exchange.');
  }
  if (!withinWindow) {
    reasons.push(
      `Delivered ${elapsed} day(s) ago, which is outside the ${windowDays}-day return window.`,
    );
  }
  if (item.sealedOnly && reason === 'changed_mind' && itemCondition !== 'sealed') {
    reasons.push(
      'This item can only be returned unopened, in its original sealed packaging — a "changed my mind" return needs the seal intact.',
    );
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    daysSinceDelivery: elapsed,
    returnWindowDays: windowDays,
    daysRemaining: Math.max(0, windowDays - elapsed),
    finalSale: item.finalSale,
    requiresPrescription: Boolean(item.requiresPrescription),
    sealedOnly: Boolean(item.sealedOnly),
  };
}
