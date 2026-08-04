import { brands, type BrandConfig } from '../config/brand';
import type { Channel } from '../types';

interface TopBarProps {
  brand: BrandConfig;
  channel: Channel;
  onBrandChange: (id: string) => void;
  onChannelChange: (channel: Channel) => void;
  onReset: () => void;
}

export function TopBar({ brand, channel, onBrandChange, onChannelChange, onReset }: TopBarProps) {
  const channelButtonClass = (target: Channel) =>
    `flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors sm:px-2.5 sm:text-xs ${
      channel === target ? 'text-white' : 'text-[#3b4a54] hover:bg-[#f5f6f6]'
    }`;

  return (
    <div className="flex items-center justify-between gap-2 border-b border-[#e2e4e8] bg-white px-2.5 py-1.5 sm:px-4 sm:py-2">
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[13px] font-bold text-white sm:h-8 sm:w-8 sm:text-sm"
          style={{ backgroundColor: brand.colors.primary }}
        >
          {brand.logoMark}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold leading-tight text-[#111827] sm:text-[13.5px]">
            {brand.name} Returns Agent
          </p>
          <p className="hidden truncate text-[11px] leading-tight text-[#6b7280] sm:block">
            Live demo · WhatsApp + Voice · ops dashboard
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {/* Channel switcher — the point of this demo, so it sits right next
            to the brand switcher, not tucked away. Switching never resets
            either channel's conversation or the shared ticket list. */}
        <div className="flex overflow-hidden rounded-md border border-[#d1d7db]">
          <button
            type="button"
            onClick={() => onChannelChange('whatsapp')}
            className={channelButtonClass('whatsapp')}
            style={channel === 'whatsapp' ? { backgroundColor: brand.colors.primary } : undefined}
          >
            💬 <span className="hidden sm:inline">WhatsApp</span>
          </button>
          <button
            type="button"
            onClick={() => onChannelChange('voice')}
            className={channelButtonClass('voice')}
            style={channel === 'voice' ? { backgroundColor: brand.colors.primary } : undefined}
          >
            📞 <span className="hidden sm:inline">Voice</span>
          </button>
        </div>

        <select
          value={brand.id}
          onChange={(e) => onBrandChange(e.target.value)}
          className="max-w-23 rounded-md border border-[#d1d7db] bg-white px-1.5 py-1 text-[11px] font-medium text-[#3b4a54] outline-none sm:max-w-none sm:px-2 sm:py-1.5 sm:text-xs"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.vertical})
            </option>
          ))}
        </select>
        <span className="hidden text-[10px] text-[#9ca3af] md:inline">Demo session · refresh resets all data</span>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-[#d1d7db] bg-white px-2 py-1 text-[11px] font-medium text-[#3b4a54] hover:bg-[#f5f6f6] sm:px-2.5 sm:py-1.5 sm:text-xs"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
