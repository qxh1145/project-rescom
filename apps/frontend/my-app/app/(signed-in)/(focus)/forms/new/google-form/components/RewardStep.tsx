"use client";

import Link from "next/link";
import { POINT_VND_RATE } from "@rescom/schemas";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { fieldClassName } from "@/components/ui/TextField";
import {
  COLLECTION_DAY_CHOICES,
  DURATION_BANDS,
  TOPIC_OPTIONS,
  audienceSummaryLine,
  collectionDaysLabel,
  durationBandOf,
  rewardRangeOf,
  stepSampleSize,
  type EscrowQuote,
  type GoogleFormWizardDraft,
  type WizardErrors,
} from "@/lib/forms/create-wizard";

export const TOP_UP_HREF = "/wallet/top-up";
const TOP_UP_EXAMPLE_POINTS = 100;
const VND = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

interface RewardStepProps {
  draft: GoogleFormWizardDraft;
  errors: WizardErrors;
  update: (patch: Partial<GoogleFormWizardDraft>) => void;
  quote: EscrowQuote | null;
  insufficient: boolean;
}

/**
 * Figma 9c "Bước 3 · số mẫu & điểm" (63:1768 desktop, 63:1991 mobile) and
 * 9c' "không đủ điểm" (63:2147, mobile; the desktop panel is derived —
 * ASSUMED, same place in the form card).
 */
export function RewardStep({ draft, errors, update, quote, insufficient }: RewardStepProps) {
  const band = durationBandOf(draft.durationBand);
  const range = rewardRangeOf(draft.durationBand);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-x-6 gap-y-6 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sample-size" className="text-label font-semibold text-ink">
            Số người trả lời cần
          </label>
          <div className="flex gap-2">
            <StepperButton label="Giảm 1" onClick={() => update({ sampleSize: stepSampleSize(draft.sampleSize, -1) })}>
              −
            </StepperButton>
            <input
              id="sample-size"
              inputMode="numeric"
              value={draft.sampleSize}
              onChange={(event) => update({ sampleSize: event.target.value.replace(/\D/g, "").slice(0, 6) })}
              aria-invalid={errors.sampleSize ? true : undefined}
              aria-describedby={errors.sampleSize ? "sample-size-error" : undefined}
              className={fieldClassName(Boolean(errors.sampleSize), "h-12 min-w-0 flex-1 text-center text-field-lg font-bold")}
            />
            <StepperButton label="Tăng 1" onClick={() => update({ sampleSize: stepSampleSize(draft.sampleSize, 1) })}>
              +
            </StepperButton>
          </div>
          {errors.sampleSize ? (
            <p id="sample-size-error" className="text-caption text-danger">
              {errors.sampleSize}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reward" className="text-label font-semibold text-ink">
            Điểm thưởng mỗi lượt
          </label>
          <div className="relative">
            <input
              id="reward"
              inputMode="numeric"
              value={draft.rewardPerResponse}
              onChange={(event) => update({ rewardPerResponse: event.target.value.replace(/\D/g, "").slice(0, 5) })}
              aria-invalid={errors.rewardPerResponse ? true : undefined}
              placeholder={range ? String(range.suggested) : undefined}
              aria-describedby="reward-hint"
              className={fieldClassName(Boolean(errors.rewardPerResponse), "h-12 pr-16 text-field-lg font-bold lg:pr-32")}
            />
            <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-body-sm text-ink-muted">
              điểm
              {range ? (
                <span className="hidden lg:inline">
                  {" "}
                  · từ {range.min} đến {range.max}
                </span>
              ) : null}
            </span>
          </div>
          <p id="reward-hint" className={`text-caption-relaxed ${errors.rewardPerResponse ? "text-danger" : "text-ink-muted lg:hidden"}`}>
            {errors.rewardPerResponse ??
              (band && range
                ? `Khảo sát ${band.shortLabel}: tối thiểu ${range.min}, tối đa ${range.max} điểm.${
                    insufficient ? "" : " Điểm cao hơn giúp có người trả lời nhanh hơn."
                  }`
                : "")}
          </p>
        </div>
      </div>

      {insufficient && quote ? <ShortfallPanel quote={quote} update={update} /> : null}

      <div className="lg:max-w-[calc(50%-12px)]">
        <Select
          id="collection-days"
          label="Hạn thu thập"
          options={COLLECTION_DAY_CHOICES.map((days) => ({ value: String(days), label: collectionDaysLabel(days) }))}
          value={String(draft.collectionDays)}
          onChange={(event) => update({ collectionDays: Number(event.target.value) })}
        />
      </div>

      <p className="hidden items-start gap-2.5 rounded-control bg-tone-green-bg px-3.5 py-3 text-body-sm text-ink lg:flex">
        <Icon name="info" size={18} className="mt-0.5 text-primary" />
        <span>
          Điểm cao hơn mức tối thiểu giúp có người trả lời nhanh hơn. Khi hết hạn hoặc đủ mẫu, khảo sát tự ẩn và phần ký
          quỹ chưa dùng được hoàn lại.
        </span>
      </p>

      {!insufficient && quote ? (
        <div className="rounded-[18px] border border-line bg-surface p-4 lg:hidden">
          <EscrowRows quote={quote} />
          <p className="mt-2 text-[12px] leading-4.5 text-ink-muted">
            Ký quỹ được trả dần cho người trả lời. Phần chưa dùng được hoàn lại khi khảo sát kết thúc hoặc bị từ chối.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function StepperButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-12 shrink-0 items-center justify-center rounded-field border border-line-strong bg-surface text-[22px] font-semibold text-ink hover:bg-surface-subtle"
    >
      {children}
    </button>
  );
}

/** Figma 9c' "Chưa đủ điểm · thiếu 248 điểm" with the three ways out. */
function ShortfallPanel({ quote, update }: { quote: EscrowQuote; update: (patch: Partial<GoogleFormWizardDraft>) => void }) {
  const affordable = quote.affordableSample;
  return (
    <section
      role="alert"
      aria-labelledby="shortfall-title"
      className="flex flex-col gap-2 rounded-[18px] border border-danger bg-danger-soft p-4"
    >
      <div className="flex items-start gap-2.5">
        <Icon name="alert-circle" size={20} className="mt-px text-danger" />
        <div>
          <p id="shortfall-title" className="text-[15px] font-extrabold text-danger-strong">
            Chưa đủ điểm · thiếu {quote.shortfall} điểm
          </p>
          <p className="text-body-sm text-ink">
            Cần khoá {quote.sample} × {quote.reward} = {quote.cost} điểm, bạn đang có {quote.available} điểm khả dụng.
          </p>
        </div>
      </div>
      {affordable >= 1 ? (
        <button
          type="button"
          onClick={() => update({ sampleSize: String(affordable) })}
          className={buttonClassName({ variant: "secondary", size: "base", radius: "field", fullWidth: true, className: "mt-1 text-[15px]" })}
        >
          Giảm còn {affordable} người · {affordable * quote.reward} điểm
        </button>
      ) : null}
      <Link
        href="/marketplace"
        className={buttonClassName({ variant: "secondary", size: "base", radius: "field", fullWidth: true, className: "text-[15px]" })}
      >
        Làm khảo sát để kiếm thêm điểm
      </Link>
      <Link
        href={TOP_UP_HREF}
        className={buttonClassName({
          variant: "primary",
          size: "base",
          radius: "field",
          fullWidth: true,
          className: "bg-tone-amber-accent text-[15px] font-extrabold text-ink hover:bg-tone-amber-accent hover:brightness-95",
        })}
      >
        Nạp điểm · {TOP_UP_EXAMPLE_POINTS} điểm = {VND.format(TOP_UP_EXAMPLE_POINTS * POINT_VND_RATE)}đ
      </Link>
    </section>
  );
}

function EscrowRows({ quote, large = false }: { quote: EscrowQuote; large?: boolean }) {
  const short = quote.remaining < 0;
  return (
    <>
      <p className="text-[15px] font-extrabold text-ink">Điểm sẽ khoá vào Ký quỹ</p>
      {large ? (
        <p className="mt-3 text-[36px] leading-9 font-extrabold text-tone-amber-fg">{quote.cost} điểm</p>
      ) : null}
      <dl className="mt-3 flex flex-col gap-2 text-body-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">
            {quote.sample} người × {quote.reward} điểm
          </dt>
          <dd className={large ? "font-bold text-ink" : "font-extrabold text-ink"}>
            {quote.cost}
            {large ? "" : " điểm"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Số dư khả dụng</dt>
          <dd className="font-bold text-ink">
            {quote.available}
            {large ? "" : " điểm"}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-2.5">
          <dt className="font-semibold text-ink">Còn lại sau khi gửi</dt>
          <dd className={`font-extrabold ${short ? "text-danger" : "text-tone-teal-fg"}`}>
            {short ? `Thiếu ${quote.shortfall} điểm` : `${quote.remaining} điểm`}
          </dd>
        </div>
      </dl>
    </>
  );
}

/** Figma 9c right column: escrow summary + survey summary. */
export function RewardAside({ draft, quote }: { draft: GoogleFormWizardDraft; quote: EscrowQuote | null }) {
  const band = DURATION_BANDS.find((item) => item.id === draft.durationBand);
  const topic = TOPIC_OPTIONS.find((option) => option.value === draft.topic)?.label;
  return (
    <>
      <section aria-label="Tóm tắt ký quỹ" data-tour="escrow-summary" className="rounded-[20px] border border-line bg-surface px-5 py-5">
        {quote ? (
          <EscrowRows quote={quote} large />
        ) : (
          <p className="text-body-sm text-ink-muted">Nhập số người và điểm thưởng để xem số điểm ký quỹ.</p>
        )}
      </section>
      <div className="rounded-[20px] border border-line bg-surface px-5 py-4">
        <p className="text-[15px] font-extrabold text-ink">Tóm tắt khảo sát</p>
        <p className="mt-2.5 text-body-sm font-bold text-ink">{draft.title.trim()}</p>
        <p className="mt-1.5 text-body-sm text-ink-muted">
          {["Google Forms", band?.shortLabel, topic].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1.5 text-body-sm text-ink-muted">{audienceSummaryLine(draft)}</p>
      </div>
    </>
  );
}
