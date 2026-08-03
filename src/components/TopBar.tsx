import { brands, type BrandConfig } from '../config/brand';

interface TopBarProps {
  brand: BrandConfig;
  onBrandChange: (id: string) => void;
  onReset: () => void;
}

export function TopBar({ brand, onBrandChange, onReset }: TopBarProps) {
  return (
    <div className="flex items-center justify-between border-b border-[#e2e4e8] bg-white px-4 py-2">
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold text-white"
          style={{ backgroundColor: brand.colors.primary }}
        >
          {brand.logoMark}
        </div>
        <div>
          <p className="text-[13.5px] font-semibold leading-tight text-[#111827]">{brand.name} Returns Agent</p>
          <p className="text-[11px] leading-tight text-[#6b7280]">Live demo · chat + ops dashboard</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={brand.id}
          onChange={(e) => onBrandChange(e.target.value)}
          className="rounded-md border border-[#d1d7db] bg-white px-2 py-1.5 text-xs font-medium text-[#3b4a54] outline-none"
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
          className="rounded-md border border-[#d1d7db] bg-white px-2.5 py-1.5 text-xs font-medium text-[#3b4a54] hover:bg-[#f5f6f6]"
        >
          Reset demo
        </button>
      </div>
    </div>
  );
}
