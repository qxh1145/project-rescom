"use client";

import type { ReactNode } from "react";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { useApiQuery } from "@/lib/api/use-api-query";
import { formatShortDateTime } from "@/lib/participation/completion-view";
import {
  getReliabilitySummary,
  type ReliabilityResult,
  type ReliabilitySummary,
} from "@/lib/participation/trust-service";

const LEVEL: Record<ReliabilitySummary["level"], { pill: string; title: string }> = {
  FORMING: { pill: "Đang hình thành", title: "Rescom đang tìm hiểu cách bạn trả lời" },
  GOOD: { pill: "Tốt", title: "Câu trả lời của bạn được đánh giá tốt" },
  REVIEW: { pill: "Cần chú ý", title: "Một số câu trả lời cần xem thêm" },
};

const CONFIDENCE: Record<ReliabilitySummary["confidence"], string> = { LOW: "thấp", MEDIUM: "trung bình", HIGH: "cao" };

/** Figma "Đạt" teal, "Không đánh giá" neutral; REVIEW / PENDING amber (ASSUMED). */
const RESULT: Record<ReliabilityResult, { label: string; className: string }> = {
  PASSED: { label: "Đạt", className: "bg-tone-teal-bg text-tone-teal-fg" },
  REVIEW: { label: "Cần xem thêm", className: "bg-tone-amber-bg text-tone-amber-fg" },
  PENDING: { label: "Đang xét", className: "bg-tone-amber-bg text-tone-amber-fg" },
  NOT_ASSESSED: { label: "Không đánh giá", className: "bg-surface-subtle text-ink-strong" },
};

const TIPS = ["Đọc kỹ từng câu, không vội", "Trả lời đúng câu kiểm tra chú ý nếu có", "Trả lời nhất quán với hồ sơ của bạn"];

function dateOnly(iso: string): string {
  return formatShortDateTime(iso).split(" ")[0] ?? "";
}

function summaryText(summary: ReliabilitySummary): ReactNode {
  if (summary.level !== "FORMING") {
    return `Dựa trên ${summary.internalResponseCount} câu trả lời trong khảo sát tạo trong Rescom.`;
  }
  const count = summary.internalResponseCount;
  return (
    <>
      {count === 0
        ? "Bạn chưa có câu trả lời nào trong khảo sát tạo trong Rescom."
        : `Bạn mới có ${count} câu trả lời trong khảo sát tạo trong Rescom.`}{" "}
      Cần thêm câu trả lời trước khi có mức độ tin cậy.{" "}
      <strong className="font-bold">Người mới không bị xem là đáng ngờ.</strong>
    </>
  );
}

/**
 * Figma 17d "Độ tin cậy câu trả lời" (63:5117, mobile). Desktop is derived
 * (ASSUMED): the same cards in a 720px column under the app header.
 */
export function TrustScreen() {
  const query = useApiQuery("reliability-summary", (signal) => getReliabilitySummary(signal));
  const summary = query.data;

  return (
    <>
      <MobileBackBar title="Độ tin cậy câu trả lời" backHref="/account" />
      <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 pt-[18px] pb-8 lg:px-0 lg:pt-10">
        <h1 className="mb-6 hidden text-title font-extrabold text-ink lg:block">Độ tin cậy câu trả lời</h1>

        {query.error && !summary ? (
          <Alert tone="danger">
            Không tải được độ tin cậy.{" "}
            <Button variant="ghost" size="sm" className="-my-2 inline-flex" onClick={query.reload}>
              Thử lại
            </Button>
          </Alert>
        ) : !summary ? (
          <p className="flex items-center gap-3 py-10 text-body text-ink-muted" role="status">
            <Spinner className="size-5 text-primary" />
            Đang tải…
          </p>
        ) : (
          <>
            <section className="flex flex-col items-start rounded-[20px] border border-line bg-surface px-5 pt-5 pb-[22px]">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-tone-blue-bg px-3 text-caption font-bold text-tone-blue-fg">
                <Icon name="refresh" size={14} />
                {LEVEL[summary.level].pill}
              </span>
              <h2 className="mt-3 text-[20px] font-extrabold leading-[26px] text-ink">{LEVEL[summary.level].title}</h2>
              <p className="mt-2 text-body-sm leading-[21.7px] text-ink-strong">{summaryText(summary)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex h-7 items-center rounded-full bg-surface-subtle px-2.5 text-caption font-semibold text-ink-strong">
                  Độ chắc chắn: {CONFIDENCE[summary.confidence]}
                </span>
                <span className="inline-flex h-7 items-center rounded-full bg-surface-subtle px-2.5 text-caption font-semibold text-ink-strong">
                  Cập nhật {dateOnly(summary.updatedAt)}
                </span>
              </div>
            </section>

            <h2 className="mt-4 px-1 text-caption font-bold tracking-[0.5px] text-ink-muted">ĐÁNH GIÁ GẦN ĐÂY</h2>
            {summary.recent.length === 0 ? (
              <p className="mt-2 rounded-2xl border border-line bg-surface px-4 py-4 text-body-sm text-ink-muted">
                Chưa có câu trả lời nào được đánh giá.
              </p>
            ) : (
              <ul className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
                {summary.recent.map((row) => (
                  <li key={row.attemptId} className="flex items-center gap-3 border-b border-line-subtle px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-label font-bold text-ink">{row.surveyTitle}</p>
                      <p className="text-[12px] text-ink-muted">
                        {row.source === "INTERNAL" ? "Trong Rescom" : "Google Forms"} · {dateOnly(row.submittedAt)}
                        {row.source === "EXTERNAL" ? " · chỉ kiểm tra bằng mã hoàn thành" : ""}
                      </p>
                    </div>
                    <span
                      className={`inline-flex h-6.5 shrink-0 items-center rounded-full px-2.5 text-[12px] font-bold ${RESULT[row.result].className}`}
                    >
                      {RESULT[row.result].label}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <section className="mt-4 flex flex-col rounded-[20px] border border-line bg-surface px-[18px] pt-4 pb-5">
              <h2 className="text-body font-extrabold text-ink">Điều gì giúp câu trả lời được đánh giá tốt</h2>
              <ul className="mt-2 flex flex-col pl-[18px] text-body-sm leading-[23.8px] text-ink-strong">
                {TIPS.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
              <p className="mt-2.5 text-[12px] leading-[18px] text-ink-muted">
                Hạng thành viên và độ tin cậy là hai thứ riêng. Làm nhiều khảo sát giúp lên hạng, nhưng không tự làm tăng độ
                tin cậy.
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
