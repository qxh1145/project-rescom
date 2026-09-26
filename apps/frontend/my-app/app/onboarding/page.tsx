"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  mockRepository,
  type MockRepositoryError,
} from "@/lib/mock/repository.ts";
import { PortalShell } from "@/components/layout/PortalShell";
import { resolvePostOnboardingPath } from "@/lib/onboarding.ts";
import {
  FIELDS_OF_STUDY,
  GENDER_OPTIONS,
  INCOME_RANGES,
  INTEREST_OPTIONS,
  OCCUPATIONS,
  VIETNAM_LOCATIONS,
  withSavedOption,
  withSavedOptions,
} from "@/lib/demographic-options.ts";
import type { DemographicProfileField, Gender } from "@rescom/schemas";

const FIELD_LABELS: Record<DemographicProfileField, string> = {
  age: "Độ tuổi",
  gender: "Giới tính",
  location: "Tỉnh / Thành phố",
  occupation: "Nghề nghiệp",
  fieldOfStudy: "Khối ngành",
  householdIncome: "Mức thu nhập",
  specificInterests: "Lĩnh vực quan tâm",
};

const FIELD_STEP: Record<DemographicProfileField, number> = {
  age: 1,
  gender: 1,
  location: 1,
  occupation: 2,
  fieldOfStudy: 2,
  householdIncome: 2,
  specificInterests: 3,
};

const TOTAL_STEPS = 3;

const SELECT_CLASS =
  "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500";

function OnboardingLoading({ label }: { label: string }) {
  return (
    <div className="py-24 text-center" role="status">
      <div className="w-10 h-10 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-3" />
      <p className="text-xs font-semibold text-slate-500">{label}</p>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <PortalShell>
      <Suspense fallback={<OnboardingLoading label="Đang tải hồ sơ nhân khẩu học..." />}>
        <OnboardingContent />
      </Suspense>
    </PortalShell>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by earning pages that redirected here (Story 7.1).
  const wasRedirected = searchParams.get("required") === "1";
  const returnTo = searchParams.get("returnTo");

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Answers start empty: every FR-6 field must be actively answered.
  const [age, setAge] = useState<number | "">("");
  const [gender, setGender] = useState<Gender | "">("");
  const [location, setLocation] = useState("");
  const [occupation, setOccupation] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [householdIncome, setHouseholdIncome] = useState("");
  const [interests, setInterests] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        const user = await mockRepository.getCurrentUser();
        if (!active) return;
        if (!user) {
          router.push("/login");
          return;
        }

        // Resume an interrupted draft first, otherwise prefill a saved profile.
        const draft = await mockRepository.getOnboardingDraft();
        if (!active) return;
        const saved = draft?.answers ?? (await mockRepository.getDemographicProfile());
        if (!active) return;

        if (draft?.step) {
          setStep(Math.min(Math.max(1, draft.step), TOTAL_STEPS));
        }
        if (saved) {
          if (typeof saved.age === "number") setAge(saved.age);
          if (saved.gender) setGender(saved.gender);
          if (saved.location) setLocation(saved.location);
          if (saved.occupation) setOccupation(saved.occupation);
          if (saved.fieldOfStudy) setFieldOfStudy(saved.fieldOfStudy);
          if (saved.householdIncome) setHouseholdIncome(saved.householdIncome);
          if (Array.isArray(saved.specificInterests)) {
            setInterests(
              saved.specificInterests.filter(
                (item): item is string => typeof item === "string",
              ),
            );
          }
        }
      } catch (err) {
        console.error("Failed to load onboarding draft:", err);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [router]);

  function persistCurrentDraft(nextStep: number) {
    void mockRepository.saveOnboardingDraft({
      step: nextStep,
      answers: {
        age: typeof age === "number" ? age : null,
        gender: gender || null,
        location: location || null,
        occupation: occupation || null,
        fieldOfStudy: fieldOfStudy || null,
        householdIncome: householdIncome || null,
        specificInterests: interests,
      },
    });
  }

  /** Vietnamese validation message for the current step, or null when valid. */
  function validateStep(currentStep: number): string | null {
    if (currentStep === 1) {
      if (typeof age !== "number" || !Number.isInteger(age) || age < 13 || age > 100) {
        return "Vui lòng nhập độ tuổi hợp lệ (số nguyên từ 13 đến 100).";
      }
      if (!gender) return "Vui lòng chọn giới tính.";
      if (!location) return "Vui lòng chọn Tỉnh / Thành phố.";
    } else if (currentStep === 2) {
      if (!occupation) return "Vui lòng chọn nghề nghiệp hiện tại.";
      if (!fieldOfStudy) return "Vui lòng chọn khối ngành học.";
      if (!householdIncome) return "Vui lòng chọn mức thu nhập / trợ cấp hàng tháng.";
    } else if (currentStep === 3) {
      if (interests.length === 0) return "Vui lòng chọn ít nhất 1 lĩnh vực quan tâm.";
    }
    return null;
  }

  function handleNextStep() {
    const message = validateStep(step);
    setError(message);
    if (message) return;

    const nextStep = Math.min(TOTAL_STEPS, step + 1);
    setStep(nextStep);
    persistCurrentDraft(nextStep);
  }

  function handlePrevStep() {
    setError(null);
    const prevStep = Math.max(1, step - 1);
    setStep(prevStep);
    persistCurrentDraft(prevStep);
  }

  function toggleInterest(item: string) {
    setInterests((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item],
    );
  }

  async function handleFinalSubmit() {
    for (let current = 1; current <= TOTAL_STEPS; current += 1) {
      const message = validateStep(current);
      if (message) {
        setStep(current);
        setError(message);
        return;
      }
    }

    setError(null);
    setSubmitting(true);

    try {
      const result = await mockRepository.submitDemographicSurvey({
        age: age as number,
        gender: gender as Gender,
        location,
        occupation,
        fieldOfStudy,
        householdIncome,
        specificInterests: interests,
      });

      // Handoff: open the Marketplace activation step (FR-7) or return.
      setRedirecting(true);
      router.replace(resolvePostOnboardingPath(result, returnTo));
    } catch (err) {
      const repoError = err as MockRepositoryError;
      const fields = (repoError.details?.fields ?? []) as DemographicProfileField[];
      if (repoError.code === "VALIDATION_ERROR" && fields.length > 0) {
        setStep(FIELD_STEP[fields[0]] ?? 1);
        setError(
          `Vui lòng kiểm tra lại: ${fields.map((field) => FIELD_LABELS[field]).join(", ")}.`,
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Có lỗi khi lưu hồ sơ nhân khẩu học. Vui lòng thử lại.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <OnboardingLoading label="Đang tải hồ sơ nhân khẩu học..." />;
  }

  if (redirecting) {
    return <OnboardingLoading label="Đã lưu hồ sơ! Đang mở bước kích hoạt trên Chợ khảo sát..." />;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {wasRedirected && (
        <div
          role="status"
          className="mb-4 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-200 leading-relaxed"
        >
          <strong>Cần hoàn thành khảo sát nhân khẩu học bắt buộc.</strong> Chợ khảo sát và các khảo sát có thưởng chỉ mở sau khi bạn trả lời đầy đủ các câu hỏi bên dưới.
        </div>
      )}

      {/* Frozen Points Notice Banner */}
      <div className="mb-6 p-4 rounded-3xl bg-gradient-to-r from-sky-50 to-emerald-50 dark:from-sky-950/40 dark:to-emerald-950/40 border border-sky-200 dark:border-sky-900/60 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-100 dark:bg-sky-900/80 text-sky-600 dark:text-sky-300 flex items-center justify-center text-xl shrink-0" aria-hidden="true">
            ❄️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-900 dark:text-white">
                Khảo sát nhân khẩu học bắt buộc
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300">
                Bước 1 / 2
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Bạn đang có <strong>100 điểm tân thủ bị Khóa (Frozen)</strong>. Để bảo đảm chất lượng dữ liệu nghiên cứu, bạn cần:{" "}
              <strong>(1) Hoàn thành khảo sát nhân khẩu học</strong> này và{" "}
              <strong>(2) Làm 1 khảo sát đầu tiên</strong> trên Chợ để mở khóa toàn bộ 100 điểm.
            </p>
          </div>
        </div>
      </div>

      {/* Wizard Card */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm">
        {/* Step Progress Bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
            <span>
              Bước {step} trên {TOTAL_STEPS}:{" "}
              {step === 1
                ? "Thông tin cơ bản"
                : step === 2
                  ? "Học tập & Nghề nghiệp"
                  : "Sở thích & Nghiên cứu"}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">
              {Math.round((step / TOTAL_STEPS) * 100)}%
            </span>
          </div>
          <div
            className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={step}
            aria-label="Tiến độ khảo sát nhân khẩu học"
          >
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 motion-reduce:transition-none rounded-full"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div
            role="alert"
            className="mb-5 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs"
          >
            {error}
          </div>
        )}

        {/* Step 1: Basic Information */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="dem-age"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
              >
                Độ tuổi của bạn <span className="text-rose-600" aria-hidden="true">*</span>
              </label>
              <input
                id="dem-age"
                type="number"
                inputMode="numeric"
                min={13}
                max={100}
                required
                value={age}
                placeholder="Ví dụ: 20"
                onChange={(e) =>
                  setAge(e.target.value === "" ? "" : Number(e.target.value))
                }
                className={SELECT_CLASS}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Độ tuổi phổ biến từ 18 - 25 dành cho sinh viên đại học.
              </p>
            </div>

            <fieldset>
              <legend className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Giới tính <span className="text-rose-600" aria-hidden="true">*</span>
              </legend>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {GENDER_OPTIONS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    aria-pressed={gender === g.value}
                    onClick={() => setGender(g.value)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                      gender === g.value
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="dem-location"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
              >
                Tỉnh / Thành phố sinh sống & học tập <span className="text-rose-600" aria-hidden="true">*</span>
              </label>
              <select
                id="dem-location"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  — Chọn Tỉnh / Thành phố —
                </option>
                {withSavedOption(VIETNAM_LOCATIONS, location).map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Step 2: Education & Work */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="dem-occupation"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
              >
                Nghề nghiệp / Tình trạng học tập <span className="text-rose-600" aria-hidden="true">*</span>
              </label>
              <select
                id="dem-occupation"
                required
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  — Chọn nghề nghiệp —
                </option>
                {withSavedOption(OCCUPATIONS, occupation).map((occ) => (
                  <option key={occ} value={occ}>
                    {occ}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="dem-field"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
              >
                Khối ngành đào tạo / Lĩnh vực chuyên môn <span className="text-rose-600" aria-hidden="true">*</span>
              </label>
              <select
                id="dem-field"
                required
                value={fieldOfStudy}
                onChange={(e) => setFieldOfStudy(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  — Chọn khối ngành —
                </option>
                {withSavedOption(FIELDS_OF_STUDY, fieldOfStudy).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="dem-income"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
              >
                Mức thu nhập cá nhân / trợ cấp hàng tháng <span className="text-rose-600" aria-hidden="true">*</span>
              </label>
              <select
                id="dem-income"
                required
                value={householdIncome}
                onChange={(e) => setHouseholdIncome(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  — Chọn mức thu nhập —
                </option>
                {withSavedOption(INCOME_RANGES, householdIncome).map((inc) => (
                  <option key={inc} value={inc}>
                    {inc}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Step 3: Interests & Topics */}
        {step === 3 && (
          <fieldset>
            <legend className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Lĩnh vực quan tâm (Chọn các chủ đề bạn muốn tham gia khảo sát){" "}
              <span className="text-rose-600" aria-hidden="true">*</span>
            </legend>
            <p className="text-[11px] text-slate-400 mb-3">
              Chọn ít nhất 1 lĩnh vực để nhận được các khảo sát phù hợp nhất. Đã chọn: {interests.length}.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {/* Code review P9: saved interests outside the catalog stay visible and removable. */}
              {withSavedOptions(INTEREST_OPTIONS, interests).map((item) => {
                const isChecked = interests.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={isChecked}
                    onClick={() => toggleInterest(item)}
                    className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition-all flex items-center justify-between focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                      isChecked
                        ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    }`}
                  >
                    <span>{item}</span>
                    {isChecked && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* Navigation buttons */}
        <div className="mt-8 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={handlePrevStep}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              &larr; Quay lại
            </button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={handleNextStep}
              className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              Tiếp tục &rarr;
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={submitting}
              className="px-6 py-2.5 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 disabled:opacity-60 transition-all cursor-pointer flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              {submitting ? "Đang lưu..." : "Hoàn tất khảo sát 🎉"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
