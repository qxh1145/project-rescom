"use client";

import Link from "next/link";
import { useState } from "react";
import type { MissingCodeReport } from "@rescom/schemas";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { Textarea } from "@/components/ui/Textarea";
import { EMPTY_TAB_COPY, missingCodeReportActions } from "@/lib/admin/disputes-view";
import { formatShortDateTime } from "@/lib/format/date-time";
import { useMissingCodeResolution } from "../hooks/use-missing-code-resolution";
import { ConfirmDecisionDialog } from "./ConfirmDecisionDialog";

/**
 * Story 14.1 (AC 8): Real "Báo thiếu mã" reports (`GET /admin/missing-code-reports`) with action resolution.
 * Each row allows an Admin to credit pending points, dismiss the report, or reset completion code limits.
 */
export function MissingCodeReportList({
  reports,
  total,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  onResolved = () => {},
  onStale = () => {},
}: {
  reports: readonly MissingCodeReport[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
  onResolved?: (outcome: string, points: number) => void;
  onStale?: (message: string) => void;
}) {
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
          <MissingCodeReportRow
            key={report.attemptId}
            report={report}
            onResolved={onResolved}
            onStale={onStale}
          />
        ))}
      </ul>
      {total > reports.length || hasMore ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-caption text-ink-muted">
            Đang hiển thị {reports.length} báo cáo trong tổng số {total}.
          </p>
          {hasMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="text-caption font-bold text-primary hover:underline disabled:opacity-60"
            >
              {loadingMore ? "Đang tải…" : "Xem thêm"}
            </button>
          ) : null}
          {loadMoreError ? <span className="text-caption text-danger-strong">Không tải được, thử lại.</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function MissingCodeReportRow({
  report,
  onResolved,
  onStale,
}: {
  report: MissingCodeReport;
  onResolved: (outcome: string, points: number) => void;
  onStale: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const decision = useMissingCodeResolution(report, {
    onResolved: (outcome, points) => {
      setExpanded(false);
      onResolved(outcome, points);
    },
    onStale,
  });

  const actions = missingCodeReportActions(report);

  return (
    <li className="rounded-[22px] border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[16px] font-extrabold text-ink">
            {report.survey?.title || "Khảo sát không xác định"}
          </h2>
          <Tag tone={report.attemptStatus === "COMPLETED" ? "green" : report.attemptStatus === "LOCKED" ? "danger" : "neutral"}>
            {report.attemptStatus}
          </Tag>
          <Tag tone="teal">+{report.rewardPerResponse} điểm</Tag>
          {!report.surveyOpen ? <Tag tone="amber">Khảo sát đã đóng</Tag> : null}
          {report.failedCodeVerifications > 0 ? (
            <Tag tone="danger">{report.failedCodeVerifications} lần sai mã</Tag>
          ) : null}
        </div>
        <Button
          variant={expanded ? "ghost" : "outline"}
          size="sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Đóng" : "Xử lý"}
        </Button>
      </div>

      <p className="mt-1.5 text-[14px] text-ink-muted">
        {report.respondent ? (
          <Link
            href={`/admin/users?id=${encodeURIComponent(report.respondent.id)}`}
            className="font-bold text-primary hover:underline"
          >
            {report.respondent.displayName ?? "Người dùng chưa đặt tên"}
          </Link>
        ) : (
          "Người dùng không xác định (khách)"
        )}{" "}
        · báo lúc{" "}
        <time dateTime={report.reportedAt}>
          {formatShortDateTime(report.reportedAt)}
        </time>
      </p>

      {report.reason ? (
        <p className="mt-2 rounded-field bg-surface-muted px-3.5 py-3 text-body leading-6 text-ink">
          {report.reason}
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-4 border-t border-line pt-4">
          <label
            htmlFor={`note-${report.attemptId}`}
            className="block text-label font-semibold text-ink"
          >
            Lý do xử lý <span className="text-danger">* bắt buộc</span>{" "}
            <span className="text-[12px] font-normal text-ink-muted">
              (10–500 ký tự, gửi cho người trả lời)
            </span>
          </label>
          <Textarea
            id={`note-${report.attemptId}`}
            value={decision.note}
            onChange={(e) => decision.setNote(e.target.value)}
            placeholder="Nhập lý do gửi cho người trả lời để giải thích quyết định…"
            rows={3}
            disabled={decision.busy}
            className="mt-1.5"
          />
          {decision.noteError ? (
            <p className="mt-1 text-caption text-danger">
              {decision.noteError}
            </p>
          ) : null}

          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            {actions.map((action) => (
              <div key={action.outcome} className="flex items-center gap-2">
                <Button
                  variant={action.primary ? "primary" : "secondary"}
                  size="sm"
                  disabled={!!action.disabledReason || decision.busy}
                  onClick={() => decision.request(action)}
                >
                  {action.label}
                </Button>
                {action.disabledReason ? (
                  <span className="text-[12px] text-ink-muted">
                    {action.disabledReason}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <ConfirmDecisionDialog
            action={decision.pending}
            note={decision.note}
            busy={decision.busy}
            error={decision.error}
            onCancel={decision.cancel}
            onConfirm={decision.confirm}
          />
        </div>
      ) : null}
    </li>
  );
}
