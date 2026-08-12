export interface Scenario {
  id: string;
  label: string;
  message: string;
}

/**
 * Scripted openers for "Play scenario" — lets a live demo run without typing.
 * Each references a specific seeded order (or, for the six status/existing-
 * return scenarios, a specific pre-seeded ticket — see seedTickets.ts) so
 * the outcome is deterministic.
 *
 * Every scenario here is exactly one message — a realistic FIRST thing a
 * customer would send, not a scripted multi-turn transcript. Two of them
 * ("Exchange → then ask to switch to refund" and "Invalid numbered option")
 * are inherently about the customer's SECOND message — the opener gets the
 * conversation to the right starting point (an exchange offer on the
 * table, a numbered reason menu pending), and the label says what to type
 * next to finish the demonstration live, same as any real conversation
 * would continue.
 */
const scenariosByBrand: Record<string, Scenario[]> = {
  vastra: [
    {
      id: 'size_exchange',
      label: 'Size issue → exchange',
      message:
        "Hi! I got my order VS1001 yesterday but the kurta runs really tight — can I exchange it for a bigger size?",
    },
    {
      id: 'outside_window',
      label: 'Outside return window',
      message: "Hi, I'd like to return the shirt from order VS1004. It's just not really my style.",
    },
    {
      id: 'final_sale',
      label: 'Final sale item',
      message: "Hi, I want to return the gown from order VS1007 — turns out I don't need it after all.",
    },
    {
      id: 'multi_item',
      label: 'Multi-item order → which item',
      message: "Hi, I want to return something from my order VS1002 — not happy with it.",
    },
    {
      id: 'cod_refund',
      label: 'COD refund → bank details link',
      message: "Hi, the kurti I got in order VS1009 isn't what I expected, I'd like a refund please.",
    },
    {
      id: 'prepaid_refund',
      label: 'Prepaid refund → original payment method',
      message: "Hi, I'd like a refund for the dress in order VS1005, it just doesn't suit me.",
    },
    {
      id: 'exchange_then_refund_switch',
      label: 'Exchange → then ask to switch to refund',
      message: "Hi, the sneakers in order VS1006 are a bit too snug — can I exchange them for a bigger size?",
    },
    {
      id: 'wheres_my_refund',
      label: "Where's my refund? (status lookup)",
      message: "Hi, I returned an item from order VS1011 a while back — what's happening with my refund?",
    },
    {
      id: 'refund_overdue',
      label: 'Refund overdue → human handoff',
      message: "Hi, it's been 10 days since my order VS1011 return was refunded and I still haven't got the money.",
    },
    {
      id: 'reschedule_pickup',
      label: 'Reschedule pickup',
      message: "Hi, I need to change the pickup time for the return I booked on order VS1012.",
    },
    {
      id: 'cancel_allowed',
      label: 'Cancel return (allowed, before pickup)',
      message: "Hi, actually I've changed my mind — can you cancel the return I set up for order VS1013?",
    },
    {
      id: 'cancel_refused_refunded',
      label: 'Cancel return (refused, already refunded)',
      message: "Hi, I want to cancel my return for order VS1016 — please don't send the refund.",
    },
    {
      id: 'duplicate_attempt',
      label: 'Duplicate return attempt → blocked',
      message: "Hi, I'd like to return the blazer from order VS1012 as well.",
    },
    {
      id: 'nonexistent_ticket',
      label: 'Ask about a nonexistent ticket',
      message: "Hi, order VS1001 — what's the status of ticket RET-8888?",
    },
    {
      id: 'invalid_option',
      label: 'Invalid numbered option (then reply with an out-of-range number)',
      message: "Hi, I want to return the t-shirts from order VS1020, they're not what I expected.",
    },
  ],
  wellnest: [
    {
      id: 'size_exchange',
      label: 'Size issue → exchange',
      message:
        'Hi, I ordered order WN2007 but the knee support is too loose on me — could I exchange it for a smaller size?',
    },
    {
      id: 'outside_window',
      label: 'Outside return window',
      message: "Hi, I want to return the weighing scale from order WN2004, it's not reading accurately.",
    },
    {
      id: 'final_sale',
      label: 'Final sale item',
      message: "Hi, I'd like to return the Amoxicillin strip from order WN2002, I no longer need it.",
    },
    {
      id: 'multi_item',
      label: 'Multi-item order → which item',
      message: "Hi, I want to return something from order WN2001 — not satisfied with it.",
    },
    {
      id: 'cod_refund',
      label: 'COD refund → bank details link',
      message: "Hi, the glucometer strips in order WN2006 arrived damaged, I'd like a refund please.",
    },
    {
      id: 'prepaid_refund',
      label: 'Prepaid refund → original payment method',
      message: "Hi, I'd like a refund for the whey protein in order WN2003, it's not what I ordered.",
    },
    {
      id: 'exchange_then_refund_switch',
      label: 'Exchange → then ask to switch to refund',
      message: "Hi, the N95 masks in order WN2005 are the wrong box size — can I exchange for a different pack?",
    },
    {
      id: 'wheres_my_refund',
      label: "Where's my refund? (status lookup)",
      message: "Hi, I returned an item from order WN2008 a while back — what's happening with my refund?",
    },
    {
      id: 'refund_overdue',
      label: 'Refund overdue → human handoff',
      message: "Hi, it's been 6 days since my order WN2008 return was refunded and I still haven't received the money.",
    },
    {
      id: 'reschedule_pickup',
      label: 'Reschedule pickup',
      message: "Hi, I need to change the pickup time for the return I booked on order WN2009.",
    },
    {
      id: 'cancel_allowed',
      label: 'Cancel return (allowed, before pickup)',
      message: "Hi, actually I've changed my mind — can you cancel the return I set up for order WN2009?",
    },
    {
      id: 'cancel_refused_refunded',
      label: 'Cancel return (refused, already refunded)',
      message: "Hi, I want to cancel my return for order WN2008 — please don't send the refund.",
    },
    {
      id: 'duplicate_attempt',
      label: 'Duplicate return attempt → blocked',
      message: "Hi, I'd like to return the nebulizer from order WN2009 as well.",
    },
    {
      id: 'nonexistent_ticket',
      label: 'Ask about a nonexistent ticket',
      message: "Hi, order WN2007 — what's the status of ticket RET-8888?",
    },
    {
      id: 'invalid_option',
      label: 'Invalid numbered option (then reply with an out-of-range number)',
      message: "Hi, I want to return the sunscreen from order WN2010, it caused a skin reaction.",
    },
  ],
};

export function getScenarios(brandId: string): Scenario[] {
  return scenariosByBrand[brandId] ?? [];
}
