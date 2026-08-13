import { useState, type ReactNode } from 'react';
import type { Channel } from '../types';

interface SplitViewProps {
  accent: string;
  channel: Channel;
  left: ReactNode;
  ops: ReactNode;
}

/**
 * Fixed 35/65 split above `md` (768px), chat/ops — matches the cart-
 * recovery demo's proportions rather than an even split. The chat/call
 * panel only ever needs to fit narrow WhatsApp bubbles or a call
 * transcript; the ops console carries a table plus ticket cards — it's the
 * side that actually needs the room. The split is never allowed to shrink
 * into two unreadable slivers below `md`, where the active panel goes full
 * width via a tab switcher instead. Both panels stay mounted (hidden, not
 * unmounted) so switching tabs doesn't lose chat scroll position, an
 * in-progress draft, or an active SpeechRecognition session.
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
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[35fr_65fr]">
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
