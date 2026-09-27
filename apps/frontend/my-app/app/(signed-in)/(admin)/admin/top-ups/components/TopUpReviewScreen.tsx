"use client";

import { useState } from "react";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { topUpQueueLoadErrorMessage } from "@/lib/admin/top-up-admin-messages";
import type { AdminTopUp } from "@/lib/admin/top-up-admin-service";
import { useTopUpReview } from "../hooks/use-top-up-review";
import { RejectTopUpDialog } from "./RejectTopUpDialog";
import { TopUpQueueTable } from "./TopUpQueueTable";
import { TopUpReviewPanel } from "./TopUpReviewPanel";

/**
 * Figma 11b "Duyệt nạp điểm" (63:369): requests table (605px) + "Đối chiếu
 * yêu cầu" panel (470px). ASSUMED below lg: the panel stacks under the table.
 */
export function TopUpReviewScreen() {
  const review = useTopUpReview();
  // The dialog keeps the request it was opened for, even if the list reloads under it.
  const [rejecting, setRejecting] = useState<AdminTopUp | null>(null);
  const { selected, failure } = review;

  function closeReject() {
    // A reject in flight keeps the dialog (and its eventual error) on screen.
    if (review.busy === "reject") return;
    setRejecting(null);
    review.clearFailure();
  }

  return (
    <AdminPage title="Duyệt nạp điểm" meta="Đối chiếu với sao kê ngân hàng trước khi cộng điểm">
      <div className="flex flex-col gap-4">
        {review.notice ? <Alert tone="info">{review.notice}</Alert> : null}
        {review.error ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Alert tone="danger" className="flex-1">
              {topUpQueueLoadErrorMessage(review.error)}
            </Alert>
            <Button variant="secondary" size="base" radius="field" onClick={review.reload}>
              Thử lại
            </Button>
          </div>
        ) : null}
        <div
          className="grid gap-5 lg:grid-cols-[minmax(0,605fr)_minmax(0,470fr)] lg:items-start"
          aria-busy={review.loading || review.refreshing || undefined}
        >
          <TopUpQueueTable
            status={review.status}
            onStatusChange={review.setStatus}
            pendingCount={review.pendingCount}
            items={review.items}
            total={review.total}
            loading={review.loading}
            failed={Boolean(review.error)}
            selectedId={selected?.id ?? null}
            onSelect={review.select}
          />
          {selected ? (
            <TopUpReviewPanel
              item={selected}
              checked={review.checked}
              onCheck={review.toggleCheck}
              busy={review.busy}
              error={failure?.action === "approve" ? failure.message : null}
              onApprove={() => void review.review("approve", selected)}
              onReject={() => {
                review.clearFailure();
                setRejecting(selected);
              }}
            />
          ) : null}
        </div>
      </div>
      {rejecting ? (
        <RejectTopUpDialog
          item={rejecting}
          busy={review.busy === "reject"}
          error={failure?.action === "reject" ? failure.message : null}
          onClose={closeReject}
          onConfirm={async (reason) => {
            const done = await review.review("reject", rejecting, reason);
            if (done) setRejecting(null);
            return done;
          }}
        />
      ) : null}
    </AdminPage>
  );
}
