import type { ComponentPropsWithRef, ReactNode } from "react";

interface RadioProps extends Omit<ComponentPropsWithRef<"input">, "type" | "size"> {
  label: ReactNode;
  description?: ReactNode;
  /** "plain" = filter list; "card" = bordered option row (survey answers, admin decisions). */
  variant?: "plain" | "card";
  size?: 18 | 20;
}

/** Native radio tinted with the primary color (Figma "Radio" / "Radio – checked"). */
export function Radio({ label, description, variant = "plain", size = 18, className = "", id, ...props }: RadioProps) {
  const card =
    "rounded-[14px] border border-line bg-surface px-5 py-4 has-checked:border-2 has-checked:border-primary has-checked:bg-tone-green-bg has-checked:px-[19px] has-checked:py-[15px] hover:border-line-strong";
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 ${variant === "card" ? card : ""} ${className}`}
    >
      <input
        id={id}
        type="radio"
        className="mt-0.5 shrink-0 cursor-pointer accent-primary"
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
