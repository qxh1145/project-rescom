"use client";

import { Mascot } from "@/components/brand/Mascot";
import { DemoDataTag } from "@/components/ui/DemoDataTag";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { QUALITY_EMPTY_BODY, QUALITY_EMPTY_TITLE, qualityLoadErrorMessage } from "@/lib/admin/quality-messages";
import { qualityQueueMeta } from "@/lib/admin/quality-view";
import { useQualityReviews } from "../hooks/use-quality-reviews";
import { ReviewDetail } from "./ReviewDetail";
import { ReviewList } from "./ReviewList";

/**
 * Figma 17b (63:3276): 320px queue of held answers + 755px detail with the
 * decision form. ASSUMED below lg: the queue stacks above the detail.
 */
export function QualityScreen() {
  const { items, selected, hrefFor, error, loading, reload, decide, notice, clearNotice } = useQualityReviews();

  return (
    <AdminPage title="Xem xét chất lượng" meta={items ? qualityQueueMeta(items) : undefined} actions={<DemoDataTag />}>
      {notice ? (
        <Alert tone={notice.tone} onDismiss={clearNotice} className="mb-4">
          {notice.text}
        </Alert>
      ) : null}
      {error && !items ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Alert tone="danger" className="flex-1">
            {qualityLoadErrorMessage(error)}
          </Alert>
          <Button variant="secondary" size="base" radius="field" onClick={reload}>
            Thử lại
          </Button>
        </div>
      ) : !items ? (
        <p className="flex items-center gap-3 py-16 text-body text-ink-muted" role="status" aria-busy={loading}>
          <Spinner className="size-5 text-primary" />
          Đang tải câu trả lời cần xem…
        </p>
      ) : items.length === 0 || !selected ? (
        // ASSUMED empty state (not drawn).
        <section className="flex flex-col items-center gap-3 rounded-[22px] border border-line bg-surface px-6 py-12 text-center">
          <Mascot name="cheer" height={120} />
          <h2 className="text-[17px] font-extrabold text-ink">{QUALITY_EMPTY_TITLE}</h2>
          <p className="max-w-110 text-body-sm text-ink-muted">{QUALITY_EMPTY_BODY}</p>
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          <ReviewList items={items} selectedId={selected.responseId} hrefFor={hrefFor} />
          <ReviewDetail key={selected.responseId} review={selected} onDecide={decide} />
        </div>
      )}
    </AdminPage>
  );
}
