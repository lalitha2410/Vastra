import { useEffect, useRef } from 'react';
import type { BrandConfig } from '../config/brand';
import type { CallLogEntry, Channel, ReturnTicket, TranscriptEntry } from '../types';
import type { Stats } from '../hooks/useReturnAgent';
import { StatRow } from './StatRow';
import { TicketCard, TicketTableHeader } from './TicketCard';

interface OpsDashboardProps {
  brand: BrandConfig;
  tickets: ReturnTicket[];
  /** Demo-only ticket status control — see TicketCard's "Advance (demo)"
   * button. */
  onAdvanceTicket: (ticketId: string) => void;
  stats: Stats;
  toolActivity: string | null;
  channel: Channel;
  /** Voice-only — ignored entirely when channel is 'whatsapp'. The ticket
   * table below is the one thing that never changes between channels;
   * this is the only channel-specific part of this component. */
  callActive: boolean;
  callSeconds: number;
  transcript: TranscriptEntry[];
  callLog: CallLogEntry[];
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function TranscriptLines({ brand, entries }: { brand: BrandConfig; entries: TranscriptEntry[] }) {
  return (
    <div className="flex flex-col gap-1">
      {entries.map((m) => (
        <p key={m.id} className="font-mono text-[11px] leading-snug text-[#374151]">
          <span className="text-[#9ca3af]">{formatClock(m.timestamp)}</span>{' '}
          <span className="font-semibold" style={{ color: m.role === 'user' ? brand.colors.primary : '#111827' }}>
            {m.role === 'user' ? 'Customer' : brand.agentName}:
          </span>{' '}
          {m.text}
        </p>
      ))}
    </div>
  );
}

export function OpsDashboard({
  brand,
  tickets,
  onAdvanceTicket,
  stats,
  toolActivity,
  channel,
  callActive,
  callSeconds,
  transcript,
  callLog,
}: OpsDashboardProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const isVoice = channel === 'voice';

  useEffect(() => {
    if (!isVoice || !callActive) return;
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [isVoice, callActive, transcript]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f6f7f8]">
      <div className="flex items-center justify-between border-b border-[#e2e4e8] bg-white px-3 py-2">
        <div>
          <p className="text-[12.5px] font-semibold leading-tight text-[#111827]">Returns Ops Console</p>
          <p className="text-[11px] leading-tight text-[#6b7280]">
            {brand.name} · {brand.vertical}
          </p>
        </div>
        {isVoice && (
          <div className="text-right">
            <p
              data-testid="call-timer"
              className="font-mono text-[15px] font-semibold leading-tight"
              style={{ color: callActive ? brand.colors.primary : '#9ca3af' }}
            >
              {formatDuration(callActive ? callSeconds : 0)}
            </p>
            <p className="text-[10px] leading-tight text-[#6b7280]">
              {callActive ? 'call in progress' : 'no active call'}
            </p>
          </div>
        )}
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
        {isVoice && (
          <>
            {callActive && (
              <>
                <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#6b7280]">
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full"
                    style={{ backgroundColor: brand.colors.primary }}
                  />
                  Live call ({transcript.length})
                </p>
                <div
                  ref={logRef}
                  className="mb-3 max-h-40 overflow-y-auto rounded-md border border-[#e2e4e8] bg-white px-2.5 py-2"
                >
                  <TranscriptLines brand={brand} entries={transcript} />
                </div>
              </>
            )}

            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#6b7280]">
              Call log ({callLog.length})
            </p>
            {callLog.length === 0 ? (
              !callActive && (
                <div className="mb-3 rounded-md border border-dashed border-[#d1d5db] bg-white/50 px-4 py-6 text-center text-[12.5px] text-[#9ca3af]">
                  No completed calls yet. Start a call and talk to {brand.agentName} to log one.
                </div>
              )
            ) : (
              <div className="mb-3 space-y-1.5">
                {callLog.map((entry) => (
                  <details key={entry.id} className="group rounded-md border border-[#e2e4e8] bg-white">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-[11.5px] marker:content-none">
                      <span className="flex items-center gap-2 text-[#374151]">
                        <svg
                          viewBox="0 0 24 24"
                          width="10"
                          height="10"
                          className="shrink-0 fill-[#9ca3af] transition-transform group-open:rotate-90"
                        >
                          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="font-mono text-[#6b7280]">{formatClock(entry.endedAt)}</span>
                        <span className="font-mono text-[#6b7280]">{formatDuration(entry.durationSeconds)}</span>
                      </span>
                      <span className="truncate text-right font-medium text-[#111827]">{entry.outcome}</span>
                    </summary>
                    <div className="border-t border-[#eef0f2] px-2.5 py-2">
                      <TranscriptLines brand={brand} entries={entry.transcript} />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </>
        )}

        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#6b7280]">
          Active return tickets ({tickets.length})
        </p>
        {tickets.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#d1d5db] bg-white/50 px-4 py-6 text-center text-[12.5px] text-[#9ca3af]">
            {isVoice
              ? `No return tickets yet. Start a call and talk to ${brand.agentName} to create one.`
              : `No return tickets yet. Chat with ${brand.agentName} on the left to create one.`}
          </div>
        ) : (
          <div className="min-w-215 rounded-md border border-[#e2e4e8] bg-white">
            <TicketTableHeader />
            {tickets.map((t) => (
              <TicketCard key={t.ticketId} ticket={t} accent={brand.colors.primary} onAdvance={onAdvanceTicket} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
