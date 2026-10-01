"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cancelFailureOf } from "@/lib/participation/external-code";
import { cancelAttempt, newCancelIdempotencyKey } from "@/lib/participation/external-service";
import { useSession } from "@/lib/session/SessionProvider";

interface CancelAttemptDialogProps {
  attemptId: string;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
  /** The attempt turned out to be already completed (verified in another tab). */
  onCompleted: () => void;
}

const TITLE_ID = "cancel-attempt-title";

/** "Huỷ lượt làm" confirmation (ASSUMED, not drawn) → `POST /attempts/:id/cancel`. */
export function CancelAttemptDialog({ attemptId, open, onClose, onCancelled, onCompleted }: CancelAttemptDialogProps) {
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** One Idempotency-Key per opening of the dialog, reused by "retry" clicks. */
  const idempotencyKey = useRef<string | null>(null);

  const close = () => {
    if (busy) return;
    setFailure(null);
    idempotencyKey.current = null;
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      // Inside the try: a key that cannot be generated must not leave the dialog busy.
      idempotencyKey.current ??= newCancelIdempotencyKey();
      await cancelAttempt(attemptId, idempotencyKey.current);
      onCancelled();
    } catch (error) {
      const failed = cancelFailureOf(error);
      switch (failed.kind) {
        // 409 ATTEMPT_NOT_IN_PROGRESS: it already closed in another tab. A
        // completed attempt shows its completion screen; otherwise (expired,
        // cancelled, locked) leave it like after a cancel.
        case "completed":
          onCompleted();
          return;
        case "closed":
          onCancelled();
          return;
        case "session":
          // 401 / locked account: `SessionGate` redirects once the session is re-read.
          setBusy(false);
          refresh();
          return;
        case "message":
          setFailure(failed.message);
          setBusy(false);
      }
    }
  };

  return (
    <Dialog open={open} onClose={close} labelledBy={TITLE_ID} width={480} dismissible={!busy}>
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
