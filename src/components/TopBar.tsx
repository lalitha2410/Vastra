import { brands, type BrandConfig } from '../config/brand';

interface TopBarProps {
  brand: BrandConfig;
  onBrandChange: (id: string) => void;
  onReset: () => void;
}

export function TopBar({ brand, onBrandChange, onReset }: TopBarProps) {
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
            Live demo · chat + ops dashboard
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
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
