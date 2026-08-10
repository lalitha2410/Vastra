import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import { getBrandById, vastraBrand } from '../config/brand';
import type { CallLogEntry, CallStatus, Channel, ChatMessage, ReturnTicket, TranscriptEntry } from '../types';
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
 * Every fact the conversation can establish, and where it comes from:
 *   - orderId, itemId, itemName, paymentMethod  <- lookupOrder (once
 *     unambiguous) and/or checkReturnEligibility
 *   - eligible, ineligibleReason                <- checkReturnEligibility
 *   - reason                                    <- see PENDING CAPTURE below
 *   - availableSizes                            <- getAvailableSizes
 *   - resolution, exchangeSize                  <- see PENDING CAPTURE below
 *   - pickupSlots (offered), pickupLabel (chosen) <- getPickupSlots /
 *     see PENDING CAPTURE below
 *   - ticketId                                  <- createReturnTicket
 *
 * PENDING CAPTURE: `reason`, `exchangeSize`, and the chosen pickup slot are
 * the facts no tool receives as an argument until createReturnTicket is
 * finally called — none of the earlier tools take them, so they can't be
 * read off a tool result the way everything else here can. Each is instead
 * captured positionally via `pendingCapture`: the system prompt's own flow
 * always asks for exactly one of these immediately after the tool call
 * that makes the question obvious (eligibility resolving -> ask reason;
 * sizes fetched -> ask which size; slots fetched -> ask which slot), so
 * the customer's next message is captured as the answer to whichever
 * question is currently pending. Tied to a structured event (a tool call
 * resolving), not pattern-matching on text content — see
 * captureNextReply's own comment for the one narrow exception (mapping a
 * bare "2" back to the numbered list the model itself presented).
 * `createReturnTicket`'s handler below is the final backstop for all
 * three: whatever actually got booked overwrites whatever was guessed.
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
  /** The candidate list a pending 'item' capture resolves against — see
   * pendingCapture below. Set alongside pendingCapture='item', cleared
   * once it resolves (or the order turns out to have just one item). */
  pendingItemOptions?: { itemId: string; name: string }[];
  /** Only true once sendBankDetailsLink actually ran (see tools.ts) —
   * this is what lets the summary tell the model "already sent, don't
   * send or claim to send again" instead of the model being the only
   * record of whether that happened. */
  bankDetailsLinkSent?: boolean;
  /** What the customer's NEXT message should be interpreted as, if
   * nothing else claims it first. Armed by whichever tool call just made
   * the follow-up question obvious; consumed (and cleared) by
   * captureNextReply. At most one fact is ever "pending" at a time —
   * later tool calls in the same turn simply overwrite an earlier one,
   * which matches the flow: the model doesn't ask two different
   * open questions in a row. */
  pendingCapture?: 'item' | 'reason' | 'exchangeSize' | 'slot';
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
 * 2. Deliberately NOT capped at a single digit: an earlier version only
 * matched [1-9], which meant an out-of-range reply like "14" or "6" was
 * silently invisible to this code and fell through to the model to
 * interpret on its own — which is exactly how it ended up guessing a
 * plausible-looking but wrong option instead of the customer's mistyped
 * one. Used for both resolving a valid choice (captureNextReply) and
 * rejecting an invalid one (validatePendingChoice) against the same
 * number. */
function fullNumeral(text: string): number | null {
  const m = text.trim().match(/^(\d+)\b/);
  return m ? Number(m[1]) : null;
}

function updateFacts(facts: ConversationFacts, name: string, args: Record<string, unknown>, result: unknown): void {
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
          facts.pendingCapture = 'item';
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
        // Only arm reason-capture if we don't already have one. This tool
        // gets called more than once in practice (the model re-verifying
        // eligibility before finalizing, seen in live testing) — without
        // this guard, a redundant later call re-opens the capture window
        // and treats the customer's NEXT message — which could be a
        // pickup slot choice, not a reason at all — as a fresh reason,
        // overwriting the correct one already captured with garbage.
        if (r.eligible === true && !facts.reason) facts.pendingCapture = 'reason';
      }
      break;
    case 'getAvailableSizes':
      if (r?.found) {
        facts.availableSizes = r.availableSizes as string[] | undefined;
        // Only called (per the system prompt) when reason is "size" and
        // exchange is being offered — so the customer's next message is
        // their size choice, unless resolution is already settled (e.g.
        // this is a redundant re-check after the ticket's already booked).
        if (!facts.ticketId) facts.pendingCapture = 'exchangeSize';
      }
      break;
    case 'getPickupSlots':
      if (Array.isArray(result)) {
        facts.pickupSlots = result.map((s) => ({ slotId: s.slotId, label: s.label }));
        if (!facts.ticketId) facts.pendingCapture = 'slot';
      }
      break;
    case 'createReturnTicket':
      if (r?.success && r.ticket) {
        const t = r.ticket as ReturnTicket;
        facts.ticketId = t.ticketId;
        // Overwrites whatever pending-capture guessed earlier with the
        // model's own validated values — authoritative by construction
        // (it's what actually got booked), so it corrects a bad
        // positional guess instead of leaving it to linger in the summary
        // for the rest of the conversation.
        facts.reason = t.reason;
        facts.resolution = t.resolution;
        facts.exchangeSize = t.exchangeSize;
        facts.pickupLabel = t.slot?.label;
        facts.pendingCapture = undefined;
      }
      break;
    case 'sendBankDetailsLink':
      if (r?.found) facts.bankDetailsLinkSent = true;
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
function pendingOptionCount(facts: ConversationFacts): number | undefined {
  switch (facts.pendingCapture) {
    case 'item':
      return facts.pendingItemOptions?.length;
    case 'reason':
      return Object.keys(REASON_BY_DIGIT).length;
    case 'exchangeSize':
      return facts.availableSizes?.length;
    case 'slot':
      return facts.pickupSlots?.length;
    default:
      return undefined;
  }
}

const PENDING_CAPTURE_LABEL: Record<NonNullable<ConversationFacts['pendingCapture']>, string> = {
  item: 'which item',
  reason: 'the return reason',
  exchangeSize: 'which size',
  slot: 'which pickup slot',
};

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
 */
function validatePendingChoice(facts: ConversationFacts, incomingMessage: string): string | undefined {
  if (!facts.pendingCapture) return undefined;
  const n = fullNumeral(incomingMessage);
  if (n === null) return undefined;
  const count = pendingOptionCount(facts);
  if (count === undefined || (n >= 1 && n <= count)) return undefined;
  const label = PENDING_CAPTURE_LABEL[facts.pendingCapture];
  return count === 1
    ? `I only have option 1 for ${label} — did you mean that one?`
    : `I only have options 1–${count} for ${label} — which did you mean?`;
}

/**
 * Captures the customer's next message as the answer to whichever
 * question is currently pending (see ConversationFacts.pendingCapture),
 * called right before building this turn's context summary so an answer
 * given in the PREVIOUS turn is captured before it can fall out of the
 * recent-message window in some future turn. Only ever called with a
 * message validatePendingChoice has already approved (in range, or not a
 * bare numeral at all) — this function itself doesn't re-check bounds.
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
 * generated, not fixed prompt text. Everything else (item name typed as
 * prose, exchange size) is stored as-is.
 *
 * Leaves `pendingCapture` set on a bare acknowledgement so the next real
 * answer still gets captured — `createReturnTicket`'s handler in
 * updateFacts is the final backstop if this still ends up wrong.
 */
function captureNextReply(facts: ConversationFacts, incomingMessage: string): void {
  if (!facts.pendingCapture) return;
  const trimmed = incomingMessage.trim();
  if (BARE_ACKNOWLEDGEMENTS.has(trimmed.toLowerCase())) return;

  if (facts.pendingCapture === 'item') {
    const n = fullNumeral(trimmed);
    const options = facts.pendingItemOptions;
    const matched = n && options ? options[n - 1] : undefined;
    if (matched) {
      facts.itemId = matched.itemId;
      facts.itemName = matched.name;
    }
    facts.pendingItemOptions = undefined;
    facts.pendingCapture = undefined;
    return;
  }
  if (facts.pendingCapture === 'reason') {
    const n = fullNumeral(trimmed);
    facts.reason = (n && REASON_BY_DIGIT[String(n)]) || trimmed;
    // Deterministic business rule (see systemPrompt.ts step 4), not a
    // guess about customer intent: only "size" ever goes through the
    // exchange path, so any other reason means the resolution is already
    // known right now, well before getAvailableSizes/getPickupSlots run.
    if (facts.reason !== 'size') facts.resolution = 'refund';
    facts.pendingCapture = undefined;
    return;
  }
  if (facts.pendingCapture === 'exchangeSize') {
    facts.exchangeSize = trimmed;
    facts.resolution = 'exchange';
    facts.pendingCapture = undefined;
    return;
  }
  // 'slot'
  const n = fullNumeral(trimmed);
  const bySlots = facts.pickupSlots;
  const matched = n && bySlots ? bySlots[n - 1] : undefined;
  facts.pickupLabel = matched ? matched.label : trimmed;
  facts.pendingCapture = undefined;
}

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
  return parts.join('. ');
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
  const [tickets, setTickets] = useState<ReturnTicket[]>([]);
  const ticketSeqRef = useRef(0);
  const ticketsRef = useRef<ReturnTicket[]>([]);
  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);
  // Executors run inside an async tool-call loop (see sendAgentMessage), so
  // they need the *current* ticket list at call time for the duplicate-
  // booking guard, not whatever was in scope when this closure was built —
  // a plain `tickets` dependency would also mean a new executor map (and a
  // new sendAgentMessage identity) on every ticket update mid-conversation.
  const buildExecutors = useCallback(
    (currentBrand: BrandConfig): ToolExecutorMap => ({
      lookupOrder: (args) => lookupOrder(currentBrand.catalog, String(args.orderIdOrPhone ?? '')),
      checkReturnEligibility: (args) =>
        checkReturnEligibilityTool(currentBrand.catalog, String(args.orderId ?? ''), String(args.itemId ?? '')),
      getAvailableSizes: (args) =>
        getAvailableSizesTool(currentBrand.catalog, String(args.orderId ?? ''), String(args.itemId ?? '')),
      getPickupSlots: () => getPickupSlotsTool(),
      createReturnTicket: (args) => {
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
        const { result, ticket } = sendBankDetailsLinkTool(ticketsRef.current, String(args.ticketId ?? ''));
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
    const exchangeCount = tickets.filter((t) => t.resolution === 'exchange').length;
    const refundCount = tickets.filter((t) => t.resolution === 'refund').length;
    const valueRetained = tickets
      .filter((t) => t.resolution === 'exchange')
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

  if (!chatSessionRef.current && !apiKeyMissing) {
    chatSessionRef.current = newSession(buildSystemInstruction(brand));
  }

  const sendChatMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || apiKeyMissing || !chatSessionRef.current) return;

      setChatMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed, timestamp: Date.now() }]);

      // Bounds-checked in code before this ever becomes a model turn — see
      // validatePendingChoice's own comment. No tool call, no LLM request,
      // just an immediate correction while the real question stays open.
      const rejection = validatePendingChoice(chatFactsRef.current, trimmed);
      if (rejection) {
        setChatMessages((prev) => [...prev, { id: uid(), role: 'agent', text: rejection, timestamp: Date.now() }]);
        return;
      }

      setChatIsTyping(true);
      setChatToolActivity(CHAT_THINKING_LABEL);
      setChatStreamingText('');
      captureNextReply(chatFactsRef.current, trimmed);
      try {
        const executors = buildExecutors(brandRef.current);
        const reply = await sendAgentMessage(
          chatSessionRef.current,
          trimmed,
          executors,
          (name, args, result) => {
            setChatToolActivity(TOOL_ACTIVITY_LABELS[name] ?? name);
            updateFacts(chatFactsRef.current, name, args, result);
          },
          (textSoFar) => setChatStreamingText(textSoFar),
          factsToSummary(chatFactsRef.current),
        );
        setChatMessages((prev) => [...prev, { id: uid(), role: 'agent', text: reply, timestamp: Date.now() }]);
      } catch (err) {
        const providerName = getActiveProvider().name;
        console.error(`${providerName} request failed`, err);
        const raw = err instanceof Error ? err.message : String(err);
        const errorText = isQuotaError(raw)
          ? "This demo is briefly rate-limited — it clears in about a minute. Hit Reset and try again shortly."
          : "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.";
        setChatMessages((prev) => [...prev, { id: uid(), role: 'agent', text: errorText, timestamp: Date.now() }]);
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
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || apiKeyMissing || !voiceSessionRef.current || !callActive) return;

      setCallMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed, timestamp: Date.now() }]);

      // Same bounds check as the chat channel — see validatePendingChoice.
      // Spoken immediately rather than routed through the model, same as
      // any other agent line on this channel.
      const rejection = validatePendingChoice(voiceFactsRef.current, trimmed);
      if (rejection) {
        setCallMessages((prev) => [...prev, { id: uid(), role: 'agent', text: rejection, timestamp: Date.now() }]);
        speakAgentLine(rejection);
        return;
      }

      setIsProcessingVoice(true);
      setVoiceToolActivity(VOICE_THINKING_LABEL);
      setVoiceStreamingText('');
      captureNextReply(voiceFactsRef.current, trimmed);
      try {
        const executors = buildExecutors(brandRef.current);
        const reply = await sendAgentMessage(
          voiceSessionRef.current,
          trimmed,
          executors,
          (name, args, result) => {
            setVoiceToolActivity(TOOL_ACTIVITY_LABELS[name] ?? name);
            updateFacts(voiceFactsRef.current, name, args, result);
          },
          (textSoFar) => setVoiceStreamingText(textSoFar),
          factsToSummary(voiceFactsRef.current),
        );
        setCallMessages((prev) => [...prev, { id: uid(), role: 'agent', text: reply, timestamp: Date.now() }]);
        speakAgentLine(reply);
      } catch (err) {
        const providerName = getActiveProvider().name;
        console.error(`${providerName} request failed`, err);
        const raw = err instanceof Error ? err.message : String(err);
        const errorText = isQuotaError(raw)
          ? "This demo is briefly rate-limited — it clears in about a minute. Try again shortly."
          : "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.";
        setCallMessages((prev) => [...prev, { id: uid(), role: 'agent', text: errorText, timestamp: Date.now() }]);
        speakAgentLine(errorText);
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
    stats,
    apiKeyMissing,
    reset,
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
