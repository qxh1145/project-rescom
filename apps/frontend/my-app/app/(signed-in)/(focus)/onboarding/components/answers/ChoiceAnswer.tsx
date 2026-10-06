import type { ReactNode } from "react";

export interface ChoiceOption {
  value: string;
  label: string;
  /** Mobile wording when it differs ("Năm 5+" → "Năm 5 trở lên", 63:6097). */
  longLabel?: string;
  /** "rich" layout only (12.11). */
  description?: string;
  /** "rich" layout only: the 44px icon tile. */
  tile?: ReactNode;
}

/**
 * - `grid`: 1 column mobile, 2 × 314px desktop (12.3 giới tính, 12.5, 12.8, 12.9)
 * - `list`: 1 column everywhere (12.6 trường)
 * - `row`: 1 column mobile, one row of equal cells desktop (12.7 năm học)
 * - `rich`: icon tile + title + description, radio on the right (12.11 mục tiêu)
 */
export type ChoiceLayout = "grid" | "list" | "row" | "rich";

interface ChoiceAnswerProps {
  name: string;
  /** id of the question heading (the group's accessible name). */
  labelledBy: string;
  errorId?: string;
  options: readonly ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  layout?: ChoiceLayout;
}

const GROUP_CLASSES: Record<ChoiceLayout, string> = {
  grid: "grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3",
  list: "grid grid-cols-1 gap-2.5",
  row: "flex flex-col gap-2.5 lg:flex-row",
  rich: "grid grid-cols-1 gap-2.5",
};

/** Radio card (62:2543 / 62:2546): 56px, #7C869C border; checked = 2px primary border on #EAF6E8, bold green label. */
const CARD =
  "flex cursor-pointer items-center rounded-control bg-surface transition-colors " +
  "border border-line-strong hover:border-ink-muted " +
  "has-checked:border-2 has-checked:border-primary has-checked:bg-tone-green-bg";

const RADIO = "size-5 shrink-0 cursor-pointer accent-primary";

export function ChoiceAnswer({
  name,
  labelledBy,
  errorId,
  options,
  value,
  onChange,
  layout = "grid",
}: ChoiceAnswerProps) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={errorId}
      aria-invalid={errorId ? true : undefined}
      className={GROUP_CLASSES[layout]}
    >
      {options.map((option, index) => {
        const id = `${name}-${index}`;
        const input = (
          <input
            id={id}
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className={RADIO}
          />
        );

        if (layout === "rich") {
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={`${CARD} group min-h-21 gap-3 px-4 py-3.5 has-checked:px-[15px] has-checked:py-[13px] lg:pr-4.5 lg:has-checked:pr-[17px]`}
            >
              {option.tile}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-button font-bold text-ink group-has-checked:text-primary-strong">{option.label}</span>
                {option.description ? (
                  <span className="text-caption leading-[18.9px] text-ink-muted">{option.description}</span>
                ) : null}
              </span>
              {input}
            </label>
          );
        }

        const centered = layout === "row" ? "lg:flex-1 lg:justify-center lg:text-body" : "";
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={`${CARD} min-h-14 gap-3 px-4 py-2 text-lead leading-5 font-semibold text-ink has-checked:px-[15px] has-checked:py-[7px] has-checked:font-bold has-checked:text-primary-strong ${centered}`}
          >
            {input}
            {option.longLabel ? (
              <>
                <span className="lg:hidden">{option.longLabel}</span>
                <span className="hidden whitespace-nowrap lg:inline">{option.label}</span>
              </>
            ) : (
              <span>{option.label}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
