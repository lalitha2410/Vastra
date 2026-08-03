import type { BrandConfig } from '../config/brand';
import type { ReturnTicket } from '../types';
import type { Stats } from '../hooks/useReturnAgent';
import { StatRow } from './StatRow';
import { TicketCard } from './TicketCard';

interface OpsDashboardProps {
  brand: BrandConfig;
  tickets: ReturnTicket[];
  stats: Stats;
  toolActivity: string | null;
}

export function OpsDashboard({ brand, tickets, stats, toolActivity }: OpsDashboardProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f6f7f8]">
      <div className="border-b border-[#e2e4e8] bg-white px-4 py-2.5">
        <p className="text-[13px] font-semibold text-[#111827]">Returns Ops Console</p>
        <p className="text-[11.5px] text-[#6b7280]">{brand.name} · {brand.vertical}</p>
      </div>

      <div
        data-testid="tool-activity"
        data-active={toolActivity ? 'true' : 'false'}
        className={`flex items-center gap-2 border-b border-[#e2e4e8] bg-white px-4 text-[12px] font-medium text-[#374151] transition-[height,opacity,padding] duration-200 ${
          toolActivity ? 'h-9 py-2 opacity-100' : 'h-0 overflow-hidden py-0 opacity-0'
        }`}
      >
        <span
          className="h-2 w-2 shrink-0 animate-pulse rounded-full"
          style={{ backgroundColor: brand.colors.primary }}
        />
        <span>{toolActivity}</span>
      </div>

      <StatRow stats={stats} accent={brand.colors.primary} />

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">
          Active return tickets ({tickets.length})
        </p>
        {tickets.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#d1d5db] bg-white/50 px-4 py-8 text-center text-[13px] text-[#9ca3af]">
            No return tickets yet. Chat with {brand.agentName} on the left to create one.
          </div>
        ) : (
          <div className="space-y-2.5">
            {tickets.map((t) => (
              <TicketCard key={t.ticketId} ticket={t} accent={brand.colors.primary} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
