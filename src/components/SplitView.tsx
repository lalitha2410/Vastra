import { useState, type ReactNode } from 'react';

interface SplitViewProps {
  accent: string;
  chat: ReactNode;
  ops: ReactNode;
}

/**
 * Chosen responsive approach: a tab switcher below `md` (768px), not a
 * shrunk side-by-side split and not a swipeable sheet. Below `md` each
 * panel gets the full viewport width when active — the 50/50 split is
 * never compressed into two unreadable slivers. Both panels stay mounted
 * (hidden, not unmounted) so switching tabs doesn't lose chat scroll
 * position or an in-progress draft.
 */
export function SplitView({ accent, chat, ops }: SplitViewProps) {
  const [mobileTab, setMobileTab] = useState<'chat' | 'ops'>('chat');

  const tabButtonClass = (tab: 'chat' | 'ops') =>
    `flex-1 border-b-2 py-2 text-[12.5px] font-medium transition-colors ${
      mobileTab === tab ? 'text-[#111827]' : 'border-transparent text-[#6b7280]'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[1fr_1.3fr]">
      <div className="flex border-b border-[#e2e4e8] bg-white md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab('chat')}
          className={tabButtonClass('chat')}
          style={mobileTab === 'chat' ? { borderColor: accent, color: accent } : undefined}
        >
          💬 Chat
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('ops')}
          className={tabButtonClass('ops')}
          style={mobileTab === 'ops' ? { borderColor: accent, color: accent } : undefined}
        >
          📋 Ops console
        </button>
      </div>

      <div
        className={`min-h-0 flex-1 flex-col border-[#e2e4e8] md:flex-none md:border-r ${
          mobileTab === 'chat' ? 'flex' : 'hidden md:flex'
        }`}
      >
        {chat}
      </div>
      <div className={`min-h-0 flex-1 flex-col ${mobileTab === 'ops' ? 'flex' : 'hidden md:flex'}`}>{ops}</div>
    </div>
  );
}
