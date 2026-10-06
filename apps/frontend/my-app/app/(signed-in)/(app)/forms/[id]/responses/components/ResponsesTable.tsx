"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import type { FormResponse, ResultQuestion } from "@/lib/forms/results-service";
import {
  answerCompact,
  columnHeader,
  formatDurationShort,
  formatSubmittedAt,
  responseLabel,
  type Page,
} from "@/lib/forms/results-view";

const HEAD = "px-2 pb-2.5 text-left text-[12px] font-semibold whitespace-nowrap text-ink-muted";
const CELL = "h-13 border-t border-line-subtle px-2 text-body-sm text-ink";

function PageButton({
  label,
  onClick,
  disabled,
  current,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  current?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex size-10 items-center justify-center rounded-[10px] border text-body-sm text-ink transition-colors",
        disabled
          ? "cursor-not-allowed border-line bg-disabled text-ink-muted"
          : current
            ? "border-ink bg-surface font-bold"
            : "border-line-strong bg-surface font-semibold hover:bg-surface-subtle",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** Page numbers around the current one (at most 5). */
function pageWindow(page: number, pageCount: number): number[] {
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  return Array.from({ length: Math.min(5, pageCount) }, (_, index) => start + index);
}

/** Desktop table of 10d (63:3752): code, time, duration, chosen questions. */
export function ResponsesTable({
  page,
  columns,
  selectedId,
  hrefFor,
  onPage,
}: {
  page: Page<FormResponse>;
  columns: ResultQuestion[];
  selectedId: string | null;
  hrefFor: (response: FormResponse) => string;
  onPage: (page: number) => void;
}) {
  const router = useRouter();
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <caption className="sr-only">Danh sách câu trả lời, mới nhất trước</caption>
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} w-19 pl-2`}>
                Mã
              </th>
              <th scope="col" className={`${HEAD} w-27`}>
                Nộp lúc
              </th>
              <th scope="col" className={`${HEAD} w-24`}>
                Thời gian
              </th>
              {columns.map((question) => (
                <th key={question.id} scope="col" className={`${HEAD} max-w-48 truncate`} title={question.title}>
                  {columnHeader(question)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.items.map((response) => {
              const selected = response.id === selectedId;
              const href = hrefFor(response);
              return (
                <tr
                  key={response.id}
                  onClick={() => router.push(href, { scroll: false })}
                  className={`cursor-pointer ${selected ? "bg-tone-green-bg" : "hover:bg-surface-muted"}`}
                >
                  <td className={`${CELL} ${selected ? "shadow-[inset_3px_0_0_var(--color-primary)]" : ""}`}>
                    <Link
                      href={href}
                      scroll={false}
                      onClick={(event) => event.stopPropagation()}
                      aria-current={selected ? "true" : undefined}
                      className={`font-bold hover:underline ${selected ? "text-tone-green-fg" : "text-ink"}`}
                    >
                      {responseLabel(response)}
                    </Link>
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>{formatSubmittedAt(response.submittedAt)}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{formatDurationShort(response.durationSeconds)}</td>
                  {columns.map((question) => (
                    <td key={question.id} className={`${CELL} max-w-48 truncate`}>
                      {answerCompact(question, response.answers[question.id])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-3">
        <p className="text-caption text-ink-muted">
          {page.total ? `Hiện ${page.from} đến ${page.to} trong ${page.total} câu trả lời` : "Không có câu trả lời phù hợp"}
        </p>
        {page.pageCount > 1 ? (
          <nav aria-label="Phân trang" className="flex items-center gap-1.5">
            <PageButton label="Trang trước" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>
              <Icon name="chevron-left" size={18} />
            </PageButton>
            {pageWindow(page.page, page.pageCount).map((number) => (
              <PageButton
                key={number}
                label={`Trang ${number}`}
                current={number === page.page}
                onClick={() => onPage(number)}
              >
                {number}
              </PageButton>
            ))}
            <PageButton label="Trang sau" disabled={page.page >= page.pageCount} onClick={() => onPage(page.page + 1)}>
              <Icon name="chevron-right" size={18} />
            </PageButton>
          </nav>
        ) : null}
      </div>
    </>
  );
}
