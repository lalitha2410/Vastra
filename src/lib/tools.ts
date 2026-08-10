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
    // Eligibility is already confirmed and a slot is already chosen by
    // this point (both required arguments above) — those aren't future
    // events, they're facts as of right now, so "Pickup Scheduled" is the
    // accurate starting status. Nothing later (courier pickup, refund
    // processing, exchange fulfillment) has actually happened yet, and
    // this app has no real event to trigger those — see useReturnAgent.ts,
    // which used to fake that progression on a timer and no longer does.
    status: 'Pickup Scheduled',
    slot,
    itemPrice: match.item.price,
    refundAmount,
    refundDestination,
    paymentMethod: match.order.paymentMethod,
    createdAt: now,
  };

  return { found: true, ticket };
}

// ---------------------------------------------------------------------
// sendBankDetailsLink
// ---------------------------------------------------------------------

export interface SendBankDetailsLinkResult {
  found: boolean;
  error?: string;
  alreadySent?: boolean;
  linkUrl?: string;
  sentToPhone?: string;
}

/**
 * The system prompt tells the model to say it'll send a COD customer a
 * secure link for bank details, but "say" is exactly the gap that let it
 * hallucinate having sent one when a customer asked "where is the link?" —
 * there was no tool backing the claim, so nothing stopped the model from
 * just asserting it. This is that tool: a real (mocked — no actual SMS
 * provider behind it, same "real tool, fake backend" pattern as every
 * other tool here) action the model must call before it's allowed to
 * claim a link was sent, with its own guardrails so it can't be called
 * somewhere it doesn't make sense:
 *  - refuses if the ticket isn't COD (Prepaid never needs bank details)
 *  - refuses if the resolution is exchange (no money moves either way)
 *  - idempotent on a second call — returns the same link/timestamp
 *    instead of pretending to send a fresh one, mirroring the duplicate-
 *    booking guard on createReturnTicket
 */
export function sendBankDetailsLinkTool(
  tickets: ReturnTicket[],
  ticketId: string,
  now: number = Date.now(),
): { result: SendBankDetailsLinkResult; ticket: ReturnTicket | null } {
  const ticket = tickets.find((t) => t.ticketId === ticketId);
  if (!ticket) return { result: { found: false, error: 'No ticket with that ID.' }, ticket: null };

  if (ticket.paymentMethod !== 'COD') {
    return {
      result: { found: false, error: `${ticket.ticketId} is ${ticket.paymentMethod}, not COD — no bank details link is needed.` },
      ticket: null,
    };
  }
  if (ticket.resolution !== 'refund') {
    return {
      result: { found: false, error: `${ticket.ticketId} is an exchange, not a refund — no bank details link is needed.` },
      ticket: null,
    };
  }

  if (ticket.bankDetailsLinkSentAt) {
    return {
      result: {
        found: true,
        alreadySent: true,
        linkUrl: `https://vastra.example/bank-details/${ticket.ticketId}`,
        sentToPhone: 'the customer\'s registered number',
      },
      ticket: null,
    };
  }

  const updated: ReturnTicket = { ...ticket, bankDetailsLinkSentAt: now };
  return {
    result: {
      found: true,
      linkUrl: `https://vastra.example/bank-details/${ticket.ticketId}`,
      sentToPhone: "the customer's registered number",
    },
    ticket: updated,
  };
}
