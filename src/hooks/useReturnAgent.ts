import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import { getBrandById, vastraBrand } from '../config/brand';
import type { Scenario } from '../data/scenarios';
import {
  statusSequenceFor,
  type CallLogEntry,
  type CallStatus,
  type Channel,
  type ChatMessage,
  type ReturnTicket,
  type TranscriptEntry,
} from '../types';
import {
  getActiveProvider,
  hasApiKey,
  sendAgentMessage,
  type ChatSession,
  type ToolExecutorMap,
} from '../lib/llmProvider';
import {
  createReturnTicketTool,
  getAvailableSizesTool,
  getPickupSlotsTool,
  lookupOrder,
  checkReturnEligibilityTool,
  sendBankDetailsLinkTool,
  lookupReturnTicketTool,
  listReschedulableSlotsTool,
  rescheduleReturnPickupTool,
  cancelReturnTicketTool,
  type CreateReturnTicketInput,
} from '../lib/tools';
import { buildSystemInstruction } from '../lib/systemPrompt';
import { buildVoiceSystemInstruction } from '../lib/voiceSystemPrompt';
import { useSpeechSynthesis } from './useSpeechSynthesis';

/**
 * ONE agent layer, TWO channels. Everything in the "shared" section below —
 * tickets, the ticket ID sequence, and (most importantly) buildExecutors —
 * is used by both the WhatsApp chat flow and the voice call flow. There is
 * exactly one createReturnTicket implementation, closing over the same
 * `tickets` state and the same duplicate-booking guard (see tools.ts),
 * regardless of which channel's LLM turn called it. That's what makes
 * "switch channel mid-demo, tickets persist" true structurally, not just
 * true by coincidence: there's only one ops backend to persist.
 *
 * What's genuinely separate per channel: each has its own conversation
 * transcript, its own ChatSession (so its own system prompt — see
 * lib/systemPrompt.ts vs lib/voiceSystemPrompt.ts), and its own
 * typing/tool-activity/streaming UI state, because a WhatsApp exchange and
 * a phone call are two independent conversations with the model, not one
 * conversation rendered two ways. Switching the `channel` view is a pure
 * UI toggle — it never touches either conversation's state.
 */

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Human-readable ops-console labels for each tool, shown live as the agent
// calls them — this is what turns the ~10-25s the model spends thinking
// into a visible systems walkthrough instead of dead air. Shared by both
// channels' activity banners.
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  lookupOrder: 'Looking up order…',
  checkReturnEligibility: 'Checking return eligibility…',
  getAvailableSizes: 'Fetching available sizes…',
  getPickupSlots: 'Fetching pickup slots…',
  createReturnTicket: 'Creating return ticket…',
  sendBankDetailsLink: 'Sending bank details link…',
  lookupReturnTicket: 'Looking up return ticket…',
  rescheduleReturnPickup: 'Checking reschedule options…',
  cancelReturnTicket: 'Cancelling return…',
};

const CHAT_THINKING_LABEL = 'Reading customer message…';
const VOICE_THINKING_LABEL = 'Listening to customer…';

function chatGreetingFor(brand: BrandConfig): string {
  if (brand.id === 'vastra') {
    return `Hi! I'm ${brand.agentName} from ${brand.name} 👋 I can help with a return or exchange on a recent order — what's going on?`;
  }
  return `Hello, I'm ${brand.agentName} from ${brand.name}. I can help with a return or exchange on a recent order. How can I help you today?`;
}

function callGreetingFor(brand: BrandConfig): string {
  return `Hi, this is ${brand.agentName} from ${brand.name}. I can help with a return or exchange on a recent order — what's going on?`;
}

function newSession(systemInstruction: string): ChatSession {
  return { messages: [{ role: 'system', content: systemInstruction }] };
}

export interface Stats {
  returnsToday: number;
  exchangeCount: number;
  refundCount: number;
  valueRetained: number;
}

function isQuotaError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw.includes('429') || lower.includes('quota') || lower.includes('rate limit');
}

/**
 * llmProvider.ts only sends the model a bounded recent-message window per
 * request (see buildRequestMessages there) — everything older is dropped
 * unless it's captured here first. This is the domain-specific half of
 * that trade: llmProvider.ts stays vendor-only and has no idea what
 * "order ID" or "reason" mean, so the facts worth remembering, and how to
 * extract them, live here instead.
 *
 * FLOW below is the explicit state machine this whole file is built
 * around, added after the same bug recurred three times — order/item,
 * then reason, then pickup slot — each fix adding its own one-off "is
 * this already known" guard to a single tool's handler, and each new
 * field forgetting the lesson the last one taught. `facts` is the single
 * source of truth; nothing else independently tracks "what's already
 * happened" or "what's still open" — it's always computed from `facts` by
 * currentPendingQuestion and stepStatus, never stored separately, so nine
 * different call sites can never drift out of sync with each other again.
 */
interface ConversationFacts {
  orderId?: string;
  itemId?: string;
  itemName?: string;
  paymentMethod?: string;
  eligible?: boolean;
  ineligibleReason?: string;
  reason?: string;
  availableSizes?: string[];
  resolution?: string;
  exchangeSize?: string;
  pickupSlots?: { slotId: string; label: string }[];
  pickupLabel?: string;
  ticketId?: string;
  /** The candidate list a pending 'item' question resolves against — see
   * currentPendingQuestion. Harmless to leave populated once itemId is
   * set (nothing reads it once the 'item' question stops being pending). */
  pendingItemOptions?: { itemId: string; name: string }[];
  /** Only true once sendBankDetailsLink actually ran (see tools.ts) —
   * this is what lets the summary tell the model "already sent, don't
   * send or claim to send again" instead of the model being the only
   * record of whether that happened. */
  bankDetailsLinkSent?: boolean;
  /** Reschedule-in-progress for an EXISTING ticket — deliberately separate
   * from pickupSlots/pickupLabel (the create-flow's own fields) so asking
   * about, or rescheduling, an existing ticket never touches the facts of
   * a return still being created in the same conversation. Armed when
   * listReschedulableSlotsTool succeeds (see updateFacts); cleared once
   * the customer's next reply resolves a choice, or the reschedule
   * completes/fails. */
  rescheduleTicketId?: string;
  rescheduleOfferedSlots?: { slotId: string; label: string }[];
  rescheduleNewSlotLabel?: string;
}

type PendingQuestion = 'item' | 'reason' | 'exchangeSize' | 'slot' | 'rescheduleSlot';

/**
 * The ordered steps of a return, in the order the system prompt walks
 * through them. Each step's `done` is a pure function of `facts` — the
 * ONLY place that decides whether a step is complete. `tools` is used
 * solely for the redundant-call diagnostic below (requirement: fail
 * loudly if the agent re-does a step it already finished), not for
 * control flow.
 */
interface FlowStep {
  id: 'order' | 'eligibility' | 'reason' | 'exchangeSize' | 'slot' | 'ticket' | 'bankLink';
  label: string;
  applies: (f: ConversationFacts) => boolean;
  done: (f: ConversationFacts) => boolean;
  tools: string[];
}

const FLOW: FlowStep[] = [
  {
    id: 'order',
    label: 'order and item identified',
    applies: () => true,
    done: (f) => Boolean(f.orderId && f.itemId),
    tools: ['lookupOrder'],
  },
  {
    id: 'eligibility',
    label: 'eligibility checked',
    applies: (f) => Boolean(f.orderId && f.itemId),
    done: (f) => f.eligible !== undefined,
    tools: ['checkReturnEligibility'],
  },
  {
    id: 'reason',
    label: 'return reason captured',
    applies: (f) => f.eligible === true,
    done: (f) => Boolean(f.reason),
    tools: [], // captured positionally (see currentPendingQuestion) — no tool takes it as an argument
  },
  {
    id: 'exchangeSize',
    label: 'exchange size chosen',
    applies: (f) => f.reason === 'size' && f.resolution !== 'refund',
    done: (f) => Boolean(f.exchangeSize) || f.resolution === 'refund',
    tools: ['getAvailableSizes'],
  },
  {
    id: 'slot',
    label: 'pickup slot chosen',
    applies: (f) => f.eligible === true && Boolean(f.reason),
    done: (f) => Boolean(f.pickupLabel),
    tools: ['getPickupSlots'],
  },
  {
    id: 'ticket',
    label: 'return ticket created',
    applies: (f) => f.eligible === true,
    done: (f) => Boolean(f.ticketId),
    tools: ['createReturnTicket'],
  },
  {
    id: 'bankLink',
    label: 'bank details link sent',
    applies: (f) => Boolean(f.ticketId) && f.paymentMethod === 'COD' && f.resolution === 'refund',
    done: (f) => Boolean(f.bankDetailsLinkSent),
    tools: ['sendBankDetailsLink'],
  },
];

/**
 * Which open question (if any) the customer's next reply answers —
 * derived fresh from `facts` every time, never stored. This replaces a
 * `pendingCapture` field that was manually set by each tool's handler and
 * had to be manually guarded against being re-armed by a redundant call
 * to that same tool; that guard was added for checkReturnEligibility,
 * then forgotten for getAvailableSizes, then forgotten again for
 * getPickupSlots — three rounds of the identical bug because the "is this
 * already answered" decision lived in three different places instead of
 * one. Now it's computed from the same `done` checks FLOW already uses,
 * so it's structurally impossible for it to say "still pending" about
 * something `facts` already has an answer for, no matter how many times
 * the underlying tool gets called.
 */
function currentPendingQuestion(f: ConversationFacts): PendingQuestion | undefined {
  // Checked first — a reschedule on an existing ticket is a short,
  // focused digression the customer wants resolved before anything else,
  // including a return still being created in the same conversation. Kept
  // entirely independent of the create-flow's own fields (see the facts
  // above), so this priority choice never corrupts a return in progress —
  // it only affects which question the customer's VERY NEXT reply answers
  // if both happen to be open at once, a deliberately narrow trade-off.
  if (f.rescheduleTicketId && !f.rescheduleNewSlotLabel) return 'rescheduleSlot';
  if (f.pendingItemOptions && !f.itemId) return 'item';
  if (!FLOW.find((s) => s.id === 'reason')!.done(f) && FLOW.find((s) => s.id === 'reason')!.applies(f)) return 'reason';
  if (!FLOW.find((s) => s.id === 'exchangeSize')!.done(f) && FLOW.find((s) => s.id === 'exchangeSize')!.applies(f))
    return 'exchangeSize';
  if (!FLOW.find((s) => s.id === 'slot')!.done(f) && FLOW.find((s) => s.id === 'slot')!.applies(f)) return 'slot';
  return undefined;
}

/**
 * Which tool the customer's pending question, if any, should be answered
 * from — used to build sendAgentMessage's guardrail (see below). Only the
 * pending questions actually backed by a tool are listed: 'reason' isn't
 * (the 4 options are fixed script text, not fetched data — see FLOW's own
 * comment), so it's deliberately absent.
 */
const GUARDRAIL_TOOL_FOR_PENDING: Partial<Record<PendingQuestion, string>> = {
  item: 'lookupOrder',
  exchangeSize: 'getAvailableSizes',
  slot: 'getPickupSlots',
  rescheduleSlot: 'rescheduleReturnPickup',
};

/**
 * True for text that reads like a numbered options list (2+ list markers —
 * either the emoji numerals the prompts ask for, or a plain "1." style
 * fallback) — the shape a slots/sizes/items answer always takes, and NOT
 * the shape most other replies take. A single incidental number doesn't
 * count; a genuine list of options does. Deliberately generic (doesn't
 * know or care whether the list is slots, sizes, or items) — the caller
 * already knows which one is pending, this only answers "does this text
 * look like *a* list."
 */
function looksLikeFabricatedOptionsList(text: string): boolean {
  const markers = text.match(/[1-9]️?⃣|\b[1-9]\./g) ?? [];
  return markers.length >= 2;
}

/**
 * Builds sendAgentMessage's `guardrail` argument from the facts as they
 * stand right before a customer message is sent — i.e. this captures
 * "what SHOULD the very next assistant reply be backed by," computed once,
 * not re-evaluated turn-by-turn. See sendAgentMessage's own doc for the
 * full mechanism (buffer, detect, discard, force-retry once). Returns
 * undefined when nothing is pending that this guard applies to, so the
 * common case (most turns) costs nothing — no buffering, no check.
 */
function buildOptionsListGuardrail(facts: ConversationFacts): ((content: string) => string | undefined) | undefined {
  const pending = currentPendingQuestion(facts);
  const requiredTool = pending ? GUARDRAIL_TOOL_FOR_PENDING[pending] : undefined;
  if (!requiredTool) return undefined;
  return (content: string) => (looksLikeFabricatedOptionsList(content) ? requiredTool : undefined);
}

// The exact digit order step 3 of the system prompt declares ("map their
// answer to: size, quality, not_as_described, changed_mind") — kept in
// sync with that wording by hand, not derived from it, since the prompt
// is prose for the model and this is a strict lookup table for us. Used
// ONLY to resolve a bare numeral reply ("2") back to what it actually
// means; a prose reply is still captured verbatim, unchanged.
const REASON_BY_DIGIT: Record<string, string> = {
  '1': 'size',
  '2': 'quality',
  '3': 'not_as_described',
  '4': 'changed_mind',
};

/** The customer's whole reply as a number, if that's all it is (leading
 * digits up to a word boundary) — e.g. "2" -> 2, "14" -> 14, "2 please" ->
 * 2. Deliberately NOT capped at a single digit: matching only [1-9] meant
 * an out-of-range reply like "14" or "6" was silently invisible to this
 * code and fell through to the model to interpret on its own — which is
 * exactly how it ended up guessing a plausible-looking but wrong option
 * instead of the customer's mistyped one. Used for both resolving a valid
 * choice (captureNextReply) and rejecting an invalid one
 * (validatePendingChoice) against the same number. */
function fullNumeral(text: string): number | null {
  const m = text.trim().match(/^(\d+)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Requirement: fail loudly, in the console, the moment the agent redoes a
 * step `facts` already says is finished — instead of that only surfacing
 * three rounds later in live testing. Deterministic and tool-call-based,
 * not text-matching on the agent's reply: if a tool call's step was
 * already `done` before this call, the model is re-doing work it already
 * has the answer to (the exact shape of the reported bug — getPickupSlots
 * called again after the customer had already chosen a slot). A
 * console.error, never a thrown exception — this is a development
 * diagnostic, not something that should ever interrupt the demo.
 */
function checkForRedundantStep(facts: ConversationFacts, name: string): void {
  const step = FLOW.find((s) => s.tools.includes(name));
  if (step && step.applies(facts) && step.done(facts)) {
    console.error(
      `[useReturnAgent] STATE MACHINE VIOLATION: ${name} was called again after "${step.label}" was already established — the agent is likely about to re-ask the customer for something it already knows.`,
      { facts: { ...facts } },
    );
  }
}

function updateFacts(facts: ConversationFacts, name: string, args: Record<string, unknown>, result: unknown): void {
  checkForRedundantStep(facts, name);
  const r = result as Record<string, unknown> | undefined;
  switch (name) {
    case 'lookupOrder': {
      // Captured here, not just from checkReturnEligibility below: the
      // model often asks the customer to confirm which item before ever
      // calling checkReturnEligibility (especially on a single-item
      // order, where confirmation is really just a courtesy check), so
      // waiting for eligibility to populate orderId/itemId left a gap —
      // exactly one tool call wide, but enough for a low-reasoning-effort
      // model to lose the order between "here's your order, confirm?" and
      // the customer's "yes". Only set itemId/itemName here when there's
      // exactly one order and one item — i.e. genuinely unambiguous;
      // multi-item or multi-order (phone lookup) cases stay unresolved
      // until checkReturnEligibility/getAvailableSizes pins down which
      // item, same as before.
      const orders = r?.orders as
        | { orderId: string; paymentMethod: string; items: { itemId: string; name: string }[] }[]
        | undefined;
      if (orders?.length === 1) {
        facts.orderId = orders[0].orderId;
        facts.paymentMethod = orders[0].paymentMethod;
        if (orders[0].items.length === 1) {
          facts.itemId = orders[0].items[0].itemId;
          facts.itemName = orders[0].items[0].name;
        } else if (orders[0].items.length > 1) {
          // Ambiguous — the model still has to ask which item. Recording
          // the actual candidate list (not just noting "ambiguous") is
          // what lets validatePendingChoice bounds-check a numbered reply
          // against how many items there really are, instead of the
          // model silently picking one for an out-of-range answer like
          // "14" on a 2-item order.
          facts.pendingItemOptions = orders[0].items;
        }
      }
      break;
    }
    case 'checkReturnEligibility':
      if (r?.found) {
        facts.orderId = String(args.orderId ?? facts.orderId ?? '');
        facts.itemId = String(args.itemId ?? facts.itemId ?? '');
        facts.itemName = r.itemName as string | undefined;
        facts.eligible = r.eligible as boolean | undefined;
        facts.ineligibleReason = r.eligible ? undefined : ((r.reasons as string[] | undefined) ?? []).join(' ');
      }
      break;
    case 'getAvailableSizes':
      if (r?.found) {
        facts.availableSizes = r.availableSizes as string[] | undefined;
        // The system prompt only ever calls this tool when reason is
        // "size" (see systemPrompt.ts step 4) — so the call itself is
        // authoritative evidence of the reason, independent of whether
        // the customer ever answered an explicit numbered "why" question.
        // Needed because a scripted opener can already state the reason
        // in prose ("the kurta runs tight, can I exchange it"), letting
        // the model skip straight to offering sizes in the very first
        // turn. Without this, the 'reason' step still reads as pending,
        // so the customer's NEXT reply — their actual size choice — gets
        // mis-captured as if it were answering "why", and since that text
        // isn't literally "size", the deterministic resolution rule wrongly
        // concludes 'refund' on what's clearly an exchange. Guarded so it
        // never overwrites a reason genuinely captured some other way.
        if (!facts.reason) facts.reason = 'size';
      }
      break;
    case 'getPickupSlots':
      if (Array.isArray(result)) {
        facts.pickupSlots = result.map((s) => ({ slotId: s.slotId, label: s.label }));
      }
      break;
    case 'createReturnTicket':
      if (r?.success && r.ticket) {
        const t = r.ticket as ReturnTicket;
        facts.ticketId = t.ticketId;
        // Overwrites whatever positional capture guessed earlier with the
        // model's own validated values — authoritative by construction
        // (it's what actually got booked), so it corrects a bad guess
        // instead of leaving it to linger in the summary for the rest of
        // the conversation.
        facts.reason = t.reason;
        facts.resolution = t.resolution;
        facts.exchangeSize = t.exchangeSize;
        facts.pickupLabel = t.slot?.label;
      }
      break;
    case 'sendBankDetailsLink':
      if (r?.found) facts.bankDetailsLinkSent = true;
      break;
    case 'rescheduleReturnPickup':
      // Two-phase, mirroring the create-flow's own slot step: a
      // successful "list" call (has availableSlots) arms the pending
      // question; a successful/no-op "apply" call (has ticket, or
      // alreadyThatSlot) resolves it. A failed call (found: false) arms
      // nothing — there's no list to choose from.
      if (r?.availableSlots) {
        facts.rescheduleTicketId = String(args.ticketId ?? '');
        facts.rescheduleOfferedSlots = r.availableSlots as { slotId: string; label: string }[];
        facts.rescheduleNewSlotLabel = undefined;
      } else if (r?.ticket || r?.alreadyThatSlot) {
        facts.rescheduleTicketId = undefined;
        facts.rescheduleOfferedSlots = undefined;
        facts.rescheduleNewSlotLabel = undefined;
      }
      break;
  }
}

// Bare acknowledgements never answer an open question like "why do you
// want to return it", "which size", or "which slot" — seen in practice
// when the model resolves a step AND asks the next open question in the
// same breath (nothing to separately confirm), so the customer's next
// message can be a stray "yes"/"ok" answering something else entirely.
// Capturing that verbatim corrupts the summary for the rest of the
// conversation (the model sees a nonsense "stated reason: yes" and gets
// confused later, even after the real answer is given and acted on).
// This is a narrow validity check, not an attempt to classify what the
// answer actually IS — that stays entirely the model's job; a filler word
// is rejected regardless of what the true answer later turns out to be.
const BARE_ACKNOWLEDGEMENTS = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'y', 'no', 'nope', 'n']);

/** How many real options exist for whatever's currently pending, or
 * undefined if that can't be determined yet (e.g. pickupSlots hasn't
 * loaded). Reason is always exactly the 4 keys in REASON_BY_DIGIT — not
 * dependent on anything having been fetched yet. */
function pendingOptionCount(facts: ConversationFacts, pending: PendingQuestion): number | undefined {
  switch (pending) {
    case 'item':
      return facts.pendingItemOptions?.length;
    case 'reason':
      return Object.keys(REASON_BY_DIGIT).length;
    case 'exchangeSize':
      return facts.availableSizes?.length;
    case 'slot':
      return facts.pickupSlots?.length;
    case 'rescheduleSlot':
      return facts.rescheduleOfferedSlots?.length;
  }
}

const PENDING_QUESTION_LABEL: Record<PendingQuestion, string> = {
  item: 'which item',
  reason: 'the return reason',
  exchangeSize: 'which size',
  slot: 'which pickup slot',
  rescheduleSlot: 'which new pickup slot',
};

/**
 * A loose keyword check that the agent's actual last message plausibly
 * asked about whatever `facts` says is pending, before validatePendingChoice
 * or captureNextReply act on that assumption. `currentPendingQuestion` is
 * derived purely from `facts` — it has no way to know the agent went
 * off-script (asked something else, or nothing at all) in a given turn.
 * Seen live: an exchange decline ("no I don't want it") landed while
 * `facts` still read 'slot' as pending, and — with no check like this one —
 * got stored as the pickup label verbatim; a ticket could have been
 * created with that as the pickup time. This doesn't have to be precise,
 * just enough to catch "the agent clearly wasn't asking about this," since
 * a false negative here only means a customer's reply goes uncaptured
 * (the model still sees the raw text and can react to it normally) — never
 * worse than the blind-capture behavior it replaces.
 */
const PENDING_QUESTION_KEYWORDS: Record<PendingQuestion, RegExp> = {
  item: /item|which one/i,
  reason: /reason|why/i,
  exchangeSize: /size/i,
  slot: /slot|pickup|time/i,
  rescheduleSlot: /slot|pickup|time/i,
};

/**
 * Overrides a PENDING_QUESTION_KEYWORDS match, rather than being folded
 * into it — a keyword match alone isn't enough. Seen live on a weak
 * fallback model (OpenRouter's free tier): a confused, compound reply like
 * "I need to know why you're returning it — but first, could you share
 * your order ID or the phone number?" contains "why", so it passed the
 * 'reason' keyword check even though the customer's next reply ("the
 * order ID is VS1014") was answering the SECOND half of that message, not
 * the first. That's exactly how a return reason ended up captured as the
 * literal string "The order ID is VS1014". Re-identification is always
 * off-script here — order/item identification is supposed to already be
 * resolved before 'item', 'reason', 'exchangeSize', 'slot', or
 * 'rescheduleSlot' can even become pending (see FLOW) — so this pattern
 * unconditionally blocks a capture regardless of which keyword also
 * matched. Matches the specific "order ID or phone number" phrasing this
 * app's own prompts consistently produce for that question (see
 * systemPrompt.ts/voiceSystemPrompt.ts step 1), not a bare mention of
 * "order" alone, which a legitimate confirmation recap ("order VS1014
 * confirmed, why are you returning it?") would otherwise trip.
 */
const ORDER_ID_REASK_PATTERN = /order id.{0,25}phone number/i;

/**
 * The code-level guard the tools themselves can't provide: nothing in
 * llmProvider.ts's tool schema stops the model from picking a
 * plausible-looking option when a customer's numbered reply is out of
 * range ("14" on a 2-item order, "6" on a 4-option reason list) — the
 * model just picks something instead of asking again, seen live on
 * VS1002. This runs BEFORE the message ever reaches the model: if the
 * customer's whole reply is a number and it's outside the range of
 * whatever's actually pending, the turn never becomes an LLM call at all
 * — the caller shows a direct rejection and waits for a real answer,
 * exactly like a bounds check in the policy engine would. A prose reply,
 * an in-range number, or nothing pending all fall through untouched.
 *
 * `lastAgentText` gates the whole check on PENDING_QUESTION_KEYWORDS: if
 * the agent's actual last message doesn't look like it asked about
 * whatever `facts` says is pending, this stays silent rather than
 * rejecting a numeral that may be answering something else entirely off
 * the state machine's radar. For 'reason' specifically, a bare numeral
 * only means anything if the reason menu was actually presented as a
 * numbered list — see looksLikeFabricatedOptionsList, reused here for
 * exactly the property it was built to detect.
 */
function validatePendingChoice(facts: ConversationFacts, incomingMessage: string, lastAgentText: string): string | undefined {
  const pending = currentPendingQuestion(facts);
  if (!pending) return undefined;
  if (!PENDING_QUESTION_KEYWORDS[pending].test(lastAgentText) || ORDER_ID_REASK_PATTERN.test(lastAgentText)) return undefined;
  const n = fullNumeral(incomingMessage);
  if (n === null) return undefined;
  if (pending === 'reason' && !looksLikeFabricatedOptionsList(lastAgentText)) return undefined;
  const count = pendingOptionCount(facts, pending);
  if (count === undefined || (n >= 1 && n <= count)) return undefined;
  const label = PENDING_QUESTION_LABEL[pending];
  return count === 1
    ? `I only have option 1 for ${label} — did you mean that one?`
    : `I only have options 1–${count} for ${label} — which did you mean?`;
}

/**
 * Captures the customer's next message as the answer to whichever
 * question currentPendingQuestion says is open, called right before
 * building this turn's context summary so an answer given in the
 * PREVIOUS turn is captured before it can fall out of the recent-message
 * window in some future turn. Only ever called with a message
 * validatePendingChoice has already approved (in range, or not a bare
 * numeral at all) — this function itself doesn't re-check bounds.
 *
 * The one place this maps rather than stores verbatim: a bare numeral
 * reply to the reason question ("2") is meaningless on its own once it's
 * pulled out of the numbered list it was answering — the raw text "2" in
 * the summary reads to the model as a fact, not a list index, and was
 * observed live confusing it into re-asking the same question. Resolved
 * against REASON_BY_DIGIT, which mirrors the system prompt's own fixed
 * numbering — not a guess about intent, just decoding our own list. Item
 * and pickup-slot numerals are resolved the same way, against whatever
 * was actually offered this conversation (`pendingItemOptions` /
 * `pickupSlots`) rather than a hardcoded table, since those lists are
 * generated, not fixed prompt text.
 *
 * On a prose reply this can't resolve (an item described by name, or a
 * pickup constraint like "I'm out of town on the 11th"), it deliberately
 * does nothing for 'item' (leaves it to checkReturnEligibility's own
 * itemId argument to resolve properly) but still stores 'slot' verbatim —
 * that's what lets the model reason from the raw constraint text and
 * re-offer alternatives, a real behavior worth keeping; `createReturnTicket`'s
 * handler in updateFacts is the backstop if that ever ends up wrong.
 *
 * `lastAgentText` is checked against PENDING_QUESTION_KEYWORDS before any
 * of this runs — `facts` saying a question is "pending" doesn't mean the
 * agent's actual last message asked it. Seen live: an exchange decline
 * ("no I don't want it") landed while 'slot' still read as pending and got
 * stored as the pickup label verbatim, with nothing to stop a ticket being
 * created with that as the pickup time — the state-machine-violation
 * console warning caught the SYMPTOM a few tool calls later, but the wrong
 * fact had already been sitting in `facts` the whole time. A false
 * negative here just leaves the fact uncaptured; the model still sees the
 * customer's actual words in the conversation and can react to them
 * normally, so skipping a capture is always the safe direction to fail in.
 */
function captureNextReply(facts: ConversationFacts, incomingMessage: string, lastAgentText: string): void {
  const pending = currentPendingQuestion(facts);
  if (!pending) return;
  const trimmed = incomingMessage.trim();
  if (BARE_ACKNOWLEDGEMENTS.has(trimmed.toLowerCase())) return;
  if (!PENDING_QUESTION_KEYWORDS[pending].test(lastAgentText) || ORDER_ID_REASK_PATTERN.test(lastAgentText)) return;

  if (pending === 'rescheduleSlot') {
    const n = fullNumeral(trimmed);
    const bySlots = facts.rescheduleOfferedSlots;
    const matched = n && bySlots ? bySlots[n - 1] : undefined;
    facts.rescheduleNewSlotLabel = matched ? matched.label : trimmed;
    return;
  }
  if (pending === 'item') {
    const n = fullNumeral(trimmed);
    const options = facts.pendingItemOptions;
    let matched = n && options ? options[n - 1] : undefined;
    // A prose reply ("the BP monitor", "the digital one") used to be left
    // entirely uncaptured here, on the theory that checkReturnEligibility's
    // own itemId argument would resolve it instead once the model correctly
    // parsed which item was meant. That theory was wrong: buildExecutors'
    // checkReturnEligibility backstop refuses EVERY call while
    // currentPendingQuestion still reads 'item' — which it does for as long
    // as facts.itemId is unset — so a model that correctly identifies the
    // item from prose has no path to ever set facts.itemId at all. Confirmed
    // live on WellNest's damaged-BP-monitor case (a genuinely multi-item
    // order, WN2001): the model kept re-guessing the right itemId every
    // turn and kept getting refused by its own conversation's state, an
    // infinite loop the customer can't get out of no matter what they type.
    // Resolved here the same way a human reading the reply would: does it
    // name exactly one candidate uniquely? Matched on whole distinctive
    // words from each candidate's own name (length > 2, so "BP"/"of"-style
    // noise can't false-match) — if more than one candidate's words show up,
    // or none do, this stays unresolved rather than guess, same principle
    // as every other "don't guess" capture in this function.
    if (!matched && options) {
      const lower = trimmed.toLowerCase();
      const nameMatches = options.filter((o) =>
        o.name
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 2)
          .some((word) => lower.includes(word)),
      );
      if (nameMatches.length === 1) matched = nameMatches[0];
    }
    if (matched) {
      facts.itemId = matched.itemId;
      facts.itemName = matched.name;
      facts.pendingItemOptions = undefined;
    }
    // Still no match (too vague, or ambiguous between candidates):
    // deliberately leave everything as-is and let the model ask again —
    // no guessing at which item unclear prose refers to.
    return;
  }
  if (pending === 'reason') {
    const n = fullNumeral(trimmed);
    if (n !== null) {
      // A bare number only means anything if the menu was actually
      // numbered (see looksLikeFabricatedOptionsList) — otherwise it's not
      // a list index, and storing it as literal "reason" text would be
      // just as wrong as mapping it to the wrong option.
      if (!looksLikeFabricatedOptionsList(lastAgentText)) return;
      const mapped = REASON_BY_DIGIT[String(n)];
      if (!mapped) return; // out of range — validatePendingChoice should already have caught this
      facts.reason = mapped;
    } else {
      facts.reason = trimmed;
    }
    // Deliberately NOT forcing facts.resolution here. This used to lock it
    // to 'refund' the instant any non-"size" reason was captured, back when
    // "size" was the only reason that could ever lead to an exchange. That
    // stopped being true once systemPrompt.ts step 4 grew a second exchange
    // path — a straight replacement, offered first for a "quality" or
    // "not_as_described" reason on an item with no size variants (a device,
    // not sized apparel) — and this line was never updated to match. The bug
    // that produced: factsToSummary (below) puts "resolution: refund"
    // straight into the next request as an already-established fact the
    // instant a customer typed anything defect-like ("arrived with a
    // cracked screen"), so the model saw a refund already decided before it
    // ever got to the replacement-first instruction — confirmed live on
    // WellNest's damaged-BP-monitor case, where the customer explicitly
    // said "I'd like a replacement, not a refund" and still got a refund.
    // resolution is authoritative from exactly two places now: the
    // 'exchangeSize' branch below (a real size choice), and
    // createReturnTicket's own result in updateFacts (whatever the model
    // actually booked) — both fire well after the model has had a real
    // chance to decide, unlike this one did.
    return;
  }
  if (pending === 'exchangeSize') {
    facts.exchangeSize = trimmed;
    facts.resolution = 'exchange';
    return;
  }
  // 'slot'
  const n = fullNumeral(trimmed);
  const bySlots = facts.pickupSlots;
  const matched = n && bySlots ? bySlots[n - 1] : undefined;
  facts.pickupLabel = matched ? matched.label : trimmed;
}

/**
 * Derives the summary text entirely from `facts` — never the other way
 * round. Walks FLOW in order so the "already established" list and the
 * "still needed" framing always match what stepStatus/currentPendingQuestion
 * would say, instead of this function keeping its own parallel opinion
 * about what's done (which is exactly what let the pickup-slot bug read
 * as fixed in the summary while the underlying pendingCapture field had
 * silently drifted back to "still waiting").
 */
function factsToSummary(f: ConversationFacts): string {
  const parts: string[] = [];
  if (f.orderId) parts.push(`order ${f.orderId}`);
  if (f.itemName) parts.push(`item "${f.itemName}"${f.itemId ? ` (${f.itemId})` : ''}`);
  if (f.paymentMethod) parts.push(`payment method: ${f.paymentMethod}`);
  if (f.eligible === true) parts.push('confirmed eligible for return/exchange');
  if (f.eligible === false) parts.push(`confirmed NOT eligible (${f.ineligibleReason || 'see policy'}) — do not proceed further`);
  if (f.reason) parts.push(`customer's stated reason: "${f.reason}" — do not ask for the reason again`);
  if (f.availableSizes?.length) parts.push(`sizes in stock: ${f.availableSizes.join(', ')}`);
  if (f.resolution) parts.push(`resolution: ${f.resolution}${f.exchangeSize ? ` → size ${f.exchangeSize}` : ''}`);
  if (f.pickupSlots?.length) {
    parts.push(`pickup slots offered: ${f.pickupSlots.map((s) => `${s.slotId}=${s.label}`).join('; ')}`);
  }
  if (f.pickupLabel) parts.push(`pickup slot chosen: ${f.pickupLabel} — do not ask for a slot again`);
  if (f.ticketId) {
    parts.push(
      `ticket ${f.ticketId} already created (${f.resolution}${f.exchangeSize ? ` → ${f.exchangeSize}` : ''}${
        f.pickupLabel ? `, ${f.pickupLabel}` : ''
      }) — do NOT create another`,
    );
    if (f.paymentMethod === 'COD' && f.resolution === 'refund') {
      parts.push(
        f.bankDetailsLinkSent
          ? 'bank details link already sent for this ticket via sendBankDetailsLink — do NOT send another, and do NOT say you are sending one again if asked; just confirm it was sent'
          : 'bank details link NOT yet sent — call sendBankDetailsLink before ever telling the customer a link was sent',
      );
    }
  }
  if (f.rescheduleTicketId && f.rescheduleOfferedSlots?.length) {
    parts.push(
      `rescheduling ${f.rescheduleTicketId} — new slots offered: ${f.rescheduleOfferedSlots.map((s) => `${s.slotId}=${s.label}`).join('; ')}`,
    );
  }
  const pending = currentPendingQuestion(f);
  if (pending) parts.push(`still waiting on the customer for: ${PENDING_QUESTION_LABEL[pending]}`);
  return parts.join('. ');
}

/**
 * Answers whatever the agent's last reply actually asked, for a scripted
 * scenario's setup phase (see playScenario) — a real customer completing
 * this return would answer the question in front of them, not a
 * pre-guessed one. Order/reason are already stated up front in every
 * scenario's opener (see scenarios.ts), so a re-ask for either is treated
 * as the agent needing reassurance, not a genuine information gap.
 *
 * The numbered-choice rule matters more than it looks: an earlier version
 * fell back to prose ("yes, please go ahead") for anything unrecognized,
 * which reliably derailed the conversation the moment the agent asked a
 * numbered question this function didn't have a specific rule for (seen
 * live — a "1️⃣ Replacement 2️⃣ Refund" choice, answered with prose, was
 * followed by the agent losing track of the order entirely and re-asking
 * for it). A numbered list only ever expects a number back; "1" is a safe
 * default first choice for any of them, checked ahead of the generic
 * fallback but after the more specific slot rule (slot offers are ALSO
 * numbered, and "1" is correct there too, so order doesn't actually
 * matter between those two — kept separate for clarity, not behavior).
 *
 * `orderId`, when available (see playScenario, which extracts it from the
 * scenario's own opener), is repeated verbatim rather than a vague "I
 * already gave it" — also seen live to matter: a vague nudge sometimes
 * left a provider stuck re-asking the same question every round instead
 * of recovering.
 */
function pickSetupReply(lastAgentText: string, orderId?: string): string {
  const rules: { matches: RegExp; reply: string }[] = [
    { matches: /slot|pickup|which time|available time/i, reply: '1' },
    { matches: /reason|why.*(want|return)|what happened/i, reply: "I've changed my mind, I just don't need it anymore" },
    { matches: /order id|phone number/i, reply: orderId ? `The order ID is ${orderId}` : 'I gave the order ID already, please check above' },
    { matches: /1️⃣|2️⃣|3️⃣|4️⃣/, reply: '1' },
  ];
  const rule = rules.find((r) => r.matches.test(lastAgentText));
  return rule ? rule.reply : 'yes, please go ahead';
}

export function useReturnAgent() {
  const [brand, setBrandState] = useState<BrandConfig>(vastraBrand);
  const [channel, setChannel] = useState<Channel>('whatsapp');

  const brandRef = useRef(brand);
  useEffect(() => {
    brandRef.current = brand;
  }, [brand]);

  const apiKeyMissing = !hasApiKey();

  // ---------------------------------------------------------------------
  // SHARED: one ticket backend, one tool-executor layer, used by both
  // channels' sendAgentMessage calls.
  // ---------------------------------------------------------------------
  // Genuinely empty on load and after every Reset — nothing pre-seeded.
  // Scenarios that need an existing return in progress (status lookup,
  // reschedule, cancel, duplicate-attempt) create their own ticket live,
  // through the real conversation, as part of the scenario script itself
  // (see playScenario below and scenarios.ts) — so a visitor never sees a
  // ticket that wasn't actually produced by something they watched happen.
  const [tickets, setTickets] = useState<ReturnTicket[]>([]);
  const ticketSeqRef = useRef(0);
  const ticketsRef = useRef<ReturnTicket[]>([]);
  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  /**
   * Demo-only control (see TicketCard's "Advance (demo)" button) — moves a
   * ticket exactly one step forward in its OWN status sequence (see
   * statusSequenceFor in types.ts, which already branches correctly by
   * resolution/payment method). This exists because the pipeline
   * deliberately no longer auto-advances on a fake timer (see the
   * "Awaiting Bank Details" / "In Transit" fixes) — real events like a
   * courier pickup or a bank-details submission aren't simulated
   * anywhere in this app, so nothing should silently claim they happened.
   * A presenter clicking this button IS the "real event" here: an
   * explicit, visible, attributable action, not a claim the ticket makes
   * about itself. No-ops once a ticket is already at its final status.
   */
  const advanceTicketStatus = useCallback((ticketId: string) => {
    setTickets((prev) =>
      prev.map((t) => {
        if (t.ticketId !== ticketId || t.status === 'Cancelled') return t;
        const sequence = statusSequenceFor(t);
        const next = sequence[sequence.indexOf(t.status) + 1];
        return next ? { ...t, status: next } : t;
      }),
    );
  }, []);

  // Executors run inside an async tool-call loop (see sendAgentMessage), so
  // they need the *current* ticket list at call time for the duplicate-
  // booking guard, not whatever was in scope when this closure was built —
  // a plain `tickets` dependency would also mean a new executor map (and a
  // new sendAgentMessage identity) on every ticket update mid-conversation.
  // `facts` is a live reference (see chatFactsRef/voiceFactsRef below), not
  // a snapshot — createReturnTicket reads it at call time, which matters
  // because a single assistant turn can chain multiple tool calls back to
  // back with no customer reply in between (e.g. getPickupSlots then
  // immediately createReturnTicket, seen live on VS1002: the model
  // presented slots and booked the first one in the same breath, without
  // ever waiting for the customer to actually choose). currentPendingQuestion
  // only returns undefined once captureNextReply has processed a genuine
  // NEW customer message for whatever's still open, so if it's still
  // truthy at the moment createReturnTicket runs, that question was never
  // actually answered — refuse, same principle as the eligibility/
  // duplicate-booking guards already enforced in code rather than left to
  // the prompt.
  const buildExecutors = useCallback(
    (currentBrand: BrandConfig, facts: ConversationFacts): ToolExecutorMap => ({
      lookupOrder: (args) => lookupOrder(currentBrand.catalog, String(args.orderIdOrPhone ?? '')),
      checkReturnEligibility: (args) => {
        const orderId = String(args.orderId ?? '');
        // The ambiguity check for a multi-item order lives entirely in
        // lookupOrder's own result (see updateFacts's pendingItemOptions
        // handling) — which means it only ever runs if lookupOrder was
        // actually called. Seen live on a vague opener ("return something
        // from my order VS1002"): the model skipped lookupOrder entirely
        // and called checkReturnEligibility straight away with a guessed
        // itemId, so pendingItemOptions was never populated and the
        // 'item'-pending check below never got a chance to fire at all.
        // Requiring facts.orderId to already match forces lookupOrder to
        // run first, every time, which is what actually surfaces the
        // ambiguity.
        if (facts.orderId !== orderId) {
          return {
            found: false,
            error: 'You must call lookupOrder for this order first — do not guess which item the customer means.',
          };
        }
        // Backstop for the case lookupOrder DID run and found more than
        // one item: refuse while 'item' is still genuinely pending, so a
        // guessed itemId can't slip through even once ambiguity is known.
        if (currentPendingQuestion(facts) === 'item') {
          return {
            found: false,
            error:
              'This order has more than one item and the customer has not said which one yet — list the items and ask which one before checking eligibility.',
          };
        }
        return checkReturnEligibilityTool(currentBrand.catalog, String(args.orderId ?? ''), String(args.itemId ?? ''));
      },
      getAvailableSizes: (args) =>
        getAvailableSizesTool(currentBrand.catalog, String(args.orderId ?? ''), String(args.itemId ?? '')),
      getPickupSlots: () => getPickupSlotsTool(),
      createReturnTicket: (args) => {
        const pending = currentPendingQuestion(facts);
        if (pending) {
          return {
            success: false,
            error: `The customer has not actually answered yet — you still need their reply for ${PENDING_QUESTION_LABEL[pending]} before creating a ticket. Present it (if you haven't) and wait for their next message; do not call createReturnTicket until they respond.`,
          };
        }
        const input = args as unknown as CreateReturnTicketInput;
        const result = createReturnTicketTool(
          currentBrand.catalog,
          input,
          ticketSeqRef.current + 1,
          ticketsRef.current,
        );
        if (result.alreadyBooked) {
          return { success: false, alreadyBooked: true, ticket: result.ticket, error: result.error };
        }
        if (result.found && result.ticket) {
          ticketSeqRef.current += 1;
          setTickets((prev) => [result.ticket as ReturnTicket, ...prev]);
          return { success: true, ticket: result.ticket };
        }
        return { success: false, error: result.error };
      },
      sendBankDetailsLink: (args) => {
        if (!facts.orderId) {
          return { found: false, error: 'No order identified yet in this conversation — ask for the order ID or phone number first.' };
        }
        const { result, ticket } = sendBankDetailsLinkTool(ticketsRef.current, String(args.ticketId ?? ''), facts.orderId);
        if (ticket) {
          setTickets((prev) => prev.map((t) => (t.ticketId === ticket.ticketId ? ticket : t)));
        }
        return result;
      },
      // The three tools below never trust an orderId the model supplies —
      // they always use facts.orderId, the order THIS conversation already
      // verified via lookupOrder. A confused or adversarial model literally
      // cannot query a different customer's ticket by passing a different
      // orderId, because there's no orderId parameter on these tools at
      // all for it to pass — same principle as the policy engine: enforced
      // in code, not by trusting what the model claims.
      lookupReturnTicket: (args) => {
        if (!facts.orderId) {
          return { found: false, error: 'No order identified yet in this conversation — ask for the order ID or phone number first.' };
        }
        return lookupReturnTicketTool(ticketsRef.current, facts.orderId, args.ticketId ? String(args.ticketId) : undefined);
      },
      rescheduleReturnPickup: (args) => {
        if (!facts.orderId) {
          return { found: false, error: 'No order identified yet in this conversation — ask for the order ID or phone number first.' };
        }
        const ticketId = String(args.ticketId ?? '');
        const newSlotId = args.newSlotId ? String(args.newSlotId) : undefined;

        if (!newSlotId) {
          // "List available slots" mode — see updateFacts's
          // rescheduleReturnPickup case, which arms rescheduleTicketId
          // from a successful result here.
          return listReschedulableSlotsTool(ticketsRef.current, facts.orderId, ticketId);
        }

        // "Apply a chosen slot" mode — refuses unless the customer has
        // actually answered since the slots were listed, exactly the
        // createReturnTicket guard above, applied to reschedule.
        const pending = currentPendingQuestion(facts);
        if (facts.rescheduleTicketId !== ticketId || pending === 'rescheduleSlot') {
          return {
            found: false,
            error: `The customer hasn't actually chosen a new slot for ${ticketId} yet — list the available slots first (if you haven't) and wait for their reply before rescheduling.`,
          };
        }
        const { result, ticket } = rescheduleReturnPickupTool(ticketsRef.current, facts.orderId, ticketId, newSlotId);
        if (ticket) {
          setTickets((prev) => prev.map((t) => (t.ticketId === ticket.ticketId ? ticket : t)));
        }
        return result;
      },
      cancelReturnTicket: (args) => {
        if (!facts.orderId) {
          return { found: false, error: 'No order identified yet in this conversation — ask for the order ID or phone number first.' };
        }
        const { result, ticket } = cancelReturnTicketTool(ticketsRef.current, facts.orderId, String(args.ticketId ?? ''));
        if (ticket) {
          setTickets((prev) => prev.map((t) => (t.ticketId === ticket.ticketId ? ticket : t)));
        }
        return result;
      },
    }),
    [],
  );

  const stats: Stats = useMemo(() => {
    const today = new Date();
    const isToday = (ms: number) => {
      const d = new Date(ms);
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    };
    const returnsToday = tickets.filter((t) => isToday(t.createdAt)).length;
    // A cancelled return didn't actually happen, so it shouldn't count
    // toward the exchange/refund split or the value it would have
    // retained — only returnsToday (raw request volume) still counts it.
    const exchangeCount = tickets.filter((t) => t.resolution === 'exchange' && t.status !== 'Cancelled').length;
    const refundCount = tickets.filter((t) => t.resolution === 'refund' && t.status !== 'Cancelled').length;
    const valueRetained = tickets
      .filter((t) => t.resolution === 'exchange' && t.status !== 'Cancelled')
      .reduce((sum, t) => sum + t.itemPrice, 0);
    return { returnsToday, exchangeCount, refundCount, valueRetained };
  }, [tickets]);

  // ---------------------------------------------------------------------
  // WhatsApp channel — own transcript, own session, own system prompt.
  // ---------------------------------------------------------------------
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: uid(), role: 'agent', text: chatGreetingFor(vastraBrand), timestamp: Date.now() },
  ]);
  const [chatIsTyping, setChatIsTyping] = useState(false);
  const [chatToolActivity, setChatToolActivity] = useState<string | null>(null);
  const [chatStreamingText, setChatStreamingText] = useState('');
  const chatSessionRef = useRef<ChatSession | null>(null);
  const chatFactsRef = useRef<ConversationFacts>({});
  // Synchronous mirror of chatMessages (React state updates aren't visible
  // until the next render) — needed so sendChatMessage can read the agent's
  // actual last line before deciding what the customer's reply answers
  // (see captureNextReply/validatePendingChoice's lastAgentText parameter).
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  if (!chatSessionRef.current && !apiKeyMissing) {
    chatSessionRef.current = newSession(buildSystemInstruction(brand));
  }

  const sendChatMessage = useCallback(
    async (text: string): Promise<string | undefined> => {
      const trimmed = text.trim();
      if (!trimmed || apiKeyMissing || !chatSessionRef.current) return undefined;

      // Captured before this turn's own state updates land, so it's
      // unambiguously the agent's PRIOR line — what the customer's reply
      // below is actually answering (see PENDING_QUESTION_KEYWORDS).
      const lastAgentText = [...chatMessagesRef.current].reverse().find((m) => m.role === 'agent')?.text ?? '';

      setChatMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed, timestamp: Date.now() }]);

      // Bounds-checked in code before this ever becomes a model turn — see
      // validatePendingChoice's own comment. No tool call, no LLM request,
      // just an immediate correction while the real question stays open.
      const rejection = validatePendingChoice(chatFactsRef.current, trimmed, lastAgentText);
      if (rejection) {
        setChatMessages((prev) => [...prev, { id: uid(), role: 'agent', text: rejection, timestamp: Date.now() }]);
        return rejection;
      }

      setChatIsTyping(true);
      setChatToolActivity(CHAT_THINKING_LABEL);
      setChatStreamingText('');
      captureNextReply(chatFactsRef.current, trimmed, lastAgentText);
      try {
        const executors = buildExecutors(brandRef.current, chatFactsRef.current);
        const reply = await sendAgentMessage(
          chatSessionRef.current,
          trimmed,
          executors,
          (name, args, result) => {
            setChatToolActivity(TOOL_ACTIVITY_LABELS[name] ?? name);
            // eslint-disable-next-line no-console
            console.log(`[useReturnAgent] tool call (chat): ${name}`, args, '->', result);
            updateFacts(chatFactsRef.current, name, args, result);
          },
          (textSoFar) => setChatStreamingText(textSoFar),
          factsToSummary(chatFactsRef.current),
          buildOptionsListGuardrail(chatFactsRef.current),
        );
        setChatMessages((prev) => [...prev, { id: uid(), role: 'agent', text: reply, timestamp: Date.now() }]);
        return reply;
      } catch (err) {
        const providerName = getActiveProvider().name;
        console.error(`${providerName} request failed`, err);
        const raw = err instanceof Error ? err.message : String(err);
        const errorText = isQuotaError(raw)
          ? "This demo is briefly rate-limited — it clears in about a minute. Hit Reset and try again shortly."
          : "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.";
        setChatMessages((prev) => [...prev, { id: uid(), role: 'agent', text: errorText, timestamp: Date.now() }]);
        return errorText;
      } finally {
        setChatIsTyping(false);
        setChatToolActivity(null);
        setChatStreamingText('');
        // eslint-disable-next-line no-console
        console.log('[useReturnAgent] facts (chat) after this turn:', JSON.stringify(chatFactsRef.current));
      }
    },
    [apiKeyMissing, buildExecutors],
  );

  // ---------------------------------------------------------------------
  // Voice channel — own transcript, own session, own system prompt, plus
  // call lifecycle (start/end/duration) and speech synthesis.
  // ---------------------------------------------------------------------
  const [callMessages, setCallMessages] = useState<TranscriptEntry[]>([]);
  const [callActive, setCallActive] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [voiceToolActivity, setVoiceToolActivity] = useState<string | null>(null);
  const [voiceStreamingText, setVoiceStreamingText] = useState('');
  const voiceSessionRef = useRef<ChatSession | null>(null);
  const voiceFactsRef = useRef<ConversationFacts>({});
  const callStartRef = useRef<number | null>(null);
  // Mirrors of state an async/stable callback needs the *current* value of
  // (same reasoning as ticketsRef above) — callMessagesRef so endCall can
  // archive whatever was actually said, and callStartTicketIdsRef so it can
  // tell which tickets were created *during this call* versus already there.
  const callMessagesRef = useRef<TranscriptEntry[]>([]);
  useEffect(() => {
    callMessagesRef.current = callMessages;
  }, [callMessages]);
  const callStartTicketIdsRef = useRef<Set<string>>(new Set());

  const tts = useSpeechSynthesis(brand.voice);

  useEffect(() => {
    if (!callActive) return;
    const id = setInterval(() => {
      if (callStartRef.current) {
        setCallSeconds(Math.floor((Date.now() - callStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [callActive]);

  const speakAgentLine = useCallback(
    (text: string) => {
      if (!callActive) return;
      tts.speak(text);
    },
    [callActive, tts],
  );

  const startCall = useCallback(() => {
    callStartRef.current = Date.now();
    callStartTicketIdsRef.current = new Set(ticketsRef.current.map((t) => t.ticketId));
    setCallSeconds(0);
    setCallActive(true);
    setVoiceToolActivity(null);
    setVoiceStreamingText('');
    setIsProcessingVoice(false);
    voiceFactsRef.current = {};
    if (!apiKeyMissing) {
      voiceSessionRef.current = newSession(buildVoiceSystemInstruction(brandRef.current));
    }
    const greetingText = callGreetingFor(brandRef.current);
    setCallMessages([{ id: uid(), role: 'agent', text: greetingText, timestamp: Date.now() }]);
    tts.speak(greetingText);
  }, [apiKeyMissing, tts]);

  /**
   * Ends the call and archives it into the log — an ops console watches
   * calls across a whole day, not one at a time, so ending a call must not
   * discard the transcript the way starting the next one used to. Only
   * logs calls where the customer actually said something (greeting-only
   * calls, e.g. immediately hanging up, aren't worth a log row). Duration
   * is computed fresh from callStartRef rather than read from the
   * `callSeconds` state, since that only updates once a second and could
   * be up to 1s stale at the exact moment of hangup.
   */
  const endCall = useCallback(() => {
    tts.cancel();
    if (callStartRef.current && callMessagesRef.current.length > 1) {
      const durationSeconds = Math.floor((Date.now() - callStartRef.current) / 1000);
      const newTickets = ticketsRef.current.filter((t) => !callStartTicketIdsRef.current.has(t.ticketId));
      const outcome =
        newTickets.length > 0
          ? newTickets
              .map((t) => `${t.ticketId} · ${t.resolution === 'exchange' ? `Exchange → ${t.exchangeSize}` : 'Refund'}`)
              .join(', ')
          : 'No return created';
      setCallLog((prev) => [
        { id: uid(), endedAt: Date.now(), durationSeconds, transcript: callMessagesRef.current, outcome },
        ...prev,
      ]);
    }
    callStartRef.current = null;
    setCallActive(false);
    setCallSeconds(0);
  }, [tts]);

  const sendVoiceMessage = useCallback(
    async (text: string): Promise<string | undefined> => {
      const trimmed = text.trim();
      if (!trimmed || apiKeyMissing || !voiceSessionRef.current || !callActive) return undefined;

      // See sendChatMessage's identical capture — the agent's PRIOR line,
      // before this turn's own state updates land.
      const lastAgentText = [...callMessagesRef.current].reverse().find((m) => m.role === 'agent')?.text ?? '';

      setCallMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed, timestamp: Date.now() }]);

      // Same bounds check as the chat channel — see validatePendingChoice.
      // Spoken immediately rather than routed through the model, same as
      // any other agent line on this channel.
      const rejection = validatePendingChoice(voiceFactsRef.current, trimmed, lastAgentText);
      if (rejection) {
        setCallMessages((prev) => [...prev, { id: uid(), role: 'agent', text: rejection, timestamp: Date.now() }]);
        speakAgentLine(rejection);
        return rejection;
      }

      setIsProcessingVoice(true);
      setVoiceToolActivity(VOICE_THINKING_LABEL);
      setVoiceStreamingText('');
      captureNextReply(voiceFactsRef.current, trimmed, lastAgentText);
      try {
        const executors = buildExecutors(brandRef.current, voiceFactsRef.current);
        const reply = await sendAgentMessage(
          voiceSessionRef.current,
          trimmed,
          executors,
          (name, args, result) => {
            setVoiceToolActivity(TOOL_ACTIVITY_LABELS[name] ?? name);
            // eslint-disable-next-line no-console
            console.log(`[useReturnAgent] tool call (voice): ${name}`, args, '->', result);
            updateFacts(voiceFactsRef.current, name, args, result);
          },
          (textSoFar) => setVoiceStreamingText(textSoFar),
          factsToSummary(voiceFactsRef.current),
          buildOptionsListGuardrail(voiceFactsRef.current),
        );
        setCallMessages((prev) => [...prev, { id: uid(), role: 'agent', text: reply, timestamp: Date.now() }]);
        speakAgentLine(reply);
        return reply;
      } catch (err) {
        const providerName = getActiveProvider().name;
        console.error(`${providerName} request failed`, err);
        const raw = err instanceof Error ? err.message : String(err);
        const errorText = isQuotaError(raw)
          ? "This demo is briefly rate-limited — it clears in about a minute. Try again shortly."
          : "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.";
        setCallMessages((prev) => [...prev, { id: uid(), role: 'agent', text: errorText, timestamp: Date.now() }]);
        speakAgentLine(errorText);
        return errorText;
      } finally {
        setIsProcessingVoice(false);
        setVoiceToolActivity(null);
        setVoiceStreamingText('');
        // eslint-disable-next-line no-console
        console.log('[useReturnAgent] facts (voice) after this turn:', JSON.stringify(voiceFactsRef.current));
      }
    },
    [apiKeyMissing, buildExecutors, callActive, speakAgentLine],
  );

  /**
   * Runs a scripted scenario (see data/scenarios.ts) as a sequence of real
   * customer messages, each awaiting the agent's full reply before the
   * next is sent — the SAME sendChatMessage/sendVoiceMessage the
   * customer's own typing goes through, not a shortcut. Several scenarios
   * are genuinely about a return already in progress (status lookup,
   * reschedule, cancel, duplicate-attempt), and the only honest way to
   * get there is to actually create one through the conversation first,
   * not pre-seed fake ticket data a visitor never saw happen — see the
   * comment on `tickets`'s initial state above.
   *
   * The setup phase (opener → a created ticket) is REACTIVE, not a fixed
   * script: an early version sent a rigid ["opener", "1"] pair assuming
   * the agent always goes straight from the opener to a slot choice, and
   * broke the first time a provider inserted an unexpected "would you
   * like to proceed?" confirmation — the "1" answered that instead of a
   * slot, and the conversation derailed. pickSetupReply below answers
   * whatever was actually asked, the same way a real customer finishing
   * this return would, capped at a few rounds so a truly stuck
   * conversation doesn't loop forever.
   *
   * `followUp.advanceStatusTimes`, if set, fast-forwards the ticket the
   * setup just created — the same "Advance (demo)" mechanic a presenter
   * would click by hand — before `followUp.message` is sent, for
   * scenarios that need to ask about a return beyond "Pickup Scheduled"
   * (e.g. genuinely Refunded). The ticket in question is always
   * `tickets[0]`: tickets are prepended on creation (see buildExecutors'
   * createReturnTicket), and each scenario runs from a clean slate, so
   * whatever setup just created is unambiguously the most recent one.
   */
  const playScenario = useCallback(
    async (scenario: Scenario, targetChannel: Channel) => {
      const send = targetChannel === 'voice' ? sendVoiceMessage : sendChatMessage;
      const startTicketCount = ticketsRef.current.length;
      const orderId = scenario.opener.match(/\b(VS|WN)\d{4}\b/)?.[0];

      let lastReply = await send(scenario.opener);

      if (scenario.followUp) {
        let rounds = 0;
        while (ticketsRef.current.length === startTicketCount && rounds < 4) {
          rounds += 1;
          lastReply = await send(pickSetupReply(lastReply ?? '', orderId));
        }

        if (scenario.followUp.advanceStatusTimes && ticketsRef.current.length > startTicketCount) {
          const newTicketId = ticketsRef.current[0]?.ticketId;
          if (newTicketId) {
            for (let i = 0; i < scenario.followUp.advanceStatusTimes; i += 1) {
              advanceTicketStatus(newTicketId);
            }
          }
        }

        await send(scenario.followUp.message);
      }
    },
    [sendChatMessage, sendVoiceMessage, advanceTicketStatus],
  );

  const callStatus: CallStatus = tts.isSpeaking ? 'speaking' : isProcessingVoice ? 'thinking' : 'idle';

  // ---------------------------------------------------------------------
  // Cross-channel: reset and brand switch. Both are full resets (clear
  // tickets, both transcripts, both sessions) — switching the `channel`
  // view is the ONLY operation that touches neither.
  // ---------------------------------------------------------------------
  const resetAllFor = useCallback(
    (nextBrand: BrandConfig) => {
      ticketSeqRef.current = 0;
      setTickets([]);

      setChatMessages([{ id: uid(), role: 'agent', text: chatGreetingFor(nextBrand), timestamp: Date.now() }]);
      setChatToolActivity(null);
      setChatStreamingText('');
      setChatIsTyping(false);
      chatSessionRef.current = apiKeyMissing ? null : newSession(buildSystemInstruction(nextBrand));
      chatFactsRef.current = {};

      tts.cancel();
      callStartRef.current = null;
      setCallActive(false);
      setCallSeconds(0);
      setCallMessages([]);
      setCallLog([]);
      setVoiceToolActivity(null);
      setVoiceStreamingText('');
      setIsProcessingVoice(false);
      voiceSessionRef.current = null;
      voiceFactsRef.current = {};
    },
    [apiKeyMissing, tts],
  );

  const setBrand = useCallback(
    (id: string) => {
      const next = getBrandById(id);
      setBrandState(next);
      resetAllFor(next);
    },
    [resetAllFor],
  );

  const reset = useCallback(() => {
    resetAllFor(brandRef.current);
  }, [resetAllFor]);

  return {
    brand,
    setBrand,
    channel,
    setChannel,
    tickets,
    advanceTicketStatus,
    stats,
    apiKeyMissing,
    reset,
    playScenario,
    chat: {
      messages: chatMessages,
      isTyping: chatIsTyping,
      toolActivity: chatToolActivity,
      streamingText: chatStreamingText,
      sendMessage: sendChatMessage,
    },
    voice: {
      messages: callMessages,
      callActive,
      callSeconds,
      callLog,
      callStatus,
      toolActivity: voiceToolActivity,
      streamingText: voiceStreamingText,
      voiceLabel: tts.voiceLabel,
      ttsSupported: tts.isSupported,
      sendMessage: sendVoiceMessage,
      startCall,
      endCall,
    },
  };
}
