import { Icon } from "@/components/ui/Icon";
import { answerInputClassName } from "./TextAnswer";

interface YearAnswerProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Age derived from a valid year: the "✓ 21 tuổi" pill (62:1237). */
  age: number | null;
  errorId?: string;
}

/** 12.2 "Năm sinh": 4-digit year, bold 22px, age pill beside it (desktop) or below (mobile). */
export function YearAnswer({ id, label, value, onValueChange, age, errorId }: YearAnswerProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label font-semibold text-ink">
        {label}
      </label>
      <div className="flex flex-col items-start gap-5 lg:flex-row lg:items-center lg:gap-4">
        <input
          id={id}
          value={value}
          onChange={(event) => onValueChange(event.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete="bday-year"
          maxLength={4}
          placeholder="2005"
          aria-invalid={errorId ? true : undefined}
          aria-describedby={errorId}
          className={answerInputClassName(
            Boolean(errorId),
            "text-title-sm font-bold tracking-[0.9px]",
            "placeholder:font-normal lg:w-55",
          )}
        />
        <span aria-live="polite" className="sr-only">
          {age !== null ? `${age} tuổi` : ""}
        </span>
        {age !== null ? (
          <p
            aria-hidden="true"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-tone-green-bg px-3 text-label font-bold text-primary-strong"
          >
            <Icon name="check" size={14} />
            {age} tuổi
          </p>
        ) : null}
      </div>
    </div>
  );
}
