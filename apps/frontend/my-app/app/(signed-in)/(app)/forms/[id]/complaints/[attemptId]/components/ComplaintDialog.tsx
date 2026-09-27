"use client";

import { escrowDrawPerCompletion } from "@rescom/schemas";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

/** Figma 10c "Ảnh bằng chứng · tối đa 3". */
const MAX_EVIDENCE = 3;

interface Evidence {
  id: number;
  file: File;
  url: string;
}

/**
 * Screenshots picked for the complaint, previewed locally. ASSUMED: they are
 * not uploaded yet — the Publisher dispute route (and its storage purpose)
 * does not exist in the backend, so only the reason and description are sent.
 */
function useEvidence() {
  const [items, setItems] = useState<Evidence[]>([]);
  const nextId = useRef(0);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    const created = urls;
    return () => created.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function add(files: FileList | null) {
    const room = MAX_EVIDENCE - items.length;
    const picked = Array.from(files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, room));
    const added = picked.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      nextId.current += 1;
      return { id: nextId.current, file, url };
    });
    setItems([...items, ...added]);
  }

  function remove(id: number) {
    const target = items.find((item) => item.id === id);
    if (!target) return;
    URL.revokeObjectURL(target.url);
    urls.current = urls.current.filter((url) => url !== target.url);
    setItems(items.filter((item) => item.id !== id));
  }

  return { items, add, remove };
}

function ComplaintForm({
  form,
  attempt,
  onCancel,
  onSent,
}: {
  form: PublisherForm;
  attempt: PendingAttempt;
  onCancel: () => void;
  onSent: () => void;
}) {
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<DisputeDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evidence = useEvidence();
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit() {
    const found = validateDisputeDraft({ reason, description });
    setErrors(found);
    if (found.reason || found.description || !reason) return;
    setBusy(true);
    setError(null);
    try {
      await submitAttemptDispute(form.id, attempt.attemptId, { reason, description: description.trim() });
      onSent();
    } catch (cause) {
      setError(formActionErrorMessage(cause, "Chưa gửi được khiếu nại. Vui lòng thử lại."));
      setBusy(false);
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

      <p className="mt-4 text-label font-semibold text-ink">
        Ảnh bằng chứng <span className="font-medium text-ink-muted">· tối đa {MAX_EVIDENCE}</span>
      </p>
      <ul className="mt-2.5 flex flex-wrap gap-2.5">
        {evidence.items.map((item, index) => (
          <li key={item.id} className="relative size-22.5 overflow-hidden rounded-field border border-line-strong">
            <Image src={item.url} alt={`Ảnh bằng chứng ${index + 1}`} fill unoptimized sizes="90px" className="object-cover" />
            <button
              type="button"
              onClick={() => evidence.remove(item.id)}
              aria-label={`Bỏ ảnh ${index + 1}`}
              className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full bg-surface/90 text-ink"
            >
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
        {evidence.items.length < MAX_EVIDENCE ? (
          <li>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Thêm ảnh bằng chứng"
              className="inline-flex size-22 items-center justify-center rounded-field border border-line-strong bg-surface text-ink hover:bg-surface-subtle"
            >
              <Icon name="plus" size={24} />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                evidence.add(event.target.files);
                event.target.value = "";
              }}
            />
          </li>
        ) : null}
      </ul>
      <p className="mt-2 text-[12px] text-ink-muted">
        Chụp đúng dòng câu trả lời trong Google Sheets, che thông tin cá nhân nếu có.
      </p>

      <div className="mt-4 flex gap-2.5 rounded-field bg-surface-subtle px-3 py-3">
        <Icon name="info" size={18} className="mt-px text-ink-muted" />
        <p className="text-caption leading-[19.5px] text-ink">
          Điểm của lượt này được giữ lại cho đến khi Admin quyết định. Nếu khiếu nại được chấp nhận,{" "}
          {escrowDrawPerCompletion(form)} điểm trở về ký quỹ của bạn.
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
  const [now] = useState(() => Date.now());
  if (!form || !progress) return null;

  const attemptId = decodeURIComponent(params.attemptId);
  const attempt = progress.pendingAttempts.find((item) => item.attemptId === attemptId);
  const close = () => {
    if (sent) invalidate();
    router.replace(`/forms/${encodeURIComponent(form.id)}`, { scroll: false });
  };
  const subtitle = attempt
    ? `Người trả lời ${attempt.respondentCode} · còn ${hoursUntil(attempt.reviewEndsAt, now)} giờ để khiếu nại`
    : form.title;

  return (
    <SheetDialog titleId="complaint-title" title="Khiếu nại lượt làm" subtitle={subtitle} onClose={close}>
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
        <ComplaintForm form={form} attempt={attempt} onCancel={close} onSent={() => setSent(true)} />
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
