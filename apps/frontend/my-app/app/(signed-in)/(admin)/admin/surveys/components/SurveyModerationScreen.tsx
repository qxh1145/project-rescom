"use client";

import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { MODERATION_LOAD_QUEUE_FAILED, moderationErrorMessage } from "@/lib/admin/moderation-messages";
import { useSurveyModeration } from "../hooks/use-survey-moderation";
import { ModerationDetail } from "./ModerationDetail";
import { ModerationQueueList } from "./ModerationQueueList";

/**
 * Figma 11a (62:3406): 360px queue on the left, 715px detail card on the
 * right (20px apart). ASSUMED below lg: the two stack.
 */
export function SurveyModerationScreen() {
  const moderation = useSurveyModeration();
  const { queue } = moderation;
  const loaded = queue.items !== undefined;

  return (
    <AdminPage
      title="Duyệt khảo sát"
      meta={loaded ? `${queue.total} khảo sát chờ · cũ nhất trước` : undefined}
    >
      {moderation.notice ? (
        <Alert tone="info" onDismiss={moderation.clearNotice} className="mb-5 max-w-268.75">
          {moderation.notice}
        </Alert>
      ) : null}

      {queue.error && !loaded ? (
        <Alert tone="danger" className="max-w-180">
          <span>{moderationErrorMessage(queue.error, MODERATION_LOAD_QUEUE_FAILED)}</span>{" "}
          <button type="button" onClick={queue.reload} className="font-bold underline">
            Thử lại
          </button>
        </Alert>
      ) : !loaded ? (
        <div className="flex items-center gap-3 py-10 text-body-sm text-ink-muted" role="status">
          <Spinner />
          Đang tải hàng chờ…
        </div>
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="w-full shrink-0 lg:w-90">
            <ModerationQueueList
              items={queue.items ?? []}
              selectedId={moderation.selectedId}
              total={queue.total}
              hasMore={queue.hasMore}
            />
          </div>
          <div className="min-w-0 flex-1 lg:max-w-178.75">
            {moderation.selectedId ? (
              <ModerationDetail moderation={moderation} />
            ) : (
              <EmptyQueue onReload={queue.reload} reloading={queue.loading} />
            )}
          </div>
        </div>
      )}
    </AdminPage>
  );
}

/** ASSUMED empty state (not drawn in Figma). */
function EmptyQueue({ onReload, reloading }: { onReload: () => void; reloading: boolean }) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-[22px] border border-line bg-surface p-7">
      <h2 className="text-[20px] font-extrabold text-ink">Không còn khảo sát nào chờ duyệt</h2>
      <p className="text-body-sm text-ink-muted">Khảo sát mới gửi duyệt sẽ xuất hiện ở đây, cũ nhất trước.</p>
      <Button variant="secondary" size="sm" radius="field" onClick={onReload} loading={reloading} loadingLabel="Đang tải…">
        Tải lại
      </Button>
    </section>
  );
}
