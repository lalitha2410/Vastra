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
