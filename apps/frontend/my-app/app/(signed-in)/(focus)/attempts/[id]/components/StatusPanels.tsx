"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatClock } from "@/lib/participation/completion-view";

/**
 * Figma 4b "nộp bài thất bại" (62:1019): danger alert + local-save card. The
 * actions ("Xem lại" / "Thử gửi lại") live in the page's action bar.
 */
export function SubmitFailedPanel({
  answered,
  total,
  savedAt,
  expiresAt,
}: {
  answered: number;
  total: number;
  savedAt: string | null;
  expiresAt: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className="flex gap-3 rounded-2xl border border-danger bg-danger-soft px-4 pt-3.5 pb-4">
        <Icon name="wifi-off" size={20} className="mt-px text-danger" />
        <div className="flex flex-col gap-1">
          <p className="text-body font-bold text-danger-strong">Chưa gửi được bài</p>
          <p className="text-body-sm text-ink">
            Mất kết nối mạng. Câu trả lời của bạn vẫn được lưu trên máy — kiểm tra kết nối rồi bấm “Thử gửi lại”.
          </p>
        </div>
      </div>
      <section className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface px-[18px] pt-[17px] pb-5">
        <h2 className="text-lead font-bold text-ink">
          Bạn đã trả lời {answered}/{total} câu
        </h2>
        {savedAt ? (
          <p className="flex items-center gap-2 text-label font-semibold text-tone-teal-fg">
            <Icon name="check" size={18} />
            Đã lưu trên máy lúc {formatClock(savedAt)}
          </p>
        ) : null}
        <p className="text-caption leading-[19.5px] text-ink-muted">
          Lượt làm được giữ chỗ đến {formatClock(expiresAt)}. Gửi lại trước thời điểm này để nhận điểm.
        </p>
      </section>
    </div>
  );
}

/** Focus a state's heading when it replaces the page content (screen readers hear the change). */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/** ASSUMED (design) (not in Figma): the attempt's reservation ran out. */
export function ExpiredPanel({ restartHref, onRestart }: { restartHref: string; onRestart: () => void }) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section className="flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-[18px] lg:rounded-[20px] lg:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-field bg-tone-amber-bg text-tone-amber-fg">
          <Icon name="hourglass" size={22} />
        </span>
        <div className="flex flex-col gap-1">
          <h2 ref={headingRef} tabIndex={-1} className="text-body-lg font-extrabold text-ink focus:outline-none">
            Lượt làm đã hết hạn
          </h2>
          <p className="text-body-sm text-ink-muted">
            Lượt làm chỉ được giữ chỗ trong một khoảng thời gian nên câu trả lời chưa gửi không còn được nhận. Bạn có thể
            bắt đầu lại nếu khảo sát vẫn còn chỗ.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/marketplace" className={buttonClassName({ variant: "secondary", size: "lg" })}>
          Về Khám phá
        </Link>
        <Link href={restartHref} onClick={onRestart} className={buttonClassName({ size: "lg" })}>
          Bắt đầu lại
        </Link>
      </div>
    </section>
  );
}

/**
 * ASSUMED (design) (not in Figma): the survey left PUBLISHED after this attempt
 * started (`survey.status` of GET /attempts/:id is DRAFT, MODERATION_QUEUE or
 * ESCROW_LOCKED) — the Publisher is preparing a new version. Decision E5-D4:
 * the pinned attempt can no longer be submitted, so it is cancelled and
 * restarted; "Thử lại sau" reads the attempt again instead.
 */
export function FormUpdatedPanel({
  onRestart,
  onRetryLater,
  busy,
  error,
}: {
  onRestart: () => void;
  /** Re-reads the attempt (the survey may be PUBLISHED again by then). */
  onRetryLater: () => void;
  busy: boolean;
  error: string | null;
}) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="flex flex-1 items-start justify-center px-5 py-10 lg:items-center">
      <section className="flex w-full max-w-[480px] flex-col gap-4 rounded-card border border-line bg-surface p-6 lg:p-8">
        <span className="flex size-11 items-center justify-center rounded-field bg-tone-amber-bg text-tone-amber-fg">
          <Icon name="refresh" size={22} />
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-extrabold text-ink focus:outline-none">
          Khảo sát vừa được cập nhật — bắt đầu lại
        </h1>
        <p className="text-body-sm text-ink-muted">
          Người đăng đã sửa câu hỏi sau khi bạn bắt đầu, nên lượt làm này không nộp được nữa. Bắt đầu lại để làm theo
          phiên bản mới.
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Link href="/marketplace" className={buttonClassName({ variant: "secondary", size: "base", radius: "field" })}>
            Về Khám phá
          </Link>
          <Button variant="secondary" size="base" radius="field" onClick={onRetryLater} disabled={busy}>
            Thử lại sau
          </Button>
          <Button size="base" radius="field" onClick={onRestart} loading={busy} loadingLabel="Đang mở lại…">
            Bắt đầu lại
          </Button>
        </div>
      </section>
    </main>
  );
}

/**
 * ASSUMED (design) (not in Figma): the survey CLOSED after this attempt started. It
 * takes no answers and no new attempt, so there is nothing to restart.
 */
export function SurveyClosedPanel() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="flex flex-1 items-start justify-center px-5 py-10 lg:items-center">
      <section className="flex w-full max-w-[480px] flex-col gap-4 rounded-card border border-line bg-surface p-6 lg:p-8">
        <span className="flex size-11 items-center justify-center rounded-field bg-tone-amber-bg text-tone-amber-fg">
          <Icon name="lock" size={22} />
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-extrabold text-ink focus:outline-none">
          Khảo sát đã đóng
        </h1>
        <p className="text-body-sm text-ink-muted">
          Người đăng đã đóng khảo sát sau khi bạn bắt đầu, nên lượt làm này không nộp được nữa. Hãy chọn một khảo sát
          khác trong Khám phá.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/marketplace" className={buttonClassName({ size: "base", radius: "field" })}>
            Về Khám phá
          </Link>
        </div>
      </section>
    </main>
  );
}
