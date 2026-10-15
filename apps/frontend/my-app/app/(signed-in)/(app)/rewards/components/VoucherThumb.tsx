import type { VoucherCategory } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import {
  brandInitials,
  brandTintClass,
  CATEGORY_GLYPH,
} from "@/lib/rewards/voucher-display";

interface VoucherThumbProps {
  brand: { id: string; name: string };
  category: VoucherCategory;
  imageUrl?: string | null;
  /** tile / flash: full-bleed card bands (120 / 96 px tall); the parent card clips the corners. */
  size?: "sm" | "md" | "lg" | "tile" | "flash";
  className?: string;
}

export function VoucherThumb({
  brand,
  category,
  imageUrl,
  size = "md",
  className = "",
}: VoucherThumbProps) {
  const isBand = size === "tile" || size === "flash";
  const boxSize =
    size === "lg"
      ? "h-full w-full"
      : size === "tile"
      ? "h-30 w-full"
      : size === "flash"
      ? "h-24 w-full"
      : size === "sm"
      ? "w-14 h-14"
      : "w-20 h-20";
  const radius = isBand ? "" : "rounded-[16px]";

  if (imageUrl) {
    return (
      <div className={`relative shrink-0 overflow-hidden ${radius} bg-surface-subtle ${boxSize} ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  const tint = brandTintClass(brand.id, category);
  const initials = brandInitials(brand);
  const glyph = CATEGORY_GLYPH[category] ?? "coffee";

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center ${radius} ${tint} ${boxSize} ${className}`}
    >
      <Icon name={glyph} size={size === "lg" || isBand ? 48 : size === "sm" ? 22 : 32} />
      <span className="absolute bottom-1.5 right-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-ink shadow-xs">
        {initials}
      </span>
    </div>
  );
}
