"use client";

import { escrowDrawPerCompletion } from "@rescom/schemas";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Textarea } from "@/components/ui/Textarea";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import {
  DISPUTE_DESCRIPTION_MAX,
  DISPUTE_REASON_LABELS,
  formActionErrorMessage,
  validateDisputeDraft,
  type DisputeDraftErrors,
} from "@/lib/forms/manage-messages";
import {
  DISPUTE_REASONS,
  submitAttemptDispute,
  type DisputeReason,
  type FormProgress,
  type PendingAttempt,
  type PublisherForm,
} from "@/lib/forms/manage-service";
import { hoursUntil } from "@/lib/forms/manage-view";
import { SheetDialog } from "../../../components/SheetDialog";

function ComplaintForm({
  form,
  attempt,
  onCancel,
  onSent,
  onBusyChange,
}: {
  form: PublisherForm;
  attempt: PendingAttempt;
  onCancel: () => void;
  onSent: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<DisputeDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const found = validateDisputeDraft({ reason, description });
    setErrors(found);
    if (found.reason || found.description || !reason) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await submitAttemptDispute(form.id, attempt.attemptId, { reason, description: description.trim() });
      onSent();
    } catch (cause) {
      setError(formActionErrorMessage(cause, "Chưa gửi được khiếu nại. Vui lòng thử lại."));
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <form
      noValidate
      className="mt-4 flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p id="complaint-reason-label" className="text-label font-semibold text-ink">
        Vấn đề
      </p>
      <div
        role="group"
        aria-labelledby="complaint-reason-label"
        aria-describedby={errors.reason ? "complaint-reason-error" : undefined}
        className="mt-2.5 flex flex-wrap gap-2"
      >
        {DISPUTE_REASONS.map((value) => (
          <ToggleChip
            key={value}
            selected={reason === value}
            onSelectedChange={() => {
              setReason(value);
              setErrors((current) => ({ ...current, reason: undefined }));
            }}
          >
            {DISPUTE_REASON_LABELS[value]}
          </ToggleChip>
        ))}
      </div>
      {errors.reason ? (
        <p id="complaint-reason-error" className="mt-1.5 text-caption text-danger">
          {errors.reason}
        </p>
      ) : null}

      <Textarea
        id="complaint-description"
        label="Mô tả"
        className="mt-4"
        rows={3}
        value={description}
        maxLength={DISPUTE_DESCRIPTION_MAX}
        placeholder="Ví dụ: chọn cùng một đáp án cho mọi câu, câu mở chỉ ghi “abc”."
        error={errors.description}
        onChange={(event) => {
          setDescription(event.target.value);
          if (errors.description) setErrors((current) => ({ ...current, description: undefined }));
        }}
      />

      {/* Phase 5 M5 (decision Q3, option a): the Figma 10c "Ảnh bằng chứng"
          uploader is left out until the dispute route accepts evidence (no
          backend contract or storage purpose exists), so nothing is picked
          that would never be sent. */}
      <div className="mt-4 flex gap-2.5 rounded-field bg-surface-subtle px-3 py-3">
        <Icon name="info" size={18} className="mt-px text-ink-muted" />
        <p className="text-caption leading-[19.5px] text-ink">
          Điểm của lượt này được giữ lại cho đến khi Admin quyết định. Nếu khiếu nại được chấp nhận,{" "}
          {escrowDrawPerCompletion(form)} điểm được hoàn vào số dư khả dụng của bạn.
        </p>
      </div>

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <div className="mt-4 flex gap-3 lg:justify-end">
        <Button variant="secondary" size="xl" onClick={onCancel} disabled={busy}>
          Huỷ
        </Button>
        <Button type="submit" size="lg" className="flex-1 lg:flex-none lg:px-10" loading={busy} loadingLabel="Đang gửi…">
          Gửi khiếu nại
        </Button>
      </div>
    </form>
  );
}

/**
 * Figma 10c "Khiếu nại lượt làm" (62:1720, mobile sheet). Desktop ASSUMED:
 * the same content in the centered 576px dialog used by 10b.
 */
export function ComplaintDialog({ progress }: { progress: FormProgress | undefined }) {
  const router = useRouter();
  const params = useParams<{ attemptId: string }>();
  const { form, invalidate } = useFormHeader();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  if (!form || !progress) return null;

  const attemptId = decodeURIComponent(params.attemptId);
  const attempt = progress.pendingAttempts.find((item) => item.attemptId === attemptId);
  const close = () => {
    if (busy) return;
    if (sent) invalidate();
    router.replace(`/forms/${encodeURIComponent(form.id)}`, { scroll: false });
  };
  const subtitle = attempt
    ? `Người trả lời ${attempt.respondentCode} · còn ${hoursUntil(attempt.reviewEndsAt, now)} giờ để khiếu nại`
    : form.title;

  return (
    <SheetDialog
      titleId="complaint-title"
      title="Khiếu nại lượt làm"
      subtitle={subtitle}
      onClose={close}
      dismissible={!busy}
    >
      {sent ? (
        <>
          <Alert tone="info" className="mt-4">
            Đã gửi khiếu nại. Điểm của lượt này được giữ lại, Admin sẽ xem xét và báo kết quả cho bạn.
          </Alert>
          <Button size="lg" fullWidth className="mt-5" onClick={close}>
            Xong
          </Button>
        </>
      ) : attempt && !attempt.dispute && hoursUntil(attempt.reviewEndsAt, now) > 0 ? (
        <ComplaintForm form={form} attempt={attempt} onCancel={close} onSent={() => setSent(true)} onBusyChange={setBusy} />
      ) : (
        <>
          <Alert tone="info" className="mt-4">
            {attempt?.dispute
              ? "Lượt làm này đã được khiếu nại, Admin đang xem xét."
              : "Lượt làm này không còn khiếu nại được: đã hết 48 giờ hoặc không thuộc khảo sát này."}
          </Alert>
          <Button variant="secondary" size="xl" fullWidth className="mt-5" onClick={close}>
            Đóng
          </Button>
        </>
      )}
    </SheetDialog>
  );
}
