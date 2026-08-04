import { useState, type ReactNode } from 'react';
import type { Channel } from '../types';

interface SplitViewProps {
  accent: string;
  channel: Channel;
  left: ReactNode;
  ops: ReactNode;
}

/**
 * Chosen responsive approach: a tab switcher below `md` (768px), not a
 * shrunk side-by-side split and not a swipeable sheet. Below `md` each
 * panel gets the full viewport width when active — the 50/50 split is
 * never compressed into two unreadable slivers. Both panels stay mounted
 * (hidden, not unmounted) so switching tabs doesn't lose chat scroll
 * position, an in-progress draft, or an active SpeechRecognition session.
 *
 * The left tab's label follows `channel` (💬 Chat / 📞 Call) since it's
 * literally a different panel depending which channel is active — this is
 * the mobile echo of the channel switcher in TopBar, not a separate
 * concept.
 */
export function SplitView({ accent, channel, left, ops }: SplitViewProps) {
  const [mobileTab, setMobileTab] = useState<'left' | 'ops'>('left');

  const tabButtonClass = (tab: 'left' | 'ops') =>
    `flex-1 border-b-2 py-2 text-[12.5px] font-medium transition-colors ${
      mobileTab === tab ? 'text-[#111827]' : 'border-transparent text-[#6b7280]'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[1fr_1.3fr]">
      <div className="flex border-b border-[#e2e4e8] bg-white md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab('left')}
          className={tabButtonClass('left')}
          style={mobileTab === 'left' ? { borderColor: accent, color: accent } : undefined}
        >
          {channel === 'voice' ? '📞 Call' : '💬 Chat'}
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
          mobileTab === 'left' ? 'flex' : 'hidden md:flex'
        }`}
      >
        {left}
      </div>
      <div className={`min-h-0 flex-1 flex-col ${mobileTab === 'ops' ? 'flex' : 'hidden md:flex'}`}>{ops}</div>
    </div>
  );
}
