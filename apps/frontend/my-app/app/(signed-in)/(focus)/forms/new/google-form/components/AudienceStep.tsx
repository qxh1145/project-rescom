"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import { fieldClassName } from "@/components/ui/TextField";
import { ToggleChip } from "@/components/ui/ToggleChip";
import type { ApiQueryState } from "@/lib/api/use-api-query";
import type { AudienceEstimate } from "@/lib/forms/create-service";
import {
  FIELDS_SHOWN_COLLAPSED,
  FIELD_OF_STUDY_CHOICES,
  GENDER_CHOICES,
  LOCATION_CHOICES,
  SCHOOL_CHOICES,
  SCHOOL_TARGETING_SUPPORTED,
  criteriaCount,
  criteriaSummary,
  toTargetingJson,
  type GoogleFormWizardDraft,
  type WizardErrors,
} from "@/lib/forms/create-wizard";
import { OptionButton } from "./OptionButton";

type EstimateState = ApiQueryState<AudienceEstimate> | null;

interface AudienceStepProps {
  draft: GoogleFormWizardDraft;
  errors: WizardErrors;
  update: (patch: Partial<GoogleFormWizardDraft>) => void;
  estimate: EstimateState;
}

const NOT_SUPPORTED_NOTE = SCHOOL_TARGETING_SUPPORTED
  ? "Chưa hỗ trợ lọc theo thu nhập và sở thích."
  : "Chưa hỗ trợ lọc theo trường, thu nhập và sở thích.";

/** Figma 9b "Bước 2 · đối tượng" (63:266 desktop, 63:1161 mobile) → `surveyTargetingSchema`. */
const NO_CRITERIA: Partial<GoogleFormWizardDraft> = {
  gender: "ALL",
  ageMin: "",
  ageMax: "",
  fieldsOfStudy: [],
  school: "",
  locations: [],
};

type AudienceMode = "all" | "custom";

export function AudienceStep({ draft, errors, update, estimate }: AudienceStepProps) {
  const [showAllFields, setShowAllFields] = useState(false);
  // UI-only: "custom" with nothing picked is still `{}` (everyone).
  const [mode, setMode] = useState<AudienceMode>(() =>
    criteriaCount(toTargetingJson(draft)) === 0 && !draft.school ? "all" : "custom",
  );

  function changeMode(next: AudienceMode) {
    setMode(next);
    if (next === "all") update(NO_CRITERIA);
  }

  function toggleField(field: string, selected: boolean) {
    update({
      fieldsOfStudy: selected
        ? [...draft.fieldsOfStudy, field]
        : draft.fieldsOfStudy.filter((item) => item !== field),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        label="Đối tượng khảo sát"
        segments={[
          { value: "all", label: "Tất cả người dùng" },
          { value: "custom", label: "Chọn đối tượng" },
        ]}
        value={mode}
        onChange={changeMode}
        fullWidth
        className="lg:w-auto"
      />
      <p className="text-body-sm text-ink-muted">
        {mode === "all"
          ? "Khảo sát hiển thị với mọi người dùng trên Marketplace."
          : "Chỉ người có hồ sơ phù hợp mới thấy khảo sát của bạn."}
      </p>

      <div className={mode === "all" ? "hidden" : "grid gap-x-6 gap-y-6 lg:grid-cols-2"}>
        <fieldset className="order-1 lg:order-none">
          <legend className="mb-2.5 text-label font-semibold text-ink">Giới tính</legend>
          {/* Mobile: 40px pills; desktop: 48px buttons (Figma 9b). */}
          <div className="flex gap-2 lg:hidden">
            {GENDER_CHOICES.map((choice) => (
              <ToggleChip
                key={choice.value}
                selected={draft.gender === choice.value}
                onSelectedChange={() => update({ gender: choice.value })}
              >
                {choice.label}
              </ToggleChip>
            ))}
          </div>
          <div className="hidden grid-cols-[1.5fr_1.15fr_1fr] gap-2 lg:grid">
            {GENDER_CHOICES.map((choice) => (
              <OptionButton
                key={choice.value}
                selected={draft.gender === choice.value}
                onClick={() => update({ gender: choice.value })}
              >
                {choice.label}
              </OptionButton>
            ))}
          </div>
        </fieldset>

        <fieldset className="order-2 lg:order-none">
          <legend className="mb-2.5 text-label font-semibold text-ink">Độ tuổi</legend>
          <div className="flex items-end gap-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="age-min" className="text-[12px] font-medium text-ink-muted lg:sr-only">
                Từ
              </label>
              <input
                id="age-min"
                inputMode="numeric"
                placeholder="18"
                value={draft.ageMin}
                onChange={(event) => update({ ageMin: event.target.value.replace(/\D/g, "").slice(0, 3) })}
                aria-invalid={errors.age ? true : undefined}
                aria-describedby={errors.age ? "age-error" : undefined}
                className={fieldClassName(Boolean(errors.age), "h-12")}
              />
            </div>
            <span aria-hidden="true" className="pb-3 text-[16px] text-ink-muted">
              <span className="lg:hidden">–</span>
              <span className="hidden lg:inline">đến</span>
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="age-max" className="text-[12px] font-medium text-ink-muted lg:sr-only">
                Đến
              </label>
              <input
                id="age-max"
                inputMode="numeric"
                placeholder="25"
                value={draft.ageMax}
                onChange={(event) => update({ ageMax: event.target.value.replace(/\D/g, "").slice(0, 3) })}
                aria-invalid={errors.age ? true : undefined}
                aria-describedby={errors.age ? "age-error" : undefined}
                className={fieldClassName(Boolean(errors.age), "h-12")}
              />
            </div>
          </div>
          {errors.age ? (
            <p id="age-error" className="mt-1.5 text-caption text-danger">
              {errors.age}
            </p>
          ) : null}
        </fieldset>

        {/* Hidden until the backend targeting supports schools (see SCHOOL_TARGETING_SUPPORTED). */}
        {SCHOOL_TARGETING_SUPPORTED ? (
          <Select
            id="audience-school"
            label="Trường"
            className="order-4 lg:order-none"
            options={[{ value: "", label: "Tất cả trường" }, ...SCHOOL_CHOICES.map((school) => ({ value: school, label: school }))]}
            value={draft.school}
            onChange={(event) => update({ school: event.target.value })}
          />
        ) : null}
        <div className="order-5 flex flex-col gap-2.5 lg:order-none">
          {/* 63 provinces: too many chips, so a select adds and chips remove. */}
          <Select
            id="audience-location"
            label="Khu vực · chọn nhiều"
            options={[
              { value: "", label: draft.locations.length > 0 ? "Thêm khu vực…" : "Tất cả khu vực" },
              ...LOCATION_CHOICES.filter((location) => !draft.locations.includes(location)).map((location) => ({
                value: location,
                label: location,
              })),
            ]}
            value=""
            onChange={(event) => {
              if (event.target.value) update({ locations: [...draft.locations, event.target.value] });
            }}
          />
          {draft.locations.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {draft.locations.map((location) => (
                <ToggleChip
                  key={location}
                  selected
                  aria-label={`Bỏ ${location}`}
                  onSelectedChange={() => update({ locations: draft.locations.filter((item) => item !== location) })}
                >
                  {location}
                </ToggleChip>
              ))}
            </div>
          ) : null}
        </div>

        <fieldset className="order-3 lg:order-none lg:col-span-2">
          <legend className="mb-2.5 text-label font-semibold text-ink">
            Ngành học <span className="font-medium text-ink-muted">· chọn nhiều</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {/* No field picked = no fieldOfStudy criterion = every field. */}
            <ToggleChip
              selected={draft.fieldsOfStudy.length === 0}
              onSelectedChange={() => update({ fieldsOfStudy: [] })}
            >
              Tất cả các ngành
            </ToggleChip>
            {FIELD_OF_STUDY_CHOICES.map((field, index) => {
              const selected = draft.fieldsOfStudy.includes(field);
              const collapsed = !showAllFields && index >= FIELDS_SHOWN_COLLAPSED && !selected;
              return (
                <ToggleChip
                  key={field}
                  selected={selected}
                  onSelectedChange={(next) => toggleField(field, next)}
                  className={collapsed ? "hidden lg:inline-flex" : ""}
                >
                  {field}
                </ToggleChip>
              );
            })}
            {!showAllFields ? (
              <button
                type="button"
                onClick={() => setShowAllFields(true)}
                className="inline-flex h-10 items-center rounded-full border border-dashed border-line-strong px-4 text-label font-semibold text-ink-muted hover:bg-surface-subtle lg:hidden"
              >
                Xem thêm ngành
              </button>
            ) : null}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col gap-4 lg:hidden">
        <div className="flex items-center gap-3 rounded-2xl bg-tone-teal-bg px-4 py-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-tone-teal-accent text-ink">
            <Icon name="users" size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-extrabold text-ink">
              <EstimateText estimate={estimate} format="sentence" />
            </p>
            <p className="text-caption-relaxed text-tone-teal-ink">
              Ước tính theo hồ sơ hiện có. Muốn nhiều người hơn, hãy nới tiêu chí.
            </p>
          </div>
        </div>
        <p className="text-[12px] leading-4.5 text-ink-muted">{NOT_SUPPORTED_NOTE}</p>
      </div>
    </div>
  );
}

function EstimateText({ estimate, format }: { estimate: EstimateState; format: "sentence" | "number" }) {
  if (!estimate) return <>{format === "sentence" ? "Chọn tiêu chí để ước tính" : "—"}</>;
  if (estimate.data) {
    const { estimatedRespondents, minimumReportable } = estimate.data;
    // Below the minimum the backend withholds the number (k-anonymity).
    if (estimatedRespondents === null) {
      return <>{format === "sentence" ? `Dưới ${minimumReportable} người phù hợp` : `< ${minimumReportable} người`}</>;
    }
    const count = estimatedRespondents.toLocaleString("vi-VN");
    return <>{format === "sentence" ? `Khoảng ${count} người phù hợp` : `${count} người`}</>;
  }
  if (estimate.error) return <>{format === "sentence" ? "Chưa ước tính được số người" : "—"}</>;
  return <>{format === "sentence" ? "Đang ước tính…" : "…"}</>;
}

/** Figma 9b right column: estimate card + "Tiêu chí đã chọn". */
export function AudienceAside({ draft, estimate }: { draft: GoogleFormWizardDraft; estimate: EstimateState }) {
  return (
    <>
      <div data-tour="audience-estimate" className="rounded-[20px] bg-tone-teal-bg p-5">
        <span className="flex size-11 items-center justify-center rounded-field bg-tone-teal-accent text-ink">
          <Icon name="users" size={22} />
        </span>
        <p className="mt-2 text-caption font-bold text-tone-teal-ink">Người phù hợp ước tính</p>
        <p className="mt-1 text-[32px] leading-[35.2px] font-extrabold text-ink" aria-live="polite">
          <EstimateText estimate={estimate} format="number" />
        </p>
        <p className="mt-2 text-caption-relaxed text-tone-teal-ink">
          Ước tính theo hồ sơ hiện có. Muốn nhiều người hơn, hãy nới tiêu chí.
        </p>
      </div>
      <div className="rounded-[20px] border border-line bg-surface px-5 py-4">
        <p className="text-[15px] font-extrabold text-ink">Tiêu chí đã chọn</p>
        <dl className="mt-2.5 flex flex-col gap-2 text-body-sm">
          {criteriaSummary(draft).map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{row.label}</dt>
              <dd className="truncate text-right font-bold text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 text-[12px] text-ink-muted">{NOT_SUPPORTED_NOTE}</p>
      </div>
    </>
  );
}
