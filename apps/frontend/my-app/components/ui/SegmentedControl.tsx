"use client";

import { useRef } from "react";
import { radioGroupKeyTarget } from "./radio-group-keys";

interface Segment<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Stretch segments to fill the container (mobile). */
  fullWidth?: boolean;
  /**
   * `bordered` = Figma 16b "Loại bảng xếp hạng" (63:3136): 50px track with a
   * #7C869C border and 4px padding, 40px segments, active one outlined in ink.
   */
  variant?: "pill" | "bordered";
  className?: string;
}

/**
 * Figma "Lọc giao dịch" / "Loại bảng xếp hạng": #F1F4F9 track with 5px
 * padding, the active segment is a white pill.
 *
 * Radio group keyboard model: one tab stop (the selected segment, or the
 * first when none is selected — roving tabIndex); Arrow keys, Home and End
 * move focus and selection follows focus.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  fullWidth = false,
  variant = "pill",
  className = "",
}: SegmentedControlProps<T>) {
  const bordered = variant === "bordered";
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = segments.findIndex((segment) => segment.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[
        "inline-flex bg-surface-subtle",
        bordered ? "rounded-field border border-line-strong p-1" : "rounded-[14px] p-1.25",
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
    >
      {segments.map((segment, index) => {
        const active = index === selectedIndex;
        return (
          <button
            key={segment.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(segment.value)}
            onKeyDown={(event) => {
              const target = radioGroupKeyTarget(event.key, index, segments.length);
              if (target === null) return;
              event.preventDefault();
              refs.current[target]?.focus();
              if (segments[target].value !== value) onChange(segments[target].value);
            }}
            className={[
              "whitespace-nowrap px-4 text-label transition-colors",
              bordered ? "h-10 rounded-[9px] border" : "h-9 rounded-[10px]",
              fullWidth ? "flex-1" : "",
              active
                ? `bg-surface font-bold text-ink ${bordered ? "border-ink" : "shadow-[0_1px_2px_rgba(30,36,70,0.12)]"}`
                : `font-semibold hover:text-ink ${bordered ? "border-transparent text-ink-strong" : "text-ink-muted"}`,
            ].join(" ")}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
