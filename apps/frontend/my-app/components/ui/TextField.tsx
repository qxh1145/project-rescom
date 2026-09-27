import type { ComponentPropsWithRef, ReactNode } from "react";

/**
 * Shared control look for inputs, selects and textareas — page 8 "Ô nhập":
 * hover border #3A4460, focus 2px primary, error 2px danger, disabled dashed.
 */
export function fieldClassName(hasError: boolean, extra = ""): string {
  return [
    "w-full rounded-field border bg-surface px-3.5 text-body text-ink transition-colors",
    "placeholder:text-ink-placeholder",
    "disabled:cursor-not-allowed disabled:border-dashed disabled:border-line-strong disabled:bg-disabled disabled:text-disabled-foreground",
    // The unlayered global :focus-visible outline is hidden via its color var; the 2px border replaces it.
    "[--focus-ring-color:transparent]",
    hasError
      ? "border-2 border-danger px-[13px]"
      : "border-line-strong enabled:hover:border-ink-strong focus:border-2 focus:border-primary focus:px-[13px]",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

interface TextFieldProps extends Omit<ComponentPropsWithRef<"input">, "id"> {
  id: string;
  label: string;
  hint?: string;
  /** Usually a string; rich content (e.g. inline links) is allowed. */
  error?: ReactNode;
}

/** Label + input + hint/error, wired for screen readers. Figma: 50px field, 12px radius. */
export function TextField({ id, label, hint, error, className = "", ...inputProps }: TextFieldProps) {
  // The error replaces the hint rather than stacking a second message under the field.
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-label font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={fieldClassName(Boolean(error), "h-12.5")}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : null}
      {hintId ? (
        <p id={hintId} className="text-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
