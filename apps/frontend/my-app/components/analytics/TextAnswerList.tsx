"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatCount } from "@/lib/forms/results-analytics";

/** One free-text answer, already formatted (dates as dd/mm/yyyy). */
export interface TextAnswer {
  key: string;
  value: string;
  submittedAt?: string | null;
}

/**
 * Free answers of a text / paragraph / date question. `pageSize` turns on
 * "Xem thêm" paging (the full list); `moreHref` adds "Xem tất cả N câu trả
 * lời" (the summary samples). Remount with a `key` to reset the paging.
 */
export function TextAnswerList({
  answers,
  total,
  moreHref,
  pageSize,
  emptyLabel = "Chưa có câu trả lời.",
}: {
  answers: readonly TextAnswer[];
  /** Every answer of the question (for "Xem tất cả N câu trả lời"); defaults to `answers.length`. */
  total?: number;
  moreHref?: string;
  pageSize?: number;
  emptyLabel?: string;
}) {
  const [visible, setVisible] = useState(pageSize ?? answers.length);
  if (!answers.length) return <p className="text-body-sm text-ink-muted">{emptyLabel}</p>;

  const shown = pageSize ? answers.slice(0, visible) : answers;
  const rest = answers.length - shown.length;
  const all = total ?? answers.length;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {shown.map((answer, index) => (
          <li key={answer.key} className={`flex flex-col gap-0.5 py-2.5 ${index ? "border-t border-line-subtle" : "pt-0"}`}>
            <p className="text-body-sm break-words whitespace-pre-line text-ink">{answer.value}</p>
            {answer.submittedAt ? (
              <p className="text-[12px] text-ink-muted">Nộp {formatShortDateTime(answer.submittedAt)}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {pageSize && rest > 0 ? (
        <Button variant="secondary" size="sm" radius="field" className="self-start" onClick={() => setVisible(visible + pageSize)}>
          Xem thêm {formatCount(Math.min(rest, pageSize))} câu trả lời
        </Button>
      ) : null}
      {moreHref && all > shown.length ? (
        <Link href={moreHref} className="self-start text-caption font-bold text-primary hover:underline">
          Xem tất cả {formatCount(all)} câu trả lời
        </Link>
      ) : null}
    </div>
  );
}
