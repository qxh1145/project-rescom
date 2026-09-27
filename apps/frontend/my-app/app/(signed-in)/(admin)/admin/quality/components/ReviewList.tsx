import Link from "next/link";
import type { QualityReview } from "@/lib/admin/quality-service";
import { formatShortDateTime } from "@/lib/format/date-time";

interface ReviewListProps {
  items: QualityReview[];
  selectedId: string;
  hrefFor: (responseId: string) => string;
}

/** Figma 63:3332–63:3343: 71px link cards; the open one has a 2px primary border. */
export function ReviewList({ items, selectedId, hrefFor }: ReviewListProps) {
  return (
    <nav aria-label="Câu trả lời cần xem">
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => {
          const current = item.responseId === selectedId;
          return (
            <li key={item.responseId}>
              <Link
                href={hrefFor(item.responseId)}
                scroll={false}
                aria-current={current ? "true" : undefined}
                className={[
                  "flex min-h-17.75 flex-col justify-center gap-1 rounded-2xl bg-surface",
                  current ? "border-2 border-primary px-3.75 py-2.75" : "border border-line px-4 py-3 hover:border-line-strong",
                ].join(" ")}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-body font-extrabold text-ink">#{item.reference}</span>
                  <span className="ml-auto shrink-0 text-caption font-bold text-ink-muted">
                    Điểm {item.qualityScore}/100
                  </span>
                </span>
                <span className="flex min-w-0 text-caption text-ink-muted">
                  <span className="truncate">{item.surveyTitle}</span>
                  <span className="shrink-0">&nbsp;· {formatShortDateTime(item.submittedAt)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
