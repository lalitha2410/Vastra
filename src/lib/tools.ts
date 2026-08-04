import type { Order, OrderItem, PickupSlot, ReturnReason, Resolution, ReturnTicket } from '../types';
import { checkEligibility } from './policy';

/**
 * Pure tool implementations. Each mirrors one function-calling tool exposed to the LLM.
 * They take the current catalog/state as plain arguments and return plain
 * data — no side effects, no fetch, no hidden state. src/hooks/useReturnAgent.ts
 * is the only place that wires these into React state (and thus the ops dashboard).
 */

export interface OrderSummary {
  orderId: string;
  customerName: string;
  deliveryDate: string;
  paymentMethod: string;
  items: { itemId: string; name: string; size: string; colour: string; price: number }[];
}

function summarize(order: Order): OrderSummary {
  return {
    orderId: order.orderId,
    customerName: order.customerName,
    deliveryDate: order.deliveryDate,
    paymentMethod: order.paymentMethod,
    items: order.items.map((i) => ({
      itemId: i.itemId,
      name: i.name,
      size: i.size,
      colour: i.colour,
      price: i.price,
    })),
  };
}

export interface LookupOrderResult {
  matchType: 'order_id' | 'phone' | 'none';
  orders: OrderSummary[];
}

export function lookupOrder(catalog: Order[], orderIdOrPhone: string): LookupOrderResult {
  const query = orderIdOrPhone.trim().toUpperCase();
  const byId = catalog.find((o) => o.orderId.toUpperCase() === query);
  if (byId) {
    return { matchType: 'order_id', orders: [summarize(byId)] };
  }

  const digits = orderIdOrPhone.replace(/\D/g, '');
  if (digits.length >= 6) {
    const byPhone = catalog.filter((o) => o.phone.replace(/\D/g, '').endsWith(digits.slice(-10)));
    if (byPhone.length > 0) {
      return { matchType: 'phone', orders: byPhone.map(summarize) };
    }
  }

  return { matchType: 'none', orders: [] };
}

function findOrderAndItem(
  catalog: Order[],
  orderId: string,
  itemId: string,
): { order: Order; item: OrderItem } | null {
  const order = catalog.find((o) => o.orderId.toUpperCase() === orderId.trim().toUpperCase());
  if (!order) return null;
  const item = order.items.find((i) => i.itemId === itemId);
  if (!item) return null;
  return { order, item };
}

export interface CheckEligibilityToolResult {
  found: boolean;
  eligible?: boolean;
  reasons?: string[];
  daysSinceDelivery?: number;
  returnWindowDays?: number;
  daysRemaining?: number;
  finalSale?: boolean;
  itemName?: string;
  price?: number;
}

export function checkReturnEligibilityTool(
  catalog: Order[],
  orderId: string,
  itemId: string,
): CheckEligibilityToolResult {
  const match = findOrderAndItem(catalog, orderId, itemId);
  if (!match) return { found: false };
  const result = checkEligibility(match.order, match.item);
  return {
    found: true,
    ...result,
    itemName: match.item.name,
    price: match.item.price,
  };
}

export interface GetAvailableSizesResult {
  found: boolean;
  itemName?: string;
  currentSize?: string;
  availableSizes?: string[];
}

export function getAvailableSizesTool(
  catalog: Order[],
  orderId: string,
  itemId: string,
): GetAvailableSizesResult {
  const match = findOrderAndItem(catalog, orderId, itemId);
  if (!match) return { found: false };
  return {
    found: true,
    itemName: match.item.name,
    currentSize: match.item.size,
    availableSizes: match.item.availableSizes,
  };
}

const SLOT_HOURS = [
  { label: '9 AM – 12 PM', offset: 1 },
  { label: '12 PM – 3 PM', offset: 2 },
  { label: '3 PM – 6 PM', offset: 3 },
];

export function getPickupSlotsTool(now: Date = new Date()): PickupSlot[] {
  return SLOT_HOURS.map(({ label, offset }, idx) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    const dateLabel = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
    return {
      slotId: `slot-${idx + 1}`,
      label: `${dateLabel}, ${label}`,
      date: d.toISOString().slice(0, 10),
    };
  });
}

export interface CreateReturnTicketInput {
  orderId: string;
  itemId: string;
  reason: ReturnReason;
  resolution: Resolution;
  slotId: string;
  exchangeSize?: string;
}

export interface CreateReturnTicketResult {
  found: boolean;
  ticket?: ReturnTicket;
  error?: string;
  /** True when this order+item already has an open ticket — see the
   * duplicate-booking guard below. `ticket` on this branch is the
   * *existing* ticket, not a newly created one; the caller must not treat
   * it as new (no re-adding to state, no re-scheduling progression). */
  alreadyBooked?: boolean;
}

/**
 * Deliberate duplicate-booking guard, not just a prompt instruction.
 * Surfaced by testing the voice channel: a phone call doesn't end when the
 * transaction does — the customer is still on the line, and anything they
 * say next still reaches the model as a fresh turn, so a chatty "thanks,
 * one more thing..." (or a stray "the first slot works great" left over
 * from an earlier turn) can read to the model as a new return request for
 * the same item and trigger a second createReturnTicket call. Chat mostly
 * avoids this — a typed message is only ever sent once, on enter — but the
 * guard applies to both channels since it costs nothing when unneeded and
 * a wrong duplicate ticket is a real (if rarer) risk there too. Telling
 * the model not to via the system prompt is necessary but not sufficient —
 * same reasoning as checkEligibility(): a rules engine a QA engineer can
 * unit-test beats trusting an LLM to remember a constraint across an
 * arbitrarily long conversation. `existingTickets` is the source of truth
 * here, not anything the model has said.
 */
export function createReturnTicketTool(
  catalog: Order[],
  input: CreateReturnTicketInput,
  ticketSequence: number,
  existingTickets: ReturnTicket[],
  now: number = Date.now(),
): CreateReturnTicketResult {
  const match = findOrderAndItem(catalog, input.orderId, input.itemId);
  if (!match) return { found: false, error: 'Order or item not found.' };

  const priorTicket = existingTickets.find(
    (t) => t.orderId === match.order.orderId && t.itemId === match.item.itemId,
  );
  if (priorTicket) {
    return {
      found: true,
      alreadyBooked: true,
      ticket: priorTicket,
      error: `This item already has an open return: ${priorTicket.ticketId} (${priorTicket.resolution}${
        priorTicket.resolution === 'exchange' ? ` to size ${priorTicket.exchangeSize}` : ''
      }, ${priorTicket.slot?.label ?? 'pickup scheduled'}). Do not create another ticket for it — just relay these details if the customer asks.`,
    };
  }

  const eligibility = checkEligibility(match.order, match.item, new Date(now));
  if (!eligibility.eligible) {
    return { found: false, error: `Not eligible: ${eligibility.reasons.join(' ')}` };
  }

  const slot = getPickupSlotsTool(new Date(now)).find((s) => s.slotId === input.slotId);
  if (!slot) return { found: false, error: 'Invalid pickup slot.' };

  const isRefund = input.resolution === 'refund';
  const refundAmount = isRefund ? match.item.price : 0;
  const refundDestination = !isRefund
    ? '—'
    : match.order.paymentMethod === 'Prepaid'
      ? 'Original payment method'
      : 'Bank transfer (account details required)';

  const ticket: ReturnTicket = {
    ticketId: `RET-${1000 + ticketSequence}`,
    orderId: match.order.orderId,
    customerName: match.order.customerName,
    itemId: match.item.itemId,
    itemName: match.item.name,
    itemImageUrl: match.item.imageUrl,
    reason: input.reason,
    resolution: input.resolution,
    exchangeSize: input.exchangeSize,
    status: 'Initiated',
    slot,
    itemPrice: match.item.price,
    refundAmount,
    refundDestination,
    paymentMethod: match.order.paymentMethod,
    createdAt: now,
  };

  return { found: true, ticket };
}
