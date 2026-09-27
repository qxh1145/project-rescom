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
  className = "",
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = segments.findIndex((segment) => segment.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex rounded-[14px] bg-surface-subtle p-1.25 ${fullWidth ? "w-full" : ""} ${className}`}
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
              "h-9 whitespace-nowrap rounded-[10px] px-4 text-label transition-colors",
              fullWidth ? "flex-1" : "",
              active ? "bg-surface font-bold text-ink shadow-[0_1px_2px_rgba(30,36,70,0.12)]" : "font-semibold text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
