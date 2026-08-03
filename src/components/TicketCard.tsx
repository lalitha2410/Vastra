import type { ReturnTicket } from '../types';
import { RETURN_REASON_LABELS } from '../types';
import { StatusPipeline } from './StatusPipeline';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function TicketCard({ ticket, accent }: { ticket: ReturnTicket; accent: string }) {
  const isExchange = ticket.resolution === 'exchange';

  return (
    <div
      data-testid="ticket-card"
      data-status={ticket.status}
      className="wa-bubble-in rounded-md border border-[#e2e4e8] bg-white p-3 shadow-sm"
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <img
            src={ticket.itemImageUrl}
            alt={ticket.itemName}
            className="h-11 w-9 rounded border border-[#e2e4e8] object-cover"
          />
          <div>
            <p className="text-[13px] font-semibold text-[#111827]">
              {ticket.ticketId}
              <span className="ml-2 font-normal text-[#6b7280]">{ticket.orderId}</span>
            </p>
            <p className="text-[12.5px] text-[#374151]">{ticket.itemName}</p>
            <p className="text-[11.5px] text-[#6b7280]">{ticket.customerName}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={
              isExchange
                ? { backgroundColor: `${accent}1a`, color: accent }
                : { backgroundColor: '#F3F4F6', color: '#4B5563' }
            }
          >
            {isExchange ? `Exchange → ${ticket.exchangeSize}` : 'Refund'}
          </span>
          <span className="text-[11px] text-[#6b7280]">{RETURN_REASON_LABELS[ticket.reason]}</span>
        </div>
      </div>

      <StatusPipeline status={ticket.status} accent={accent} />

      <div className="mt-2.5 flex items-center justify-between border-t border-[#f1f2f4] pt-2 text-[11.5px] text-[#4b5563]">
        <span>{ticket.slot?.label ?? '—'}</span>
        <span className="font-medium text-[#111827]">
          {isExchange ? 'No refund · item swapped' : `${rupee.format(ticket.refundAmount)} → ${ticket.refundDestination}`}
        </span>
      </div>
    </div>
  );
}
