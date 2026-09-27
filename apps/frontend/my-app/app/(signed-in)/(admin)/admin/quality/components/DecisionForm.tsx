"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { Textarea } from "@/components/ui/Textarea";
import { qualityDecisionErrorMessage } from "@/lib/admin/quality-messages";
import {
  QUALITY_NOTE_MAX_LENGTH,
  type QualityDecision,
  type QualityDecisionCommand,
  type QualityReview,
} from "@/lib/admin/quality-service";
import { decisionOptionsFor, validateDecision, type DecisionFormErrors } from "@/lib/admin/quality-view";

interface DecisionFormProps {
  review: QualityReview;
  onDecide: (review: QualityReview, command: QualityDecisionCommand) => Promise<unknown>;
}

/**
 * Figma 63:3385–63:3404 "Quyết định": 3 radio cards, note, "Lưu quyết định".
 * A rejection needs a reason and a confirmation (it reverses the held points).
 * Nothing is pre-selected (Figma draws a filled-in example).
 */
export function DecisionForm({ review, onDecide }: DecisionFormProps) {
  const [decision, setDecision] = useState<QualityDecision | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<DecisionFormErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const radioName = `quality-decision-${review.responseId}`;

  async function save(chosen: QualityDecision) {
    setBusy(true);
    setFailure(null);
    const error = await onDecide(review, { decision: chosen, note: note.trim() });
    // On success this form unmounts (the next answer opens).
    if (error) {
      setBusy(false);
      setConfirming(false);
      setFailure(error);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateDecision(decision, note);
    setErrors(found);
    if (!decision || found.decision || found.note) return;
    if (decision === "REJECT") setConfirming(true);
    else void save(decision);
  }

  return (
    <form onSubmit={submit} noValidate className="mt-5">
      <fieldset aria-describedby={errors.decision ? "quality-decision-error" : undefined}>
        <legend className="text-body font-extrabold text-ink">Quyết định</legend>
        <div className="mt-3 grid gap-2.5 md:grid-cols-3">
          {decisionOptionsFor(review.heldPoints).map((option) => (
            <Radio
              key={option.value}
              id={`${radioName}-${option.value}`}
              name={radioName}
              value={option.value}
              variant="card"
              checked={decision === option.value}
              disabled={busy}
              onChange={() => {
                setDecision(option.value);
                setErrors((current) => ({ ...current, decision: undefined }));
              }}
              label={<span className="font-bold">{option.label}</span>}
              description={<span className="text-caption">{option.description}</span>}
            />
          ))}
        </div>
        {errors.decision ? (
          <p id="quality-decision-error" className="mt-1.5 text-caption text-danger">
            {errors.decision}
          </p>
        ) : null}
      </fieldset>

      <Textarea
        id={`${radioName}-note`}
        label="Ghi chú cho quyết định"
        className="mt-3"
        rows={2}
        maxLength={QUALITY_NOTE_MAX_LENGTH}
        value={note}
        disabled={busy}
        error={errors.note}
        placeholder={decision === "REJECT" ? "Lý do từ chối (bắt buộc)" : "Không bắt buộc"}
        onChange={(event) => {
          setNote(event.target.value);
          if (errors.note) setErrors((current) => ({ ...current, note: undefined }));
        }}
      />

      {failure ? (
        <Alert tone="danger" className="mt-3">
          {qualityDecisionErrorMessage(failure)}
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
        <p className="text-[12px] leading-4.5 text-ink-muted md:max-w-128.5">
          Quyết định trở thành nhãn hiệu chỉnh, không sửa đánh giá cũ. Người trả lời nhận thông báo dễ hiểu và có thể
          khiếu nại.
        </p>
        <Button
          type="submit"
          size="lg"
          className="md:ml-auto"
          loading={busy && !confirming}
          loadingLabel="Đang lưu…"
          disabled={busy}
        >
          Lưu quyết định
        </Button>
      </div>

      <Dialog open={confirming} onClose={() => !busy && setConfirming(false)} labelledBy="quality-reject-title" width={480}>
        <div className="p-6">
          <h2 id="quality-reject-title" className="text-title-sm font-extrabold text-ink">
            Từ chối câu trả lời #{review.reference}?
          </h2>
          <p className="mt-2 text-body-sm text-ink-muted">
            {review.heldPoints} điểm đang giữ sẽ bị đảo khỏi ví người trả lời và trả về ký quỹ của khảo sát. Người trả
            lời nhận thông báo kèm lý do và có thể khiếu nại.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="md" disabled={busy} onClick={() => setConfirming(false)}>
              Huỷ
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={busy}
              loadingLabel="Đang từ chối…"
              onClick={() => void save("REJECT")}
            >
              Từ chối và đảo điểm
            </Button>
          </div>
        </div>
      </Dialog>
    </form>
  );
}
