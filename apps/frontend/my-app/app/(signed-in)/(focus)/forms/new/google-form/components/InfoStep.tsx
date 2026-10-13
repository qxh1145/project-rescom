"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { fieldClassName } from "@/components/ui/TextField";
import { CREATE_MESSAGES } from "@/lib/forms/create-messages";
import {
  DURATION_BANDS,
  TITLE_MAX_LENGTH,
  TOPIC_OPTIONS,
  normalizeWizardTopic,
  checkGoogleFormsUrl,
  durationBandOf,
  rewardRangeOf,
  type GoogleFormWizardDraft,
  type WizardErrors,
} from "@/lib/forms/create-wizard";
import { OptionButton } from "./OptionButton";

interface InfoStepProps {
  draft: GoogleFormWizardDraft;
  errors: WizardErrors;
  update: (patch: Partial<GoogleFormWizardDraft>) => void;
}

/** Figma 9a "Bước 1 · thông tin" (62:3679 desktop, 62:4017 mobile). */
export function InfoStep({ draft, errors, update }: InfoStepProps) {
  const url = draft.externalUrl.trim() ? checkGoogleFormsUrl(draft.externalUrl) : null;
  const urlError = errors.externalUrl ?? (url && !url.valid ? url.error : undefined);
  const band = durationBandOf(draft.durationBand);
  const range = rewardRangeOf(draft.durationBand);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="gform-url" className="text-label font-semibold text-ink">
          Link Google Forms
        </label>
        <div className="relative">
          <Icon name="link" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted" />
          <input
            id="gform-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://forms.gle/…"
            value={draft.externalUrl}
            onChange={(event) => update({ externalUrl: event.target.value })}
            aria-invalid={urlError ? true : undefined}
            aria-describedby="gform-url-status"
            className={fieldClassName(Boolean(urlError), "h-12 pl-11 focus:pl-11")}
          />
        </div>
        <div id="gform-url-status" aria-live="polite">
          {urlError ? (
            <p className="text-caption text-danger">{urlError}</p>
          ) : url?.valid ? (
            <p className="flex items-center gap-1.5 text-caption font-semibold text-tone-teal-fg">
              <Icon name="check" size={14} />
              <span>
                {CREATE_MESSAGES.urlValid}
                <span className="hidden lg:inline"> · để form ở chế độ ai có link cũng mở được</span>
              </span>
            </p>
          ) : null}
          <p className={`text-[12px] leading-4.5 text-ink-muted lg:hidden ${urlError || url?.valid ? "mt-1" : ""}`}>
            {CREATE_MESSAGES.urlPublicHint}
          </p>
        </div>
      </div>

      <div className="grid gap-x-4 gap-y-6 lg:grid-cols-[minmax(0,1fr)_243px]">
        <div className="order-1 flex flex-col gap-1.5 lg:order-none">
          <label htmlFor="gform-title" className="text-label font-semibold text-ink">
            Tiêu đề hiển thị trên Khám phá
          </label>
          <input
            id="gform-title"
            value={draft.title}
            maxLength={TITLE_MAX_LENGTH}
            onChange={(event) => update({ title: event.target.value })}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? "gform-title-error" : undefined}
            className={fieldClassName(Boolean(errors.title), "h-12")}
          />
          {errors.title ? (
            <p id="gform-title-error" className="text-caption text-danger">
              {errors.title}
            </p>
          ) : (
            <p className="self-end text-[12px] font-medium text-ink-muted lg:hidden" aria-live="polite">
              {draft.title.length}/{TITLE_MAX_LENGTH}
            </p>
          )}
        </div>
        <Select
          id="gform-topic"
          label="Chủ đề"
          className="order-3 lg:order-none"
          placeholder="Chọn chủ đề"
          options={TOPIC_OPTIONS}
          value={draft.topic}
          onChange={(event) => update({ topic: normalizeWizardTopic(event.target.value) })}
        />
        <Textarea
          id="gform-description"
          label="Mô tả ngắn"
          className="order-2 lg:order-none lg:col-span-2"
          rows={2}
          value={draft.description}
          error={errors.description}
          onChange={(event) => update({ description: event.target.value })}
        />
      </div>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2.5 text-label font-semibold text-ink">Thời gian làm ước tính</legend>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-2.5">
          {DURATION_BANDS.map((option) => (
            <OptionButton
              key={option.id}
              selected={draft.durationBand === option.id}
              onClick={() =>
                draft.durationBand === option.id
                  ? undefined
                  : update({
                      durationBand: option.id,
                      rewardPerResponse: String(rewardRangeOf(option.id)?.suggested ?? ""),
                    })
              }
            >
              {option.label}
            </OptionButton>
          ))}
        </div>
        {errors.durationBand ? <p className="text-caption text-danger">{errors.durationBand}</p> : null}
        {band && range ? (
          <p className="flex items-center gap-2.5 rounded-field bg-tone-amber-bg px-3 py-2.5 text-caption-relaxed text-ink lg:hidden">
            <Icon name="points-coin" size={18} className="text-tone-amber-fg" />
            <span>
              Khảo sát {band.shortLabel}: thưởng{" "}
              <strong className="font-bold">
                {range.min} đến {range.max} điểm
              </strong>{" "}
              mỗi lượt. Khai đúng thời gian để người làm không đánh giá thấp.
            </span>
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

/** Figma 9a right column: "Cách tạo", reward band, "Sau khi gửi". */
export function InfoAside({ draft, available }: { draft: GoogleFormWizardDraft; available: number | null }) {
  const band = durationBandOf(draft.durationBand);
  const range = rewardRangeOf(draft.durationBand);
  return (
    <>
      <div className="flex flex-col gap-2 rounded-[20px] border border-line bg-surface p-4">
        <p className="text-caption font-bold text-ink-muted">Cách tạo</p>
        <div aria-current="page" className="rounded-control border-2 border-primary bg-tone-green-bg px-3 py-2">
          <p className="text-[15px] font-extrabold text-primary-strong">Link Google Forms</p>
          <p className="text-[12px] text-ink-strong">10 đến 20 điểm/lượt · điểm chờ 48 giờ</p>
        </div>
        <Link
          href="/forms/new/builder"
          className="rounded-control border border-line-strong bg-surface px-3 py-2 transition-colors hover:bg-surface-subtle"
        >
          <p className="text-[15px] font-extrabold text-ink">Form Builder trong Rescom</p>
          <p className="text-[12px] text-ink-muted">Rẻ hơn 20% · 8 đến 16 điểm/lượt</p>
        </Link>
      </div>

      <div className="rounded-[20px] bg-tone-amber-bg px-5 py-4">
        <p className="text-caption font-bold text-tone-amber-fg">
          {band ? `Mức thưởng cho ${band.shortLabel}` : "Mức thưởng mỗi lượt"}
        </p>
        <p className="mt-1 text-title font-extrabold text-ink">
          {range ? `${range.min} đến ${range.max} điểm/lượt` : "Chọn thời gian làm"}
        </p>
        {available !== null ? (
          <p className="mt-2 text-caption-relaxed text-tone-amber-ink">Bạn có {available} điểm khả dụng.</p>
        ) : null}
      </div>

      <div className="rounded-[20px] border border-line bg-surface px-5 py-4">
        <p className="text-[15px] font-extrabold text-ink">Sau khi gửi</p>
        <ol className="mt-3 flex flex-col gap-3">
          {[
            "Điểm ký quỹ được khoá, bạn nhận mã hoàn thành.",
            "Admin duyệt khảo sát.",
            "Khảo sát hiện với người phù hợp trên Khám phá.",
          ].map((text, index) => (
            <li key={text} className="flex items-start gap-2.5 text-body-sm text-ink">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-[12px] font-extrabold">
                {index + 1}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
