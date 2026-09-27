import type { ReactNode } from "react";
import type { PillTone } from "@/lib/admin/users-view";

const TONES: Record<PillTone, string> = {
  teal: "bg-tone-teal-bg text-tone-teal-fg",
  neutral: "bg-surface-subtle text-ink-strong",
  danger: "bg-danger-soft text-danger-strong",
};

/** Figma 11d table pills: 24px high, 12px bold ("Hoạt động", "Đã khoá", "5 · lặp lại"). */
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2 text-[12px] font-bold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
