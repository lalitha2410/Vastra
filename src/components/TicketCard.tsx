import type { ReturnTicket } from '../types';
import { RETURN_REASON_LABELS, statusSequenceFor } from '../types';
import { StatusPipelineCompact } from './StatusPipeline';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

// Shared column widths so the header and every row line up exactly.
const GRID_COLS = 'grid-cols-[104px_112px_minmax(160px,1fr)_112px_188px_150px_128px]';

export function TicketTableHeader() {
  return (
    <div
      className={`grid ${GRID_COLS} gap-3 border-b border-[#e2e4e8] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#6b7280]`}
    >
      <span>Ticket</span>
      <span>Customer</span>
      <span>Item</span>
      <span>Resolution</span>
      <span>Status</span>
      <span className="text-right">Pickup / Amount</span>
      <span className="text-right">Demo</span>
    </div>
  );
}

export function TicketCard({
  ticket,
  accent,
  onAdvance,
}: {
  ticket: ReturnTicket;
  accent: string;
  /** Demo-only — see the button below. Not something a real ops console
   * would expose; this app has no real courier/bank integration to react
   * to, so a presenter triggering the next stage explicitly is more
   * honest than either a fake timer or a pipeline that just sits there. */
  onAdvance: (ticketId: string) => void;
}) {
  const isExchange = ticket.resolution === 'exchange';
  // COD refund is the one case where a real customer action (handing over
  // bank details) still has to happen before the money moves — shown here
  // so the ops console visibly reflects whether sendBankDetailsLink has
  // actually run, not just whatever the agent claims in the transcript.
  const showBankLinkStatus = !isExchange && ticket.paymentMethod === 'COD';

  const sequence = statusSequenceFor(ticket);
  const nextStatus = sequence[sequence.indexOf(ticket.status) + 1];

  return (
    <div
      data-testid="ticket-card"
      data-status={ticket.status}
      className={`wa-bubble-in grid ${GRID_COLS} items-center gap-3 border-b border-[#eef0f2] bg-white px-3 py-2 text-[12px] last:border-b-0 hover:bg-[#fafafa]`}
    >
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-semibold text-[#111827]">{ticket.ticketId}</p>
        <p className="truncate text-[11px] text-[#6b7280]">{ticket.orderId}</p>
      </div>

      <p className="truncate text-[12px] text-[#374151]">{ticket.customerName}</p>

      <div className="min-w-0">
        <p className="truncate text-[12px] text-[#111827]">{ticket.itemName}</p>
        <p className="truncate text-[11px] text-[#6b7280]">{RETURN_REASON_LABELS[ticket.reason]}</p>
      </div>

      <span
        className="inline-block w-fit rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
        style={
          isExchange
            ? { backgroundColor: `${accent}1a`, color: accent }
            : { backgroundColor: '#F3F4F6', color: '#4B5563' }
        }
      >
        {isExchange ? `Exchange → ${ticket.exchangeSize}` : 'Refund'}
      </span>

      <StatusPipelineCompact status={ticket.status} sequence={sequence} accent={accent} />

      <div className="text-right">
        <p className="truncate text-[11.5px] text-[#4b5563]">{ticket.slot?.label ?? '—'}</p>
        <p className="truncate text-[12px] font-medium text-[#111827]">
          {isExchange ? 'No refund' : rupee.format(ticket.refundAmount)}
        </p>
        {showBankLinkStatus && (
          <p className="truncate text-[10.5px]" style={{ color: ticket.bankDetailsLinkSentAt ? accent : '#b45309' }}>
            {ticket.bankDetailsLinkSentAt ? '✓ Bank link sent' : '⏳ Bank link pending'}
          </p>
        )}
      </div>

      <div className="text-right">
        {nextStatus ? (
          <button
            type="button"
            onClick={() => onAdvance(ticket.ticketId)}
            title={`Demo control — this app has no real courier or bank integration to react to, so nothing advances the pipeline on its own. Click to simulate "${nextStatus}" for a live presentation; this is not part of the customer-facing product.`}
            className="w-full rounded border border-dashed border-[#c9a13b] bg-[#fdf6e3] px-1.5 py-1 text-right text-[10px] font-semibold leading-tight text-[#92720f] transition-colors hover:bg-[#faedc4]"
          >
            ▸ Advance <span className="font-normal">(demo)</span>
            <span className="block truncate text-[9.5px] font-normal text-[#a3841f]">to {nextStatus}</span>
          </button>
        ) : (
          <span className="text-[10px] text-[#9ca3af]">—</span>
        )}
      </div>
    </div>
  );
}
