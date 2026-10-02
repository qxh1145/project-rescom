import Link from "next/link";
import type { MissingCodeReport } from "@rescom/schemas";
import { Tag } from "@/components/ui/Tag";
import { EMPTY_TAB_COPY } from "@/lib/admin/disputes-view";
import { formatShortDateTime } from "@/lib/format/date-time";

/**
 * Real "Báo thiếu mã" reports (`GET /admin/missing-code-reports`), read only:
 * the Admin can look at the user but no decision is offered here.
 */
export function MissingCodeReportList({ reports, total }: { reports: readonly MissingCodeReport[]; total: number }) {
  if (reports.length === 0) {
    return (
      <p className="rounded-[22px] border border-line bg-surface px-6 py-12 text-center text-body font-semibold text-ink">
        {EMPTY_TAB_COPY.MISSING_CODE}
      </p>
    );
  }
  return (
    <section aria-label="Báo cáo thiếu mã" className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {reports.map((report) => (
          <li key={report.attemptId} className="rounded-[22px] border border-line bg-surface px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-extrabold text-ink">{report.survey?.title || "Khảo sát không xác định"}</h2>
              <Tag tone="neutral">{report.attemptStatus}</Tag>
            </div>
            <p className="mt-1.5 text-[14px] text-ink-muted">
              {report.respondent ? (
                <Link href={`/admin/users?id=${encodeURIComponent(report.respondent.id)}`} className="font-bold text-primary hover:underline">
                  {report.respondent.displayName ?? "Người dùng chưa đặt tên"}
                </Link>
              ) : (
                "Người dùng không xác định"
              )}{" "}
              · báo lúc <time dateTime={report.reportedAt}>{formatShortDateTime(report.reportedAt)}</time>
            </p>
            {report.reason ? (
              <p className="mt-2 rounded-field bg-surface-muted px-3.5 py-3 text-body leading-6 text-ink">{report.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {total > reports.length ? (
        <p className="text-caption text-ink-muted">
          Đang hiển thị {reports.length} báo cáo mới nhất trong tổng số {total}.
        </p>
      ) : null}
    </section>
  );
}
