"use client";

import { escrowDrawPerCompletion } from "@rescom/schemas";
import { DemoDataTag } from "@/components/ui/DemoDataTag";
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
import { DISPUTE_REASONS, submitAttemptDispute, type DisputeReason } from "@/lib/forms/dispute-service";
import type { PublisherForm } from "@/lib/forms/manage-service";
import { SheetDialog } from "../../../components/SheetDialog";

function ComplaintForm({
  form,
  attemptId,
  onCancel,
  onSent,
  onBusyChange,
}: {
  form: PublisherForm;
  attemptId: string;
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
      await submitAttemptDispute(form.id, attemptId, { reason, description: description.trim() });
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
 * the same content in the centered 576px dialog used by 10b. The dispute
 * route stays on MSW (`PUBLISHER_DISPUTES_ENABLED`, Story 8.5 deferred): the
 * progress contract no longer lists the 48h attempts, so the attempt comes
 * from the URL and the server answers whether it is still disputable
 * (`ATTEMPT_NOT_DISPUTABLE`, `DISPUTE_WINDOW_CLOSED`, `DISPUTE_ALREADY_OPEN`).
 */
export function ComplaintDialog() {
  const router = useRouter();
  const params = useParams<{ attemptId: string }>();
  const { form, invalidate } = useFormHeader();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!form) return null;

  const attemptId = decodeURIComponent(params.attemptId);
  const close = () => {
    if (busy) return;
    if (sent) invalidate();
    router.replace(`/forms/${encodeURIComponent(form.id)}`, { scroll: false });
  };

  return (
    <SheetDialog titleId="complaint-title" title="Khiếu nại lượt làm" subtitle={
        <>
          {form.title} <DemoDataTag className="ml-1 align-middle" />
        </>
      }
      onClose={close} dismissible={!busy}>
      {sent ? (
        <>
          <Alert tone="info" className="mt-4">
            Đã gửi khiếu nại. Điểm của lượt này được giữ lại, Admin sẽ xem xét và báo kết quả cho bạn.
          </Alert>
          <Button size="lg" fullWidth className="mt-5" onClick={close}>
            Xong
          </Button>
        </>
      ) : form.type === "EXTERNAL" ? (
        <ComplaintForm form={form} attemptId={attemptId} onCancel={close} onSent={() => setSent(true)} onBusyChange={setBusy} />
      ) : (
        <>
          <Alert tone="info" className="mt-4">
            Chỉ lượt làm Google Forms mới khiếu nại được.
          </Alert>
          <Button variant="secondary" size="xl" fullWidth className="mt-5" onClick={close}>
            Đóng
          </Button>
        </>
      )}
    </SheetDialog>
  );
}
