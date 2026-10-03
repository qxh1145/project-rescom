"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { useApiQuery } from "@/lib/api/use-api-query";
import { formActionErrorMessage } from "@/lib/forms/manage-messages";
import {
  closePublisherForm,
  getInProgressAttempts,
  type PublisherForm,
} from "@/lib/forms/manage-service";

interface CloseFormDialogProps {
  open: boolean;
  /** The list item is enough: the dialog only needs these facts. */
  form: Pick<PublisherForm, "id" | "title" | "type" | "status" | "escrowLocked">;
  onClose: () => void;
  onClosed: (form: PublisherForm) => void;
}

/**
 * "Đóng & hoàn điểm" confirmation — ASSUMED (design) design (not drawn), same panel as
 * 10b. Warns about respondents still taking the survey (VERIFIED
 * `GET /forms/:id/in-progress-attempts`, decision E5-D4). A survey that is not
 * live (waiting for review, or a re-versioned draft) gets the "Rút lại & hoàn
 * điểm" wording (Phase 5 M7) — same `POST /forms/:id/close`. Without a known
 * `escrowLocked` (Phase 5 M1) no amount is promised.
 */
export function CloseFormDialog({ open, form, onClose, onClosed }: CloseFormDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withdraw = form.status !== "PUBLISHED";
  const inProgress = useApiQuery(open && !withdraw ? `in-progress:${form.id}` : null, (signal) =>
    getInProgressAttempts(form.id, signal),
  );
  const takers = inProgress.data?.inProgressAttempts ?? 0;
  const amount = form.escrowLocked === null ? "" : ` ${form.escrowLocked} điểm`;
  const pending = form.status === "MODERATION_QUEUE" || form.status === "ESCROW_LOCKED";

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onClosed(await closePublisherForm(form.id));
    } catch (cause) {
      setError(
        formActionErrorMessage(
          cause,
          withdraw ? "Chưa rút lại được khảo sát. Vui lòng thử lại." : "Chưa đóng được khảo sát. Vui lòng thử lại.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        setError(null);
        onClose();
      }}
      labelledBy="close-form-title"
      width={520}
      dismissible={!busy}
    >
      <div className="p-5 lg:p-7">
        <div className="flex items-start gap-3">
          <div className="mr-auto">
            <h2 id="close-form-title" className="text-[20px] font-extrabold text-ink lg:text-title-sm">
              {withdraw ? "Rút lại khảo sát và hoàn điểm?" : "Đóng khảo sát và hoàn điểm?"}
            </h2>
            <p className="mt-1 text-caption text-ink-muted lg:text-body-sm">{form.title}</p>
          </div>
          <IconButton icon="x" label="Đóng" onClick={onClose} disabled={busy} />
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-body-sm text-ink-strong">
          <li>
            {withdraw
              ? pending
                ? "Khảo sát được rút khỏi hàng chờ duyệt và kết thúc, không lên Khám phá."
                : "Bản nháp phiên bản mới và khảo sát kết thúc, không nhận thêm người trả lời."
              : "Khảo sát ẩn khỏi Khám phá, không nhận thêm người trả lời."}
          </li>
          <li>
            {form.escrowLocked === null ? (
              "Ký quỹ chưa dùng được hoàn về số dư khả dụng."
            ) : (
              <>
                <strong className="text-ink">{form.escrowLocked} điểm</strong> ký quỹ chưa dùng được hoàn về số dư khả
                dụng.
              </>
            )}
          </li>
          {takers > 0 ? (
            <li className="text-danger-strong">{takers} người đang làm dở sẽ không nộp được bài.</li>
          ) : null}
          {form.type === "EXTERNAL" ? <li>Các lượt đang chờ 48 giờ vẫn được xét như bình thường.</li> : null}
        </ul>
        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        <div className="mt-6 flex gap-3 lg:justify-end">
          <Button variant="secondary" size="xl" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button
            size="lg"
            className="flex-1 lg:flex-none"
            onClick={() => void confirm()}
            loading={busy}
            loadingLabel={withdraw ? "Đang rút lại…" : "Đang đóng…"}
          >
            {withdraw ? "Rút lại" : "Đóng"} &amp; hoàn{amount || " điểm"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
