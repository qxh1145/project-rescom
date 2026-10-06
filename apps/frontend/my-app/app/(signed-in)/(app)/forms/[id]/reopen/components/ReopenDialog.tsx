"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import { formActionErrorMessage, reopenRefusalMessage } from "@/lib/forms/manage-messages";
import {
  clampAdditional,
  REOPEN_DEADLINE_CHOICES,
  REOPEN_DEFAULT_COMPLETIONS,
  REOPEN_DEFAULT_DEADLINE_DAYS,
  reopenCost,
  reopenDeadlineAt,
  reopenNeedsNewDeadline,
} from "@/lib/forms/manage-reopen";
import { reopenPublisherForm, type PublisherForm } from "@/lib/forms/manage-service";
import { reopenRefusalOf } from "@/lib/forms/manage-status";
import { useSession } from "@/lib/session/SessionProvider";
import { SheetDialog } from "../../components/SheetDialog";

const STEPPER =
  "inline-flex size-12 shrink-0 items-center justify-center rounded-field border border-line-strong bg-surface text-[22px] font-semibold text-ink hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";

function ReopenForm({
  form,
  onDone,
  onBusyChange,
}: {
  form: PublisherForm;
  onDone: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { applyForm } = useFormHeader();
  const { balance, refresh } = useSession();
  const [text, setText] = useState(String(REOPEN_DEFAULT_COMPLETIONS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Story IR.2b Q3: a passed deadline must be replaced (or removed) on reopen.
  const [needsDeadline] = useState(() => reopenNeedsNewDeadline(form.deadlineAt));
  const [deadlineDays, setDeadlineDays] = useState<number | null>(REOPEN_DEFAULT_DEADLINE_DAYS);

  const quantity = Number(text);
  const cost = reopenCost({
    type: form.type,
    rewardPerResponse: form.rewardPerResponse,
    expectedCompletions: form.expectedCompletions,
    additionalCompletions: quantity,
    available: balance?.available ?? null,
  });
  const step = (delta: number) => setText(String(clampAdditional((Number(text) || 0) + delta, cost.maxAdditional)));

  async function submit() {
    if (!cost.validQuantity || !cost.affordable) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const updated = await reopenPublisherForm(
        form.id,
        quantity,
        needsDeadline ? reopenDeadlineAt(deadlineDays) : undefined,
      );
      applyForm(updated);
      // Points moved Khả dụng → Ký quỹ: refresh the header chip.
      refresh();
      router.replace(`/forms/${encodeURIComponent(form.id)}`, { scroll: false });
    } catch (cause) {
      setError(formActionErrorMessage(cause, "Chưa mở lại được khảo sát. Vui lòng thử lại."));
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-3.5 lg:flex-row lg:gap-4">
        <div className="lg:w-63">
          <label htmlFor="reopen-quantity" className="text-label font-semibold text-ink">
            <span className="lg:hidden">Thêm bao nhiêu người trả lời?</span>
            <span className="hidden lg:inline">Thêm người trả lời</span>
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" className={STEPPER} aria-label="Giảm 1" onClick={() => step(-1)} disabled={quantity <= 1}>
              −
            </button>
            <input
              id="reopen-quantity"
              inputMode="numeric"
              pattern="[0-9]*"
              value={text}
              onChange={(event) => setText(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onBlur={() => setText(String(clampAdditional(Number(text) || 1, cost.maxAdditional)))}
              aria-invalid={!cost.validQuantity || undefined}
              aria-describedby="reopen-summary"
              className="h-12 min-w-0 flex-1 rounded-field border border-line-strong bg-surface text-center text-field-lg font-bold text-ink focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none"
            />
            <button
              type="button"
              className={STEPPER}
              aria-label="Tăng 1"
              onClick={() => step(1)}
              disabled={quantity >= cost.maxAdditional}
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 lg:block lg:flex-1">
          <p className="text-body-sm text-ink-muted lg:font-semibold lg:text-ink">Điểm mỗi lượt</p>
          <p className="text-body-sm font-bold text-ink lg:mt-2 lg:flex lg:h-12 lg:items-center lg:rounded-field lg:bg-disabled lg:px-3.5 lg:text-body lg:text-ink-strong">
            {form.rewardPerResponse} điểm · giữ như cũ
          </p>
        </div>
      </div>

      {needsDeadline ? (
        <div className="mt-3.5">
          <label htmlFor="reopen-deadline" className="text-label font-semibold text-ink">
            Hạn thu thập mới
          </label>
          <select
            id="reopen-deadline"
            value={deadlineDays === null ? "none" : String(deadlineDays)}
            onChange={(event) => setDeadlineDays(event.target.value === "none" ? null : Number(event.target.value))}
            className="mt-2 h-12 w-full rounded-field border border-line-strong bg-surface px-3.5 text-body text-ink focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none"
          >
            {REOPEN_DEADLINE_CHOICES.map((choice) => (
              <option key={choice.label} value={choice.value === null ? "none" : String(choice.value)}>
                {choice.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-caption text-ink-muted">Hạn cũ đã qua nên cần chọn hạn mới để khảo sát chạy tiếp.</p>
        </div>
      ) : null}

      <dl
        id="reopen-summary"
        aria-live="polite"
        className="mt-3.5 flex flex-col gap-2.5 rounded-2xl bg-surface-muted px-3.5 py-3.5 text-body-sm lg:mt-4.5 lg:px-4"
      >
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">
            Ký quỹ thêm · {cost.validQuantity ? quantity : 0} × {cost.perCompletion}
          </dt>
          <dd className="font-extrabold text-ink">{cost.total} điểm</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Số dư khả dụng</dt>
          <dd className="font-bold text-ink">{balance ? `${balance.available} điểm` : "Chưa có"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-ink">{cost.affordable ? "Còn lại" : "Còn thiếu"}</dt>
          <dd className={`font-extrabold ${cost.affordable ? "text-tone-teal-fg" : "text-danger"}`}>
            {cost.remaining === null ? "Chưa có" : `${Math.abs(cost.remaining)} điểm`}
          </dd>
        </div>
        {cost.discounted ? (
          <p className="text-[12px] text-ink-muted">
            Form Builder được giảm 20% ký quỹ: mỗi lượt khoá {cost.perCompletion} điểm, người trả lời vẫn nhận{" "}
            {form.rewardPerResponse} điểm.
          </p>
        ) : null}
      </dl>

      <ul className="mt-4 flex flex-col gap-2.5 text-caption leading-[18.9px] text-ink-strong lg:text-body-sm lg:leading-[20.3px]">
        <li className="flex items-start gap-2">
          <Icon name="check" size={16} className="mt-px text-primary" />
          {form.completedCompletions} câu trả lời cũ được giữ nguyên.
        </li>
        <li className="flex items-start gap-2">
          <Icon name="check" size={16} className="mt-px text-primary" />
          Người đã làm sẽ không làm lại được lần nữa.
        </li>
      </ul>

      {!cost.affordable ? (
        <Alert tone="danger" className="mt-4">
          Số dư khả dụng chưa đủ.{" "}
          <Link href="/wallet/top-up" className="font-bold underline">
            Nạp thêm điểm
          </Link>{" "}
          hoặc giảm số người trả lời.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <div className="mt-5 flex gap-3 lg:justify-end">
        <Button variant="secondary" size="xl" onClick={onDone} disabled={busy}>
          Huỷ
        </Button>
        <Button
          type="submit"
          size="lg"
          className="flex-1 lg:flex-none lg:px-7"
          loading={busy}
          loadingLabel="Đang mở lại…"
          disabled={!cost.validQuantity || !cost.affordable}
        >
          Khoá {cost.total} điểm &amp; mở lại
        </Button>
      </div>
    </form>
  );
}

function ReopenSheet({ form }: { form: PublisherForm }) {
  const router = useRouter();
  // Decided once: after a successful reopen the survey is PUBLISHED while the page navigates away.
  const [refusal] = useState(() => reopenRefusalOf(form));
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (busy) return;
    router.replace(`/forms/${encodeURIComponent(form.id)}`, { scroll: false });
  };

  return (
    <SheetDialog
      titleId="reopen-title"
      title="Mở lại khảo sát"
      subtitle={`${form.title} · đã đủ ${form.completedCompletions}/${form.expectedCompletions}`}
      onClose={close}
      dismissible={!busy}
    >
      {refusal === null ? (
        <ReopenForm form={form} onDone={close} onBusyChange={setBusy} />
      ) : (
        <>
          <Alert tone="info" className="mt-4">
            {reopenRefusalMessage(refusal)}
          </Alert>
          <Button variant="secondary" size="xl" fullWidth className="mt-5" onClick={close}>
            Đóng
          </Button>
        </>
      )}
    </SheetDialog>
  );
}

/** Figma 10b "Mở lại khảo sát" (63:1392 desktop dialog, 63:1843 mobile sheet). */
export function ReopenDialog() {
  const { form } = useFormHeader();
  return form ? <ReopenSheet form={form} /> : null;
}
