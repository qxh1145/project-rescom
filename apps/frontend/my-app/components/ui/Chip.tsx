import type { ReactNode } from "react";

export type ChipTone = "green" | "teal" | "amber";

const TONE_CLASSES: Record<ChipTone, string> = {
  green: "bg-tone-green-bg text-tone-green-fg",
  teal: "bg-tone-teal-bg text-tone-teal-fg",
  amber: "bg-tone-amber-bg text-tone-amber-fg",
};

interface ChipProps {
  tone: ChipTone;
  children: ReactNode;
}

/** Static pill label (36px high). Not interactive. */
export function Chip({ tone, children }: ChipProps) {
  return (
    <span
      className={`inline-flex h-9 items-center whitespace-nowrap rounded-full px-3.5 text-label font-bold ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
