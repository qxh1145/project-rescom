import type { ComponentPropsWithRef, ReactNode } from "react";

interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type" | "size"> {
  label: ReactNode;
  description?: ReactNode;
  /** Box size: 18px (filters) or 20px (forms). */
  size?: 18 | 20;
}

/** Native checkbox tinted with the primary color (Figma "Checkbox – checked"). */
export function Checkbox({ label, description, size = 18, className = "", id, ...props }: CheckboxProps) {
  return (
    <label htmlFor={id} className={`flex cursor-pointer items-start gap-3 ${className}`}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 shrink-0 cursor-pointer rounded-[4px] accent-primary"
        style={{ width: size, height: size }}
        {...props}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-body text-ink">{label}</span>
        {description ? <span className="text-body-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}
