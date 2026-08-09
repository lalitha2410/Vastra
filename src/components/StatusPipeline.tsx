import type { TicketStatus } from '../types';

export function StatusPipeline({ status, sequence, accent }: { status: TicketStatus; sequence: TicketStatus[]; accent: string }) {
  const currentIdx = sequence.indexOf(status);

  return (
    <div className="flex items-center">
      {sequence.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        const reached = idx <= currentIdx;
        return (
          <div key={step} className="flex items-center last:flex-none flex-1">
            <div className="flex flex-col items-center gap-1">
              <div
                className="flex h-5 w-5 items-center justify-center rounded-full border-2 text-[9px] font-bold transition-colors duration-500"
                style={{
                  borderColor: reached ? accent : '#d1d5db',
                  backgroundColor: reached ? accent : '#fff',
                  color: reached ? '#fff' : '#9ca3af',
                }}
              >
                {done ? '✓' : idx + 1}
              </div>
              <span
                className={`w-16 text-center text-[9.5px] leading-tight ${
                  active ? 'font-semibold text-[#111827]' : 'text-[#6b7280]'
                }`}
              >
                {step}
              </span>
            </div>
            {idx < sequence.length - 1 && (
              <div
                className="mx-0.5 mb-4 h-0.5 flex-1 transition-colors duration-700"
                style={{ backgroundColor: idx < currentIdx ? accent : '#e5e7eb' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Dense variant for a table row: dots + connecting line only, no per-step
 * labels (a labeled dot per step doesn't fit a table row), plus a single
 * caption for the current step so the row still states its status in words.
 * `sequence` is per-ticket (see statusSequenceFor in types.ts), not a fixed
 * global order — a COD refund and a Prepaid refund reach different final
 * steps, so the caller computes the right 5-step sequence for its ticket
 * and hands it down rather than this component assuming one universal
 * pipeline applies to every ticket. */
export function StatusPipelineCompact({
  status,
  sequence,
  accent,
}: {
  status: TicketStatus;
  sequence: TicketStatus[];
  accent: string;
}) {
  const currentIdx = sequence.indexOf(status);

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center">
        {sequence.map((step, idx) => {
          const reached = idx <= currentIdx;
          return (
            <div key={step} className="flex items-center">
              <div
                className="h-1.75 w-1.75 rounded-full transition-colors duration-500"
                style={{ backgroundColor: reached ? accent : '#e0e2e6' }}
              />
              {idx < sequence.length - 1 && (
                <div
                  className="h-0.5 w-2.5 transition-colors duration-700"
                  style={{ backgroundColor: idx < currentIdx ? accent : '#e0e2e6' }}
                />
              )}
            </div>
          );
        })}
      </div>
      <span className="whitespace-nowrap text-[11px] font-medium text-[#374151]">{status}</span>
    </div>
  );
}
