import type { BrandConfig } from '../config/brand';
import type { ReturnTicket } from '../types';
import type { Stats } from '../hooks/useReturnAgent';
import { StatRow } from './StatRow';
import { TicketCard, TicketTableHeader } from './TicketCard';

interface OpsDashboardProps {
  brand: BrandConfig;
  tickets: ReturnTicket[];
  stats: Stats;
  toolActivity: string | null;
}

export function OpsDashboard({ brand, tickets, stats, toolActivity }: OpsDashboardProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f6f7f8]">
      <div className="border-b border-[#e2e4e8] bg-white px-3 py-2">
        <p className="text-[12.5px] font-semibold leading-tight text-[#111827]">Returns Ops Console</p>
        <p className="text-[11px] leading-tight text-[#6b7280]">
          {brand.name} · {brand.vertical}
        </p>
      </div>

      <div
        data-testid="tool-activity"
        data-active={toolActivity ? 'true' : 'false'}
        className={`flex items-center gap-2 border-b border-[#e2e4e8] bg-white px-3 text-[11.5px] font-medium text-[#374151] transition-[height,opacity,padding] duration-200 ${
          toolActivity ? 'h-7 py-1.5 opacity-100' : 'h-0 overflow-hidden py-0 opacity-0'
        }`}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
          style={{ backgroundColor: brand.colors.primary }}
        />
        <span>{toolActivity}</span>
      </div>

      <StatRow stats={stats} accent={brand.colors.primary} />

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#6b7280]">
          Active return tickets ({tickets.length})
        </p>
        {tickets.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#d1d5db] bg-white/50 px-4 py-6 text-center text-[12.5px] text-[#9ca3af]">
            No return tickets yet. Chat with {brand.agentName} on the left to create one.
          </div>
        ) : (
          <div className="min-w-215 rounded-md border border-[#e2e4e8] bg-white">
            <TicketTableHeader />
            {tickets.map((t) => (
              <TicketCard key={t.ticketId} ticket={t} accent={brand.colors.primary} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
