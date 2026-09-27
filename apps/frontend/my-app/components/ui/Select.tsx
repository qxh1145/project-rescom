import type { ComponentPropsWithRef } from "react";
import { Icon } from "./Icon";
import { fieldClassName } from "./TextField";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "id"> {
  id: string;
  label?: string;
  options: readonly SelectOption[];
  placeholder?: string;
  error?: string;
  /** 44 or 48px (Figma "Select" frames). */
  height?: 44 | 48;
}

/** Native select styled as Figma "Select" (62:487): 12px radius, 16px chevron. */
export function Select({
  id,
  label,
  options,
  placeholder,
  error,
  height = 48,
  className = "",
  ...props
}: SelectProps) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label ? (
        <label htmlFor={id} className="text-label font-semibold text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={fieldClassName(Boolean(error), `appearance-none pr-9 ${height === 48 ? "h-12" : "h-11"}`)}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevron-down"
          size={16}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
        />
      </div>
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
