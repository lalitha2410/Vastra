// Shared domain types for the returns-agent demo.

export type PaymentMethod = 'Prepaid' | 'COD';

export interface OrderItem {
  itemId: string;
  name: string;
  size: string;
  colour: string;
  price: number; // INR
  imageUrl: string;
  finalSale: boolean;
  /** Sizes this item could be exchanged into (excludes current size). */
  availableSizes: string[];
}

export interface Order {
  orderId: string;
  customerName: string;
  phone: string;
  city: string;
  items: OrderItem[];
  deliveryDate: string; // ISO date, relative to "today" in policy.ts
  paymentMethod: PaymentMethod;
  returnWindowDays: number;
}

export type ReturnReason = 'size' | 'quality' | 'not_as_described' | 'changed_mind';

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  size: 'Size issue',
  quality: 'Quality issue',
  not_as_described: 'Not as described',
  changed_mind: 'Changed my mind',
};

export type Resolution = 'exchange' | 'refund';

export type TicketStatus =
  | 'Initiated'
  | 'Approved'
  | 'Pickup Scheduled'
  | 'In Transit'
  | 'Refunded';

export const TICKET_STATUS_ORDER: TicketStatus[] = [
  'Initiated',
  'Approved',
  'Pickup Scheduled',
  'In Transit',
  'Refunded',
];

export interface PickupSlot {
  slotId: string;
  label: string; // e.g. "Tomorrow, 10 AM – 1 PM"
  date: string;
}

export interface ReturnTicket {
  ticketId: string;
  orderId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  itemImageUrl: string;
  reason: ReturnReason;
  resolution: Resolution;
  exchangeSize?: string;
  status: TicketStatus;
  slot?: PickupSlot;
  itemPrice: number;
  refundAmount: number;
  refundDestination: string;
  paymentMethod: PaymentMethod;
  createdAt: number; // epoch ms
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: number;
  pending?: boolean;
}

/** Which channel a conversation is happening over — the one flag that
 * decides system prompt, sanitizer, and left-panel UI (see App.tsx,
 * useReturnAgent.ts). Everything else (policy, tools, provider) is
 * identical regardless of this value. */
export type Channel = 'whatsapp' | 'voice';

/** One turn in a voice call transcript. Structurally identical to
 * ChatMessage aside from `interim` vs `pending` — kept as a separate type
 * because the two mean different things: `interim` marks a not-yet-final
 * speech-recognition guess (shown dimmed, replaced in place once the
 * browser finalizes it), never appended as a separate entry. */
export interface TranscriptEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: number;
  interim?: boolean;
}

/** Drives the mic button's visual state and the call header's status line.
 * - idle: waiting for the customer to speak or type
 * - listening: SpeechRecognition is capturing audio
 * - thinking: transcript sent, waiting on the LLM (tool calls included)
 * - speaking: speechSynthesis is reading the agent's reply aloud
 */
export type CallStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

/** A completed call, archived when the customer hangs up. An ops team
 * watches calls across an entire day, not one at a time — so ending a call
 * logs it instead of discarding the transcript (see useReturnAgent.ts's
 * endCall). `outcome` is derived from whichever tickets were created
 * between call start and call end, not from anything the model said. */
export interface CallLogEntry {
  id: string;
  endedAt: number;
  durationSeconds: number;
  transcript: TranscriptEntry[];
  outcome: string;
}
