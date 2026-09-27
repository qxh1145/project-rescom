import { Icon } from "@/components/ui/Icon";
import { STATUS_PILLS, type PublisherStatusView, type StatusPillTone } from "@/lib/forms/manage-status";

/** Figma pill colors (neutral text #3A4460, rejected #912018 on #FEF3F2). */
const TONE_CLASSES: Record<StatusPillTone, string> = {
  neutral: "bg-surface-subtle text-ink-strong",
  teal: "bg-tone-teal-bg text-tone-teal-fg",
  green: "bg-tone-green-bg text-tone-green-fg",
  danger: "bg-danger-soft text-danger-strong",
  amber: "bg-tone-amber-bg text-tone-amber-fg",
};

/**
 * Survey status pill — Figma 10 rows (63:178: 26px, 12px label) and the
 * survey header (62:2585: 28px, 13px label). Both use a 14px icon.
 */
export function StatusPill({ view, size = "sm" }: { view: PublisherStatusView; size?: "sm" | "md" }) {
  const pill = STATUS_PILLS[view];
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full pr-2.5 pl-2.5 font-bold",
        size === "md" ? "h-7 text-[13px]" : "h-6.5 text-[12px]",
        TONE_CLASSES[pill.tone],
      ].join(" ")}
    >
      <Icon name={pill.icon} size={14} />
      {pill.label}
    </span>
  );
}
