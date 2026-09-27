import Link from "next/link";
import type { StatCardView } from "@/lib/admin/overview-view";

const VALUE_TONES: Record<StatCardView["valueTone"], string> = {
  ink: "text-ink",
  danger: "text-danger-strong",
  amber: "text-tone-amber-fg",
};

/** Figma 62:4126–62:4141: 114px link-cards, 18px radius, 32px value. */
export function StatCards({ cards }: { cards: StatCardView[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <li key={card.label}>
          <Link
            href={card.href}
            className="flex min-h-28.5 flex-col rounded-[18px] border border-line bg-surface px-4.5 pt-4 pb-4 transition-colors hover:border-line-strong"
          >
            <span className="text-caption font-semibold text-ink-muted">{card.label}</span>
            <span className={`mt-2 text-[32px] leading-8 font-extrabold ${VALUE_TONES[card.valueTone]}`}>
              {card.value}
            </span>
            <span
              className={`mt-1.5 text-caption ${card.captionTone === "link" ? "font-bold text-primary" : "text-ink-muted"}`}
            >
              {card.caption}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
