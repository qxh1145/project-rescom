"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Textarea } from "@/components/ui/Textarea";
import {
  MODERATION_REJECT_FAILED,
  REJECTION_DRAFT_MESSAGES,
  moderationErrorMessage,
  rejectionImpactWarning,
} from "@/lib/admin/moderation-messages";
import type { ModerationPreview } from "@/lib/admin/moderation-service";
import {
  REJECTION_REASONS,
  composeRejectionReason,
  publisherLabel,
  refundPreview,
  rejectionNoteMaxLength,
  type RejectionDraftError,
} from "@/lib/admin/moderation-view";

interface RejectSurveyDialogProps {
  open: boolean;
  survey: ModerationPreview;
  onClose: () => void;
  /** Rejects; throws the API error so the dialog can show it. */
  onReject: (reason: string) => Promise<void>;
}

/**
 * Figma 11a' "Từ chối khảo sát (lý do + hoàn điểm)" (62:2868). The backend
 * takes one `reason` string: "<lý do chính>. <ghi chú>".
 * ASSUMED: no reason is preselected (Figma shows the first one chosen).
 */
export function RejectSurveyDialog({ open, survey, onClose, onReject }: RejectSurveyDialogProps) {
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [draftError, setDraftError] = useState<RejectionDraftError | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refund = refundPreview(survey);
  const warning = rejectionImpactWarning(survey);

  function close() {
    if (busy) return;
    setError(null);
    setDraftError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft = composeRejectionReason(reasonId, note);
    if (!draft.ok) {
      setDraftError(draft.error);
      return;
    }
    setDraftError(null);
    setError(null);
    setBusy(true);
    try {
      await onReject(draft.reason);
      setReasonId(null);
      setNote("");
    } catch (cause) {
      setError(moderationErrorMessage(cause, MODERATION_REJECT_FAILED));
    } finally {
      setBusy(false);
    }
  }

  const reasonError = draftError === "reasonRequired" ? REJECTION_DRAFT_MESSAGES.reasonRequired : undefined;
  const noteError = draftError && draftError !== "reasonRequired" ? REJECTION_DRAFT_MESSAGES[draftError] : undefined;

  return (
    <Dialog open={open} onClose={close} labelledBy="reject-survey-title" width={616} dismissible={!busy}>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col p-5 lg:p-7">
        <div className="flex items-start gap-3">
          <div className="mr-auto min-w-0">
            <h2 id="reject-survey-title" className="text-title-sm font-extrabold text-ink">
              Từ chối khảo sát
            </h2>
            <p className="mt-1 text-body-sm text-ink-muted">
              {survey.title} · {publisherLabel(survey)}
            </p>
          </div>
          <IconButton icon="x" label="Đóng" onClick={close} disabled={busy} />
        </div>

        <fieldset
          className="mt-3 flex flex-col gap-2"
          aria-describedby={reasonError ? "reject-reason-error" : undefined}
        >
          <legend className="mb-2.5 text-label font-semibold text-ink">Lý do chính</legend>
          {REJECTION_REASONS.map((reason) => {
            const checked = reason.id === reasonId;
            return (
              <label
                key={reason.id}
                className={[
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-field border px-3.5 py-2.5 text-body text-ink transition-colors",
                  checked ? "border-primary bg-tone-green-bg font-semibold" : "border-line-strong hover:bg-surface-muted",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="reject-reason"
                  value={reason.id}
                  checked={checked}
                  onChange={() => {
                    setReasonId(reason.id);
                    if (draftError === "reasonRequired") setDraftError(null);
                  }}
                  className="size-5 shrink-0 cursor-pointer accent-primary"
                />
                {reason.label}
              </label>
            );
          })}
          {reasonError ? (
            <p id="reject-reason-error" className="text-caption text-danger">
              {reasonError}
            </p>
          ) : null}
        </fieldset>

        <Textarea
          id="reject-note"
          label="Ghi chú gửi người đăng"
          className="mt-4"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={rejectionNoteMaxLength(reasonId)}
          placeholder="Ví dụ: Form đang giới hạn tài khoản @fpt.edu.vn. Hãy tắt “Chỉ người dùng trong tổ chức” rồi gửi lại."
          error={noteError}
        />

        {warning ? (
          <Alert tone="danger" className="mt-4">
            {warning}
          </Alert>
        ) : null}

        <div className="mt-4 flex items-start gap-2.5 rounded-field bg-tone-amber-bg px-3.5 py-3 text-body-sm text-ink">
          <Icon name="star-circle" size={18} className="mt-0.5 shrink-0 text-tone-amber-fg" />
          <p>
            {refund > 0 ? (
              <>
                Từ chối sẽ hoàn <strong className="font-bold">{refund} điểm</strong> ký quỹ về số dư của người đăng và gửi
                thông báo kèm lý do.
              </>
            ) : (
              "Khảo sát không giữ ký quỹ nào. Từ chối sẽ gửi thông báo kèm lý do cho người đăng."
            )}
          </p>
        </div>

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}

        <div className="mt-4.5 flex gap-3 sm:justify-end">
          <Button variant="secondary" size="xl" onClick={close} disabled={busy}>
            Huỷ
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="lg"
            className="flex-1 sm:flex-none"
            loading={busy}
            loadingLabel="Đang từ chối…"
          >
            {refund > 0 ? `Từ chối & hoàn ${refund} điểm` : "Từ chối khảo sát"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
