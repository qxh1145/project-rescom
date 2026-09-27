import type { ComponentPropsWithRef, ReactNode } from "react";
import { Icon } from "./Icon";

type ToggleChipSize = "sm" | "md" | "lg";

interface ToggleChipProps extends Omit<ComponentPropsWithRef<"button">, "onChange"> {
  selected: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** sm 36–38px (mobile), md 40px, lg 44px (onboarding 12.10: 2px border when selected). */
  size?: ToggleChipSize;
  /** Shown before the label when not selected (selected always shows a check). */
  icon?: ReactNode;
}

/**
 * Selectable pill — page 8 "Chip": white + #7C869C border; hover #F1F4F9 +
 * #596078 border; selected #EAF6E8 + primary border, check icon, bold
 * #1F6B2A; disabled dashed #EEF1F6 ("Hết chỗ").
 */
export function ToggleChip({
  selected,
  onSelectedChange,
  size = "md",
  icon,
  className = "",
  children,
  onClick,
  type = "button",
  ...props
}: ToggleChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onSelectedChange?.(!selected);
      }}
      className={[
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border text-label transition-colors",
        size === "lg" ? (selected ? "h-11 border-2 px-[13.5px]" : "h-11 px-4") : size === "md" ? "h-10 px-4" : "h-9.5 px-3.5",
        selected
          ? "border-primary bg-tone-green-bg font-bold text-primary-strong"
          : "border-line-strong bg-surface font-semibold text-ink enabled:hover:border-ink-muted enabled:hover:bg-surface-subtle",
        "disabled:cursor-not-allowed disabled:border-dashed disabled:bg-disabled disabled:text-disabled-foreground",
        className,
      ].join(" ")}
      {...props}
    >
      {selected ? <Icon name="check" size={14} /> : icon}
      {children}
    </button>
  );
}
