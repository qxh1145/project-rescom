"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { TOP_UP_PACKAGES, formatVnd, topUpVnd } from "@/lib/wallet/top-up";

interface PackageOptionsProps {
  name: string;
  /** Selected package, or null when a custom amount is typed. */
  value: number | null;
  onChange: (points: number) => void;
  legend: ReactNode;
  legendClassName?: string;
  /**
   * `compact` — wallet desktop card 62:287 (64px, 16px label, check icon);
   * `large` — 14a mobile 62:2815 (76px, 17px label).
   */
  size: "compact" | "large";
}

/** Figma "Button – 100 điểm" / "Label": radio cards; selected = 2px primary border on tone-green-bg. */
export function PackageOptions({ name, value, onChange, legend, legendClassName = "sr-only", size }: PackageOptionsProps) {
  const compact = size === "compact";
  return (
    <fieldset>
      <legend className={legendClassName}>{legend}</legend>
      <div className="grid grid-cols-3 gap-2.5">
        {TOP_UP_PACKAGES.map((points) => {
          const selected = value === points;
          return (
            <label
              key={points}
              className={[
                "flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-control text-center transition-colors",
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary",
                compact ? "h-16" : "h-19",
                selected ? "border-2 border-primary bg-tone-green-bg" : "border border-line-strong bg-surface hover:border-ink-strong",
              ].join(" ")}
            >
              <input
                type="radio"
                name={name}
                value={points}
                checked={selected}
                onChange={() => onChange(points)}
                className="sr-only"
              />
              <span
                className={[
                  "inline-flex items-center gap-1 font-extrabold",
                  compact ? "text-[16px]" : "text-[17px]",
                  selected ? "text-tone-green-fg" : "text-ink",
                ].join(" ")}
              >
                {compact && selected ? <Icon name="check" size={14} /> : null}
                {points} điểm
              </span>
              <span
                className={[
                  compact ? "text-[12px]" : "text-caption",
                  compact && selected ? "text-ink-strong" : "text-ink-muted",
                ].join(" ")}
              >
                {formatVnd(topUpVnd(points))}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
