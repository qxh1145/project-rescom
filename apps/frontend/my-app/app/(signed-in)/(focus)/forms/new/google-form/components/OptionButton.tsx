import type { ComponentPropsWithRef } from "react";
import { Icon } from "@/components/ui/Icon";

interface OptionButtonProps extends ComponentPropsWithRef<"button"> {
  selected: boolean;
}

/**
 * Figma 9a "Button – 5 – 10 phút" / 9b desktop "Button – Tất cả": a 48px
 * single-choice button (12px radius); selected = green fill, primary border,
 * check icon, bold label.
 */
export function OptionButton({ selected, className = "", children, type = "button", ...props }: OptionButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={[
        "inline-flex h-12 items-center justify-center gap-2 rounded-field border px-3 text-label transition-colors",
        selected
          ? "border-primary bg-tone-green-bg font-bold text-primary-strong"
          : "border-line-strong bg-surface font-semibold text-ink hover:border-ink-muted hover:bg-surface-subtle",
        className,
      ].join(" ")}
      {...props}
    >
      {selected ? <Icon name="check" size={14} /> : null}
      {children}
    </button>
  );
}
