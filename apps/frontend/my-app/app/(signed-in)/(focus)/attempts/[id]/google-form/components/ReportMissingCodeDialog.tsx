"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { Textarea } from "@/components/ui/Textarea";
import { REPORT_REASON_MAX, reportFailureMessage, reportReasonError } from "@/lib/participation/external-code";
import { reportMissingCode } from "@/lib/participation/external-service";

interface ReportMissingCodeDialogProps {
  attemptId: string;
  open: boolean;
  onClose: () => void;
}

const TITLE_ID = "report-missing-code-title";

/**
 * "Không thấy mã… Báo Admin" / "Báo Admin kiểm tra" (Figma 5, 5c). The dialog
 * itself is ASSUMED (design) (not drawn): reason textarea → VERIFIED
 * `POST /attempts/:id/report-missing-code` → success state.
 */
export function ReportMissingCodeDialog({ attemptId, open, onClose }: ReportMissingCodeDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      labelledBy={TITLE_ID}
      width={480}
      dismissible={!busy}
    >
      {/* `Dialog` mounts its children only while open: each report starts empty. */}
      <ReportForm attemptId={attemptId} onClose={onClose} onBusyChange={setBusy} />
    </Dialog>
  );
}

function ReportForm({
  attemptId,
  onClose,
  onBusyChange,
}: {
  attemptId: string;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = reportReasonError(reason);
    setFieldError(invalid);
    if (invalid) return;
    setBusy(true);
    onBusyChange(true);
    setFailure(null);
    try {
      await reportMissingCode(attemptId, reason);
      setSent(true);
    } catch (error) {
      setFailure(reportFailureMessage(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center px-6 pb-7 pt-7 text-center" role="status">
        <span className="flex size-16 items-center justify-center rounded-[20px] bg-tone-green-bg text-tone-green-fg">
          <Icon name="check" size={30} />
        </span>
        <h2 id={TITLE_ID} className="mt-3 text-title-sm font-extrabold text-ink">
          Đã gửi cho Admin
        </h2>
        <p className="mt-3 text-body-relaxed text-ink-muted">
          Admin sẽ kiểm tra lượt làm của bạn và bù điểm trong 24 giờ làm việc nếu bạn đã làm đủ form.
        </p>
        <Button size="lg" radius="field" fullWidth className="mt-5" onClick={onClose}>
          Đóng
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-6 pb-6 pt-7">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-tone-green-bg text-primary">
          <Icon name="flag" size={20} />
        </span>
        <div>
          <h2 id={TITLE_ID} className="text-[20px] font-extrabold text-ink">
            Báo Admin kiểm tra
          </h2>
          <p className="mt-1 text-body-sm text-ink-muted">
            Kể ngắn điều đã xảy ra, ví dụ form không hiện mã ở trang cuối hoặc mã không khớp.
          </p>
        </div>
      </div>
      <Textarea
        id="report-missing-code-reason"
        label="Mô tả"
        value={reason}
        maxLength={REPORT_REASON_MAX}
        rows={4}
        error={fieldError ?? undefined}
        onChange={(event) => {
          setReason(event.target.value);
          if (fieldError) setFieldError(null);
        }}
        placeholder="Mình đã làm hết form nhưng trang cảm ơn không có mã 6 số…"
      />
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" size="base" radius="field" onClick={onClose} disabled={busy}>
          Để sau
        </Button>
        <Button type="submit" size="base" radius="field" loading={busy} loadingLabel="Đang gửi…">
          Gửi báo cáo
        </Button>
      </div>
    </form>
  );
}
