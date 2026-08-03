import type { Stats } from '../hooks/useReturnAgent';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex-1 rounded-md border border-[#e2e4e8] bg-white px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wide text-[#6b7280]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold" style={{ color: accent ?? '#111827' }}>
        {value}
      </p>
    </div>
  );
}

export function StatRow({ stats, accent }: { stats: Stats; accent: string }) {
  const totalResolved = stats.exchangeCount + stats.refundCount;
  const splitLabel = totalResolved === 0 ? '—' : `${stats.exchangeCount} : ${stats.refundCount}`;

  return (
    <div className="flex gap-2.5 px-4 py-3">
      <Tile label="Returns today" value={String(stats.returnsToday)} />
      <Tile label="Exchange : Refund" value={splitLabel} accent={accent} />
      <Tile label="Value retained" value={rupee.format(stats.valueRetained)} accent={accent} />
    </div>
  );
}
