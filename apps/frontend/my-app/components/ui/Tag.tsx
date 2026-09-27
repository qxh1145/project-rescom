import type { ReactNode } from "react";

export type TagTone = "green" | "teal" | "amber" | "neutral" | "danger" | "blue" | "solid";

const TONE_CLASSES: Record<TagTone, string> = {
  green: "bg-tone-green-bg text-tone-green-fg",
  teal: "bg-tone-teal-bg text-tone-teal-fg",
  amber: "bg-tone-amber-bg text-tone-amber-fg",
  neutral: "bg-surface-subtle text-ink-muted",
  danger: "bg-danger-soft text-danger",
  blue: "bg-tone-blue-bg text-tone-blue-fg", // Figma 3 "Google Forms" tag (62:673)
  solid: "bg-primary text-primary-foreground",
};

interface TagProps {
  tone?: TagTone;
  /** sm 22–26px (status, source), md 28–30px (reward, status pill). */
  size?: "sm" | "md";
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Non-interactive status/label pill (e.g. "Trong Rescom", "Khả dụng", "+12 điểm"). */
export function Tag({ tone = "neutral", size = "sm", icon, className = "", children }: TagProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-bold",
        size === "sm" ? "h-6.5 px-2.5 text-[12px]" : "h-7.5 px-3 text-[13px]",
        TONE_CLASSES[tone],
        className,
      ].join(" ")}
    >
      {icon}
      {children}
    </span>
  );
}
