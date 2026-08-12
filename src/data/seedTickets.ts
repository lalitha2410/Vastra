import type { BrandConfig } from '../config/brand';
import type { Order, PickupSlot, ReturnTicket } from '../types';

/**
 * Pre-existing return tickets, seeded into state on every Reset/brand
 * switch (see resetAllFor in useReturnAgent.ts) alongside the empty
 * conversations — NOT created through the normal agent flow.
 *
 * Six of the twelve new scenarios in scenarios.ts (status lookup, overdue
 * refund, reschedule, both cancel outcomes, duplicate-attempt) are
 * fundamentally about a return ALREADY in progress — there's no way to
 * demonstrate "where's my refund" from a single scripted opener if nothing
 * has ever been returned yet. Real support tools constantly field
 * questions about returns that started before the current conversation;
 * this is that same shape, just authored instead of grown organically.
 *
 * IDs deliberately use a 5000/6000 range, well clear of the 1000+ range
 * `ticketSeqRef` hands out to newly created tickets (see
 * useReturnAgent.ts) — the two ranges never need to know about each other
 * or collide, regardless of how many new tickets a demo session creates.
 *
 * Several scenarios intentionally share the same seed ticket (e.g.
 * "Reschedule pickup" and "Duplicate return attempt" both point at the
 * same Pickup Scheduled ticket) — each scenario is played from a fresh
 * Reset in isolation, so there's no conflict, and it keeps WellNest's
 * smaller 10-order catalog from running out of headroom.
 */

function daysAgoMs(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

/** Mirrors getPickupSlotsTool's own label format (tools.ts) so a seeded
 * slot reads identically to one the tool would have generated. */
function slotLabel(offsetDays: number): { label: string; date: string } {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return {
    label: d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }) + ', 9 AM – 12 PM',
    date: d.toISOString().slice(0, 10),
  };
}

function pastSlot(daysAgoOffset: number): PickupSlot {
  const { label, date } = slotLabel(-daysAgoOffset);
  return { slotId: 'seed-past', label, date };
}

function futureSlot(daysAhead: number): PickupSlot {
  const { label, date } = slotLabel(daysAhead);
  return { slotId: 'seed-future', label, date };
}

function findItem(catalog: Order[], orderId: string, itemId: string) {
  const order = catalog.find((o) => o.orderId === orderId);
  const item = order?.items.find((i) => i.itemId === itemId);
  if (!order || !item) throw new Error(`seedTickets: ${orderId}/${itemId} not found in catalog`);
  return { order, item };
}

function ticketFor(
  catalog: Order[],
  ticketId: string,
  orderId: string,
  itemId: string,
  opts: {
    status: ReturnTicket['status'];
    reason: ReturnTicket['reason'];
    createdDaysAgo: number;
    slot: PickupSlot;
  },
): ReturnTicket {
  const { order, item } = findItem(catalog, orderId, itemId);
  return {
    ticketId,
    orderId: order.orderId,
    customerName: order.customerName,
    itemId: item.itemId,
    itemName: item.name,
    itemImageUrl: item.imageUrl,
    reason: opts.reason,
    resolution: 'refund',
    status: opts.status,
    slot: opts.slot,
    itemPrice: item.price,
    refundAmount: item.price,
    refundDestination: 'Original payment method',
    paymentMethod: order.paymentMethod,
    createdAt: daysAgoMs(opts.createdDaysAgo),
  };
}

export function vastraSeedTickets(catalog: Order[]): ReturnTicket[] {
  return [
    // Refunded well outside the settlement window — backs "Where's my
    // refund?" and "Refund overdue → human handoff".
    ticketFor(catalog, 'RET-5001', 'VS1011', 'VS1011-1', {
      status: 'Refunded',
      reason: 'changed_mind',
      createdDaysAgo: 12,
      slot: pastSlot(11),
    }),
    // Refunded — backs "Cancel (refused, already refunded)".
    ticketFor(catalog, 'RET-5002', 'VS1016', 'VS1016-1', {
      status: 'Refunded',
      reason: 'quality',
      createdDaysAgo: 9,
      slot: pastSlot(8),
    }),
    // Still Pickup Scheduled — backs "Reschedule pickup" and "Duplicate
    // return attempt → blocked".
    ticketFor(catalog, 'RET-5003', 'VS1012', 'VS1012-1', {
      status: 'Pickup Scheduled',
      reason: 'changed_mind',
      createdDaysAgo: 1,
      slot: futureSlot(2),
    }),
    // Still Pickup Scheduled — backs "Cancel (allowed, before pickup)".
    ticketFor(catalog, 'RET-5004', 'VS1013', 'VS1013-1', {
      status: 'Pickup Scheduled',
      reason: 'not_as_described',
      createdDaysAgo: 1,
      slot: futureSlot(1),
    }),
  ];
}

export function wellnestSeedTickets(catalog: Order[]): ReturnTicket[] {
  return [
    // Refunded — backs "Where's my refund?", "Refund overdue", and
    // "Cancel (refused, already refunded)".
    ticketFor(catalog, 'RET-6001', 'WN2008', 'WN2008-1', {
      status: 'Refunded',
      reason: 'quality',
      createdDaysAgo: 8,
      slot: pastSlot(7),
    }),
    // Still Pickup Scheduled — backs "Reschedule pickup", "Cancel
    // (allowed)", and "Duplicate return attempt → blocked".
    ticketFor(catalog, 'RET-6002', 'WN2009', 'WN2009-1', {
      status: 'Pickup Scheduled',
      reason: 'not_as_described',
      createdDaysAgo: 1,
      slot: futureSlot(1),
    }),
  ];
}

/** Dispatches to the right brand's seed set — the only thing
 * useReturnAgent.ts needs to call. */
export function seedTicketsFor(brand: BrandConfig): ReturnTicket[] {
  return brand.id === 'wellnest' ? wellnestSeedTickets(brand.catalog) : vastraSeedTickets(brand.catalog);
}
