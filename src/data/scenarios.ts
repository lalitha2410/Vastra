export interface Scenario {
  id: string;
  label: string;
  /** The realistic first message a customer would actually send — always
   * states everything up front (order, item, reason where relevant) so
   * the agent has no real information gap, only questions it might still
   * choose to ask anyway. */
  opener: string;
  /** Only present for scenarios that need a return already in progress to
   * ask something meaningful (status lookup, overdue refund, reschedule,
   * cancel, duplicate-attempt) — absent for scenarios that are just a
   * single realistic opener. Once the opener's setup produces a ticket
   * (reactively — see playScenario in useReturnAgent.ts, which answers
   * whatever the agent actually asks along the way, not a pre-guessed
   * script), optionally fast-forwards its status, then sends `message`. */
  followUp?: {
    message: string;
    /** How many times to fast-forward the setup ticket's status (the same
     * "Advance (demo)" mechanic a presenter would click by hand) before
     * `message` is sent — e.g. 2 to reach "Refunded" from the
     * "Pickup Scheduled" a ticket starts at. Omit for scenarios that only
     * need the ticket to exist, not to have progressed further. */
    advanceStatusTimes?: number;
  };
}

/**
 * Scripted openers (and, for a handful, a reactive follow-up — see
 * Scenario's own doc) for "Play scenario" — lets a live demo run without
 * typing. Each brand's list reflects what's actually realistic for that
 * vertical, not a reskin of the other's: WellNest's list has no "exchange
 * for a different size" scenario for a device, and encodes pharmacy-
 * specific concepts (damaged in transit, near-expiry stock, sealed-only
 * hygiene items, prescription refusal, device replacement) that simply
 * don't exist in Vastra's list at all.
 *
 * Nothing here pre-seeds ticket data — every ticket a scenario needs is
 * created live, through the same conversation a customer would have, the
 * first time it's asked about (see playScenario) — so the ops console is
 * genuinely empty until a visitor watches a return actually get created.
 */
const scenariosByBrand: Record<string, Scenario[]> = {
  vastra: [
    {
      id: 'size_exchange',
      label: 'Size issue → exchange',
      opener:
        "Hi! I got my order VS1001 yesterday but the kurta runs really tight — can I exchange it for a bigger size?",
    },
    {
      id: 'outside_window',
      label: 'Outside return window',
      opener: "Hi, I'd like to return the shirt from order VS1004. It's just not really my style.",
    },
    {
      id: 'final_sale',
      label: 'Final sale item',
      opener: "Hi, I want to return the gown from order VS1007 — turns out I don't need it after all.",
    },
    {
      id: 'multi_item',
      label: 'Multi-item order → which item',
      opener: "Hi, I want to return something from my order VS1002 — not happy with it.",
    },
    {
      id: 'cod_refund',
      label: 'COD refund → bank details link',
      opener: "Hi, the kurti I got in order VS1009 isn't what I expected, I'd like a refund please.",
    },
    {
      id: 'prepaid_refund',
      label: 'Prepaid refund → original payment method',
      opener: "Hi, I'd like a refund for the dress in order VS1005, it just doesn't suit me.",
    },
    {
      id: 'exchange_then_refund_switch',
      label: 'Exchange → then ask to switch to refund',
      opener: "Hi, the sneakers in order VS1006 are a bit too snug — can I exchange them for a bigger size?",
    },
    {
      id: 'wheres_my_refund',
      label: "Where's my refund? (status lookup)",
      opener:
        "Hi, I want to return the palazzo pants co-ord set from order VS1011, I've changed my mind and would like a refund.",
      followUp: {
        message: "What's the status of my return — has the refund gone through yet?",
        advanceStatusTimes: 2,
      },
    },
    {
      id: 'refund_overdue',
      label: 'Refund overdue → human handoff',
      opener:
        "Hi, I want to return the formal blazer from order VS1012, I've changed my mind and would like a refund.",
      followUp: {
        message: "It's been 10 days since this was refunded and I still haven't received the money.",
        advanceStatusTimes: 2,
      },
    },
    {
      id: 'reschedule_pickup',
      label: 'Reschedule pickup',
      opener: "Hi, I want to return the georgette dupatta set from order VS1013, it's not as described.",
      followUp: { message: 'Actually, can I change the pickup time for this?' },
    },
    {
      id: 'cancel_allowed',
      label: 'Cancel return (allowed, before pickup)',
      opener: "Hi, I want to return the formal trousers from order VS1014, I've changed my mind.",
      followUp: { message: 'Actually, can you cancel this return for me?' },
    },
    {
      id: 'cancel_refused_refunded',
      label: 'Cancel return (refused, already refunded)',
      opener: "Hi, I want to return the crew neck sweatshirt from order VS1016, I've changed my mind.",
      followUp: {
        message: "Please cancel my return — I don't want to send it back after all.",
        advanceStatusTimes: 2,
      },
    },
    {
      id: 'duplicate_attempt',
      label: 'Duplicate return attempt → blocked',
      opener: "Hi, I want to return the polo t-shirt from order VS1010, I've changed my mind.",
      followUp: { message: "I'd like to return the polo t-shirt from order VS1010 as well." },
    },
    {
      id: 'nonexistent_ticket',
      label: 'Ask about a nonexistent ticket',
      opener: "Hi, order VS1001 — what's the status of ticket RET-8888?",
    },
    {
      id: 'invalid_option',
      label: 'Invalid numbered option (then reply with an out-of-range number)',
      opener: "Hi, I want to return the t-shirts from order VS1020, they're not what I expected.",
    },
  ],
  wellnest: [
    {
      id: 'size_exchange',
      label: 'Size issue → exchange',
      opener:
        'Hi, I ordered order WN2007 but the knee support is too loose on me — could I exchange it for a smaller size?',
    },
    {
      id: 'outside_window',
      label: 'Outside return window',
      opener: "Hi, I want to return the weighing scale from order WN2004, it's not reading accurately.",
    },
    {
      id: 'prescription_refused',
      label: 'Prescription item → refused',
      opener: "Hi, I'd like to return the Amoxicillin strip from order WN2002, I no longer need it.",
    },
    {
      id: 'multi_item',
      label: 'Multi-item order → which item',
      opener: 'Hi, I want to return something from order WN2001 — not satisfied with it.',
    },
    {
      id: 'cod_refund',
      label: 'COD refund → bank details link',
      opener: "Hi, the glucometer strips in order WN2006 arrived damaged, I'd like a refund please.",
    },
    {
      id: 'damaged_in_transit',
      label: 'Damaged in transit',
      opener: 'Hi, the BP monitor in my order WN2001 arrived with a cracked screen.',
    },
    {
      id: 'wrong_item_delivered',
      label: 'Wrong item delivered',
      opener: 'Hi, I ordered whey protein but order WN2003 arrived with a completely different product.',
    },
    {
      id: 'expired_near_expiry',
      label: 'Expired / near-expiry product received',
      opener:
        'Hi, the multivitamin gummies in order WN2008 are already close to their expiry date — can I return them?',
    },
    {
      id: 'changed_mind_sealed_ok',
      label: 'Changed mind, still sealed → refund OK',
      opener:
        "Hi, I no longer need the N95 masks from order WN2005 — they're still sealed and unopened, can I get a refund?",
    },
    {
      id: 'changed_mind_opened_refused',
      label: 'Changed mind, already opened → refused',
      opener: "Hi, I opened the sunscreen from order WN2010 but changed my mind, can I return it?",
    },
    {
      id: 'device_faulty_replacement',
      label: 'Device faulty → replacement',
      opener: "Hi, the nebulizer from order WN2009 isn't turning on properly, I think it's faulty.",
    },
    {
      id: 'wheres_my_refund',
      label: "Where's my refund? (status lookup)",
      opener: "Hi, I want to return the whey protein from order WN2003, I've changed my mind and would like a refund.",
      followUp: {
        message: "What's the status of my return — has the refund gone through yet?",
        advanceStatusTimes: 2,
      },
    },
    {
      id: 'refund_overdue',
      label: 'Refund overdue → human handoff',
      opener: "Hi, I want to return the BP monitor from order WN2001, I've changed my mind and would like a refund.",
      followUp: {
        message: "It's been 6 days since this was refunded and I still haven't received the money.",
        advanceStatusTimes: 2,
      },
    },
    {
      id: 'reschedule_pickup',
      label: 'Reschedule pickup',
      opener: "Hi, I want to return the glucometer strips from order WN2006, I've changed my mind.",
      followUp: { message: 'Actually, can I change the pickup time for this?' },
    },
    {
      id: 'cancel_allowed',
      label: 'Cancel return (allowed, before pickup)',
      opener: "Hi, I want to return the knee support from order WN2007, I've changed my mind.",
      followUp: { message: 'Actually, can you cancel this return for me?' },
    },
    {
      id: 'cancel_refused_refunded',
      label: 'Cancel return (refused, already refunded)',
      opener: "Hi, I want to return the nebulizer from order WN2009, I've changed my mind.",
      followUp: {
        message: "Please cancel my return — I don't want to send it back after all.",
        advanceStatusTimes: 2,
      },
    },
    {
      id: 'duplicate_attempt',
      label: 'Duplicate return attempt → blocked',
      opener: "Hi, I want to return the whey protein from order WN2003, I've changed my mind.",
      followUp: { message: "I'd like to return the whey protein from order WN2003 as well." },
    },
    {
      id: 'nonexistent_ticket',
      label: 'Ask about a nonexistent ticket',
      opener: "Hi, order WN2007 — what's the status of ticket RET-8888?",
    },
    {
      id: 'invalid_option',
      label: 'Invalid numbered option (then reply with an out-of-range number)',
      opener: 'Hi, I want to return the sunscreen from order WN2010, it caused a skin reaction.',
    },
  ],
};

export function getScenarios(brandId: string): Scenario[] {
  return scenariosByBrand[brandId] ?? [];
}
