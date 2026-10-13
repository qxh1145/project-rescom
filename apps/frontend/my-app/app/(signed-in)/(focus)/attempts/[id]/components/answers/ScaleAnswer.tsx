"use client";

/**
 * Figma 4 Q4 "Button – 1…5" (62:185 / 62:760): equal-width 52px (desktop) /
 * 48px (mobile) buttons, #7C869C border; selected = primary fill, white
 * extra-bold. End labels underneath (visual); assistive tech gets them in the
 * first/last radio's name ("1 – Rất không hài lòng"). Native radios (visually
 * hidden) give arrow-key navigation.
 */
interface ScaleAnswerProps {
  name: string;
  values: number[];
  value: unknown;
  onChange: (value: number) => void;
  minLabel?: string;
  maxLabel?: string;
  labelledBy: string;
  describedBy?: string;
  required?: boolean;
}

export function ScaleAnswer({
  name,
  values,
  value,
  onChange,
  minLabel,
  maxLabel,
  labelledBy,
  describedBy,
  required,
}: ScaleAnswerProps) {
  return (
    <div className="flex flex-col gap-[11px]">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        className="flex gap-2 lg:gap-2.5"
      >
        {values.map((option, index) => (
          <label
            key={option}
            className={[
              "flex h-12 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-field border text-lead font-bold transition-colors lg:h-13 lg:text-[17px]",
              "border-line-strong bg-surface text-ink hover:border-ink-muted",
              "has-checked:border-primary-strong has-checked:bg-primary has-checked:font-extrabold has-checked:text-primary-foreground",
              "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary",
            ].join(" ")}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              aria-label={endLabel(option, index, values.length, minLabel, maxLabel)}
              className="sr-only"
            />
            {option}
          </label>
        ))}
      </div>
      {minLabel || maxLabel ? (
        <p className="flex justify-between gap-4 text-[12px] text-ink-muted lg:text-caption" aria-hidden="true">
          <span>{minLabel}</span>
          <span className="text-right">{maxLabel}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Accessible name of an end point that carries a label; `undefined` keeps the plain number. */
function endLabel(option: number, index: number, count: number, minLabel?: string, maxLabel?: string): string | undefined {
  if (index === 0 && minLabel) return `${option}: ${minLabel}`;
  if (index === count - 1 && maxLabel) return `${option}: ${maxLabel}`;
  return undefined;
}

export function scaleValues(min: number, max: number, step = 1): number[] {
  const values: number[] = [];
  for (let current = min; current <= max; current += Math.max(1, step)) values.push(current);
  return values;
}
