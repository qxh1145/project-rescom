"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { isApiError } from "@/lib/api/api-error";
import { EXTERNAL_MESSAGES } from "@/lib/participation/external-messages";
import { cancelAttempt } from "@/lib/participation/external-service";

interface CancelAttemptDialogProps {
  attemptId: string;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
}

const TITLE_ID = "cancel-attempt-title";

/** "Huỷ lượt làm" confirmation (ASSUMED, not drawn) → ASSUMED `POST /attempts/:id/cancel`. */
export function CancelAttemptDialog({ attemptId, open, onClose, onCancelled }: CancelAttemptDialogProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setFailure(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await cancelAttempt(attemptId);
      onCancelled();
    } catch (error) {
      setFailure(isApiError(error) && error.kind === "network" ? EXTERNAL_MESSAGES.network : EXTERNAL_MESSAGES.cancelFailed);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} labelledBy={TITLE_ID} width={480}>
      <div className="flex flex-col gap-4 px-6 pb-6 pt-7">
        <div>
          <h2 id={TITLE_ID} className="text-[20px] font-extrabold text-ink">
            Huỷ lượt làm này?
          </h2>
          <p className="mt-2 text-body-relaxed text-ink-muted">
            Chỗ của bạn trong khảo sát sẽ được trả lại cho người khác. Nếu đã làm xong Google Form, hãy nhập mã
            hoàn thành thay vì huỷ để nhận điểm.
          </p>
        </div>
        {failure ? <Alert tone="danger">{failure}</Alert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="base" radius="field" onClick={close} disabled={busy}>
            Tiếp tục làm
          </Button>
          <Button variant="danger" size="base" radius="field" loading={busy} loadingLabel="Đang huỷ…" onClick={confirm}>
            Huỷ lượt làm
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
