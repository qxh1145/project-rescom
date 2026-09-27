import type { ComponentPropsWithRef } from "react";
import { fieldClassName } from "./TextField";

interface TextareaProps extends Omit<ComponentPropsWithRef<"textarea">, "id"> {
  id: string;
  label?: string;
  hint?: string;
  error?: string;
}

export function Textarea({ id, label, hint, error, className = "", maxLength, value, ...props }: TextareaProps) {
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const count = typeof value === "string" ? value.length : undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label ? (
        <label htmlFor={id} className="text-label font-semibold text-ink">
          {label}
        </label>
      ) : null}
      {hintId ? (
        <p id={hintId} className="-mt-1 text-body-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        className={fieldClassName(Boolean(error), "min-h-19 resize-y py-3")}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : maxLength && count !== undefined ? (
        <p className="self-end text-caption text-ink-muted" aria-live="polite">
          {count}/{maxLength}
        </p>
      ) : null}
    </div>
  );
}
