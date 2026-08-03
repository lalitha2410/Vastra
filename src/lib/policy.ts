import type { Order, OrderItem } from '../types';

/**
 * Deterministic return-eligibility rules. The LLM never decides this itself —
 * it calls checkEligibility() and reports whatever comes back. A brand cannot
 * have a language model improvising refund policy; these are plain functions
 * a QA engineer can unit-test independently of any prompt.
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
}

export function checkEligibility(order: Order, item: OrderItem, now: Date = new Date()): EligibilityResult {
  const elapsed = daysSinceDelivery(order.deliveryDate, now);
  const windowDays = order.returnWindowDays;
  const withinWindow = elapsed <= windowDays;
  const reasons: string[] = [];

  if (item.finalSale) {
    reasons.push('Item marked as final sale — not eligible for return or exchange.');
  }
  if (!withinWindow) {
    reasons.push(
      `Delivered ${elapsed} day(s) ago, which is outside the ${windowDays}-day return window.`,
    );
  }

  return {
    eligible: !item.finalSale && withinWindow,
    reasons,
    daysSinceDelivery: elapsed,
    returnWindowDays: windowDays,
    daysRemaining: Math.max(0, windowDays - elapsed),
    finalSale: item.finalSale,
  };
}
