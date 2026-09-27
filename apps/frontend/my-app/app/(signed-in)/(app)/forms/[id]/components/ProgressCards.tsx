import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import { formatShortDateTime } from "@/lib/format/date-time";
import { FEEDBACK_ISSUE_LABELS } from "@/lib/forms/manage-messages";
import type { FormProgress } from "@/lib/forms/manage-service";
import { hoursUntil } from "@/lib/forms/manage-view";

export const CARD = "rounded-[18px] border border-line bg-surface p-4 lg:rounded-[22px] lg:p-6";
export const CARD_TITLE = "text-[16px] font-extrabold text-ink lg:text-[17px]";

/** Figma 10a "Lượt đang chờ 48 giờ" (62:2670 / 62:3330): Google Forms completions still disputable. */
export function PendingAttemptsCard({
  formId,
  attempts,
  now,
}: {
  formId: string;
  attempts: FormProgress["pendingAttempts"];
  now: number;
}) {
  const open = attempts.filter((attempt) => attempt.dispute === null);
  return (
    <section aria-labelledby="pending-attempts-title" data-tour="pending-attempts" className={CARD}>
      <h2 id="pending-attempts-title" className={CARD_TITLE}>
        Lượt đang chờ 48 giờ · {open.length}
      </h2>
      <p className="mt-1.5 text-caption leading-[18.9px] text-ink-muted lg:mt-2.5 lg:leading-[19.5px]">
        Nghi một lượt làm không hợp lệ? Khiếu nại trước khi hết giờ. Sau 48 giờ, điểm tự chuyển cho người trả lời.
      </p>
      {attempts.length === 0 ? (
        <p className="mt-3 border-t border-line-subtle pt-3 text-body-sm text-ink-muted">Không có lượt nào đang chờ.</p>
      ) : (
        <ul className="mt-3">
          {attempts.map((attempt) => (
            <li key={attempt.attemptId} className="flex min-h-15.25 items-center gap-3 border-t border-line-subtle py-2.5">
              <div className="mr-auto min-w-0">
                <p className="text-body-sm font-bold text-ink">Người trả lời {attempt.respondentCode}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  Nhập mã {formatShortDateTime(attempt.codeVerifiedAt)}
                  {attempt.dispute ? " · đã khiếu nại" : ` · còn ${hoursUntil(attempt.reviewEndsAt, now)} giờ`}
                </p>
              </div>
              {attempt.dispute ? (
                <Tag tone="amber">Chờ Admin xét</Tag>
              ) : (
                <Link
                  href={`/forms/${encodeURIComponent(formId)}/complaints/${encodeURIComponent(attempt.attemptId)}`}
                  scroll={false}
                  className="inline-flex h-10 shrink-0 items-center rounded-[10px] border border-line-strong bg-surface px-3 text-caption font-bold text-ink hover:bg-surface-subtle"
                >
                  Khiếu nại
                  <span className="sr-only"> lượt của người trả lời {attempt.respondentCode}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueRow({ label, percent }: { label: string; percent: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-caption text-ink">
        <span>{label}</span>
        <span className="font-bold">{percent}%</span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-subtle">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

/** Figma 10a "Đánh giá từ người trả lời" (62:2683 / 62:3378). */
export function FeedbackCard({ feedback }: { feedback: FormProgress["feedback"] }) {
  const percentOf = (tag: keyof typeof FEEDBACK_ISSUE_LABELS) =>
    feedback.issues.find((issue) => issue.tag === tag)?.percent ?? 0;
  const merged = percentOf("MISLEADING_DESCRIPTION") + percentOf("TECHNICAL_ISSUE");
  return (
    <section aria-labelledby="feedback-title" className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="feedback-title" className={CARD_TITLE}>
          Đánh giá từ người trả lời
        </h2>
        <span className="text-caption text-ink-muted">{feedback.count} đánh giá</span>
      </div>
      {feedback.count === 0 || feedback.averageRating === null ? (
        <p className="mt-3 text-body-sm text-ink-muted">Chưa có đánh giá nào.</p>
      ) : (
        <>
          <p className="mt-3 flex items-center gap-2">
            {/* Two-tone star: an image, not the single-color mask icon. */}
            <Image src="/icons/star-filled.svg" alt="" width={24} height={24} />
            <span className="text-[24px] font-extrabold text-ink">
              {feedback.averageRating.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}
            </span>
            <span className="text-body-sm text-ink-muted">/ 5 trung bình</span>
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <IssueRow label={FEEDBACK_ISSUE_LABELS.LONGER_THAN_ESTIMATED} percent={percentOf("LONGER_THAN_ESTIMATED")} />
            <IssueRow label={FEEDBACK_ISSUE_LABELS.UNCLEAR_QUESTIONS} percent={percentOf("UNCLEAR_QUESTIONS")} />
            {/* Desktop merges the last two rows (62:2698); mobile lists them apart (62:3393, 62:3396). */}
            <div className="hidden lg:block">
              <IssueRow
                label={`${FEEDBACK_ISSUE_LABELS.MISLEADING_DESCRIPTION} · ${FEEDBACK_ISSUE_LABELS.TECHNICAL_ISSUE}`}
                percent={merged}
              />
            </div>
            <div className="flex flex-col gap-3 lg:hidden">
              <IssueRow label={FEEDBACK_ISSUE_LABELS.MISLEADING_DESCRIPTION} percent={percentOf("MISLEADING_DESCRIPTION")} />
              <IssueRow label={FEEDBACK_ISSUE_LABELS.TECHNICAL_ISSUE} percent={percentOf("TECHNICAL_ISSUE")} />
            </div>
          </div>
        </>
      )}
      <p className="mt-3 text-[12px] leading-4.5 text-ink-muted">
        <span className="lg:hidden">Tỷ lệ là phần người trả lời chọn mỗi vấn đề. </span>
        Nhận xét chữ hiện khi đủ số đánh giá tối thiểu để giữ ẩn danh.
      </p>
    </section>
  );
}

/** Figma 10a footer note (62:2702 / 62:3400). */
export function AnswersNote() {
  return (
    <div className="flex gap-2.5 rounded-[14px] bg-surface-subtle px-3.5 py-3 lg:px-4">
      <Icon name="info" size={18} className="mt-px text-ink-muted" />
      <p className="text-caption leading-[19.5px] text-ink">
        RESCOM không lưu nội dung câu trả lời của Google Forms, bạn xem chúng trong Google Forms hoặc Google Sheets.
        Khảo sát tạo bằng Form Builder thì xem, lọc và xuất .xlsx/.csv ngay trong tab Câu trả lời.
      </p>
    </div>
  );
}
