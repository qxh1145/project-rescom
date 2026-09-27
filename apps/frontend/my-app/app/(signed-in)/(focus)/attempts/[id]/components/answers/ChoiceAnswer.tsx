"use client";

import type { MultipleChoiceBlock, SingleChoiceBlock } from "@rescom/schemas";

/**
 * Figma 4 "Label" option rows (62:170 / 62:745): 54px (desktop, 2 columns) /
 * 50px (mobile) cards with a #7C869C border; selected = #EAF6E8 fill,
 * primary border, semibold label. Native inputs keep keyboard support.
 */
const OPTION =
  "flex min-h-[50px] cursor-pointer items-center gap-[15px] rounded-field border border-line-strong bg-surface px-[19px] py-3 text-body text-ink transition-colors hover:border-ink-muted lg:min-h-[54px] lg:px-[21px] " +
  "has-checked:border-primary has-checked:bg-tone-green-bg has-checked:font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary";

interface SingleChoiceProps {
  block: SingleChoiceBlock;
  value: unknown;
  onChange: (value: string) => void;
  labelledBy: string;
  describedBy?: string;
}

export function SingleChoiceAnswer({ block, value, onChange, labelledBy, describedBy }: SingleChoiceProps) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-required={block.required || undefined}
      className="grid gap-2.5 lg:grid-cols-2 lg:gap-3"
    >
      {block.options.map((option) => (
        <label key={option.id} className={OPTION}>
          <input
            type="radio"
            name={block.id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="size-5 shrink-0 cursor-pointer accent-primary"
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

interface MultipleChoiceProps {
  block: MultipleChoiceBlock;
  value: unknown;
  onChange: (value: string[]) => void;
  labelledBy: string;
  describedBy?: string;
}

export function MultipleChoiceAnswer({ block, value, onChange, labelledBy, describedBy }: MultipleChoiceProps) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (item: string, checked: boolean) => {
    const next = checked ? [...selected.filter((entry) => entry !== item), item] : selected.filter((entry) => entry !== item);
    onChange(block.options.map((option) => option.value).filter((entry) => next.includes(entry)));
  };
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="grid gap-2.5 lg:grid-cols-2 lg:gap-3">
      {block.options.map((option) => (
        <label key={option.id} className={OPTION}>
          <input
            type="checkbox"
            value={option.value}
            checked={selected.includes(option.value)}
            onChange={(event) => toggle(option.value, event.target.checked)}
            className="size-5 shrink-0 cursor-pointer rounded-[4px] accent-primary"
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
