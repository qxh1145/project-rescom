"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface ToggleProps extends Omit<ComponentPropsWithoutRef<"button">, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
}

/**
 * Toggle / switch component (Figma 116:28, 44x26 track).
 * Minimum hit area is 44x44.
 */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  className = "",
  id,
  onClick,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  ...props
}: ToggleProps) {
  const switchElement = (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      className={[
        "relative inline-flex h-[26px] w-[44px] shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        checked ? "bg-primary" : "bg-line-strong",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "inline-block h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none",
          checked ? "translate-x-[18px]" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );

  if (!label && !description) {
    return (
      <div className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center ${className}`}>
        {switchElement}
      </div>
    );
  }

  return (
    <label
      className={[
        "flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1 select-none",
        disabled ? "cursor-not-allowed opacity-60" : "",
        className,
      ].join(" ")}
    >
      <div className="flex flex-col">
        {label && <span className="text-body font-medium text-ink">{label}</span>}
        {description && <span className="text-caption text-ink-muted">{description}</span>}
      </div>
      {switchElement}
    </label>
  );
}
