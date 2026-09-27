import type { ComponentPropsWithRef } from "react";

/**
 * 56px answer input of page 12 (63:2389): 14px radius, #7C869C border, 17px
 * text. Focus/error borders follow page 8 "Ô nhập" (see `fieldClassName`).
 */
export function answerInputClassName(invalid: boolean, textClass = "text-field-lg", extra = ""): string {
  return [
    "h-14 w-full rounded-control bg-surface text-ink transition-colors",
    textClass,
    "placeholder:text-ink-placeholder [--focus-ring-color:transparent]",
    invalid
      ? "border-2 border-danger px-[15px]"
      : "border border-line-strong px-4 hover:border-ink-strong focus:border-2 focus:border-primary focus:px-[15px]",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

interface TextAnswerProps extends Omit<ComponentPropsWithRef<"input">, "id" | "value" | "onChange"> {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** id of the step error, when there is one. */
  errorId?: string;
}

/** 12.1 "Tên hiển thị": labelled single-line text answer. */
export function TextAnswer({ id, label, value, onValueChange, errorId, className = "", ...props }: TextAnswerProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        className={answerInputClassName(Boolean(errorId), undefined, className)}
        {...props}
      />
    </div>
  );
}
