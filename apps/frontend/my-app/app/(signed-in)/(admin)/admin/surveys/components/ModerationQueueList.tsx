"use client";

import Link from "next/link";
import type { ModerationQueueEntry } from "@/lib/admin/moderation-service";
import { queueCardMeta } from "@/lib/admin/moderation-view";

interface ModerationQueueListProps {
  items: ModerationQueueEntry[];
  selectedId: string | null;
  total: number;
  hasMore: boolean;
}

/** Figma 11a queue cards (62:3462 selected, 62:3465 / 62:3468). */
export function ModerationQueueList({ items, selectedId, total, hasMore }: ModerationQueueListProps) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Khảo sát chờ duyệt">
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => {
          const selected = item.formId === selectedId;
          return (
            <li key={item.formId}>
              <Link
                href={`/admin/surveys?id=${encodeURIComponent(item.formId)}`}
                scroll={false}
                replace
                aria-current={selected ? "page" : undefined}
                className={[
                  "flex flex-col gap-1.5 rounded-2xl bg-surface transition-colors",
                  selected
                    ? "border-2 border-primary px-3.75 py-3.25"
                    : "border border-line px-4 py-3.5 hover:border-line-strong",
                ].join(" ")}
              >
                <span className="text-body font-bold text-ink">{item.title}</span>
                <span className="text-caption text-ink-muted">{queueCardMeta(item)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        // ASSUMED: one page (50) is shown; deciding surveys brings the next ones in.
        <p className="mt-3 text-caption text-ink-muted">
          Đang hiện {items.length}/{total} khảo sát cũ nhất.
        </p>
      ) : null}
    </nav>
  );
}
