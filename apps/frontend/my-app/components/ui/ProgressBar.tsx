interface ProgressBarProps {
  value: number;
  max?: number;
  /** Track height in px (Figma uses 6, 8 and 10). */
  height?: 6 | 8 | 10;
  /** Accessible name; omit when the value is already stated in nearby text. */
  label?: string;
  tone?: "primary" | "brand" | "amber";
  className?: string;
}

const FILL: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  primary: "bg-primary",
  brand: "bg-brand",
  amber: "bg-rating",
};

export function ProgressBar({ value, max = 100, height = 8, label, tone = "primary", className = "" }: ProgressBarProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`w-full overflow-hidden rounded-full bg-line ${className}`}
      style={{ height }}
    >
      <div className={`h-full rounded-full ${FILL[tone]}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
