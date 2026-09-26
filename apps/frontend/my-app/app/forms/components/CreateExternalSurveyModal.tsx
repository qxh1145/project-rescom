"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { calculateEscrowCost } from "@rescom/schemas";
import { formMutationFetch } from "../forms-api";
import {
  CLIPBOARD_COPY_FAILED_MESSAGE,
  copyTextToClipboard,
} from "@/lib/clipboard.ts";
import {
  EXTERNAL_EFFORT_MAX_MINUTES,
  EXTERNAL_EFFORT_MIN_MINUTES,
  effortMinutesToSeconds,
  validateExternalSurveyUrl,
} from "./external-survey-form.ts";
import {
  describePricingBand,
  pricingPublishErrorMessage,
} from "../pricing-band.ts";

export interface CreateExternalSurveyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateExternalSurveyModal({
  isOpen,
  onClose,
}: CreateExternalSurveyModalProps) {
  const router = useRouter();

  // Stepper state: 1 = Basics, 2 = Link, 3 = Review/Submit, 4 = Code Reveal
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Form fields
  const [title, setTitle] = useState<string>("Google Forms Survey");
  const [description, setDescription] = useState<string>("");
  const [externalUrl, setExternalUrl] = useState<string>("");
  const [rewardPerResponse, setRewardPerResponse] = useState<number>(10);
  const [expectedCompletions, setExpectedCompletions] = useState<number>(50);
  // PRD FR-12 Step 1: estimated completion time (drives the Marketplace
  // duration sort/filter instead of a fixed 60 s).
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(5);
  const [autoPublish, setAutoPublish] = useState<boolean>(true);

  // Submission & Reveal state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdFormId, setCreatedFormId] = useState<string | null>(null);
  const [plaintextCode, setPlaintextCode] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  if (!isOpen) return null;

  const effort = effortMinutesToSeconds(estimatedMinutes);
  const urlValidation = validateExternalSurveyUrl(externalUrl);
  const escrow = calculateEscrowCost({
    type: "EXTERNAL",
    expectedCompletions,
    rewardPerResponse,
  });
  // Decision E6-D2: the same estimate picks the FR-14 pricing band, enforced
  // when the survey is sent to moderation (a draft stays editable).
  const pricingBand = describePricingBand({
    type: "EXTERNAL",
    rewardPerResponse,
    estimatedDurationMinutes: effort.valid ? estimatedMinutes : null,
    // The metadata the backend stores for this survey (effort = estimate).
    definition: effort.valid
      ? {
          metadata: {
            expectedEffortSeconds: effort.seconds,
            minTimeBarrierSeconds: Math.min(15, effort.seconds),
          },
        }
      : null,
  });
  const pricingBlocksSubmit = autoPublish && pricingBand.blocksPublish;

  function handleNextFromStep1() {
    if (!title.trim()) {
      setErrorMessage("Survey title is required.");
      return;
    }
    if (rewardPerResponse < 1) {
      setErrorMessage("Điểm thưởng mỗi phản hồi phải từ 1 điểm trở lên.");
      return;
    }
    if (!effort.valid) {
      setErrorMessage(effort.error);
      return;
    }
    setErrorMessage(null);
    setStep(2);
  }

  function handleNextFromStep2() {
    if (!urlValidation.valid) {
      setErrorMessage(urlValidation.error);
      return;
    }
    setErrorMessage(null);
    setStep(3);
  }

  async function handleCreateSurvey() {
    if (pricingBlocksSubmit) {
      setErrorMessage(pricingBand.message);
      return;
    }
    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const res = await formMutationFetch("/api/forms/external", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          externalUrl: externalUrl.trim(),
          rewardPerResponse: Number(rewardPerResponse),
          expectedCompletions: Number(expectedCompletions),
          ...(effort.valid
            ? {
                expectedEffortSeconds: effort.seconds,
                estimatedDurationMinutes: estimatedMinutes,
              }
            : {}),
          autoPublish,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          pricingPublishErrorMessage(json?.error?.code, json?.error?.details) ||
            json?.error?.message ||
            "Failed to create external survey",
        );
      }

      const formId = json.data?.id;
      const code = json.data?.plaintextCompletionCode;

      if (!formId || !code) {
        throw new Error("Server did not return completion code");
      }

      setCreatedFormId(formId);
      setPlaintextCode(code);
      setStep(4);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to create external survey";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyCode() {
    if (!plaintextCode) return;
    const copied = await copyTextToClipboard(plaintextCode);
    if (!copied) {
      setIsCopied(false);
      setErrorMessage(CLIPBOARD_COPY_FAILED_MESSAGE);
      return;
    }
    setErrorMessage(null);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  }

  function handleFinish() {
    onClose();
    if (createdFormId) {
      router.push(`/forms/${createdFormId}/edit`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold text-sm">
              📋
            </span>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {step === 4
                  ? "Completion Code Generated"
                  : "Create External Survey (Google Forms)"}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {step === 4
                  ? "Action required: copy code to your Google Form"
                  : `Step ${step} of 3: ${
                      step === 1
                        ? "Survey Details"
                        : step === 2
                          ? "Form Destination"
                          : "Review & Confirm"
                    }`}
              </p>
            </div>
          </div>
          {step !== 4 && (
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl font-bold p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              &times;
            </button>
          )}
        </div>

        {/* Stepper Progress Bar */}
        {step !== 4 && (
          <div className="px-6 pt-3 pb-1 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between text-xs font-medium text-gray-500 mb-1">
              <span className={step >= 1 ? "text-indigo-600 dark:text-indigo-400 font-semibold" : ""}>
                1. Details
              </span>
              <span className={step >= 2 ? "text-indigo-600 dark:text-indigo-400 font-semibold" : ""}>
                2. Google Form Link
              </span>
              <span className={step >= 3 ? "text-indigo-600 dark:text-indigo-400 font-semibold" : ""}>
                3. Review
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-indigo-600 h-full transition-all duration-300 rounded-full"
                style={{ width: `${(step / 3) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-red-700 dark:text-red-400 text-xs">
            {errorMessage}
          </div>
        )}

        {/* Step 1: Basics */}
        {step === 1 && (
          <div className="p-6 space-y-4 text-sm">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Survey Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Developer Ergonomics & Productivity"
                className="w-full px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Description (Optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief summary shown to respondents on the marketplace..."
                className="w-full px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Reward (Points / Response)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={rewardPerResponse}
                  onChange={(e) => setRewardPerResponse(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Target Responses (Quota)
                </label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={expectedCompletions}
                  onChange={(e) => setExpectedCompletions(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="external-estimated-minutes"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
              >
                Thời gian hoàn thành dự kiến (phút) <span className="text-red-500">*</span>
              </label>
              <input
                id="external-estimated-minutes"
                type="number"
                min={EXTERNAL_EFFORT_MIN_MINUTES}
                max={EXTERNAL_EFFORT_MAX_MINUTES}
                step={1}
                value={Number.isNaN(estimatedMinutes) ? "" : estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(parseInt(e.target.value, 10))}
                aria-invalid={!effort.valid}
                aria-describedby="external-estimated-minutes-help"
                className="w-full px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p
                id="external-estimated-minutes-help"
                className={`text-xs mt-1 ${effort.valid ? "text-gray-500 dark:text-gray-400" : "text-red-600 dark:text-red-400"}`}
              >
                {effort.valid
                  ? "Người tham gia dùng thời gian này để sắp xếp và lọc khảo sát trên Chợ khảo sát."
                  : effort.error}
              </p>
              {effort.valid && (
                <p
                  role="status"
                  className={`text-xs mt-1 ${
                    pricingBand.tone === "error"
                      ? "text-red-600 dark:text-red-400"
                      : pricingBand.tone === "warning"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {pricingBand.message}
                </p>
              )}
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNextFromStep1}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
              >
                Next: Google Form Link →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Google Form Link */}
        {step === 2 && (
          <div className="p-6 space-y-4 text-sm">
            <div>
              <label
                htmlFor="external-survey-url"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
              >
                Google Form URL <span className="text-red-500">*</span>
              </label>
              <input
                id="external-survey-url"
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://docs.google.com/forms/d/e/... or https://forms.gle/..."
                aria-invalid={externalUrl.trim() !== "" && !urlValidation.valid}
                aria-describedby="external-survey-url-status"
                className="w-full px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Must use HTTPS. Phase 1 accepts Google Forms links only: <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">docs.google.com/forms/…</code>, <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">forms.gle/…</code> or <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">forms.google.com/…</code>.
              </p>
            </div>

            {/* Real-time link validation (same rule as the backend) */}
            {externalUrl.trim() !== "" && (
              <div
                id="external-survey-url-status"
                role={urlValidation.valid ? "status" : "alert"}
                className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                  !urlValidation.valid
                    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
                    : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                }`}
              >
                <span aria-hidden="true">{urlValidation.valid ? "✅" : "⚠️"}</span>
                <span>
                  {urlValidation.valid
                    ? "Valid Google Forms link detected! Completion code integration is fully supported."
                    : urlValidation.error}
                </span>
              </div>
            )}

            <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl text-amber-900 dark:text-amber-200 text-xs">
              <p className="font-semibold">How Completion Codes Work</p>
              <p className="mt-1 text-amber-800 dark:text-amber-300 leading-relaxed">
                When you proceed, RESCOM generates a unique 6-digit Completion Code. You will paste this code into your Google Form confirmation message so respondents can verify completion.
              </p>
            </div>

            <div className="pt-3 flex justify-between gap-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setStep(1);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleNextFromStep2}
                disabled={!urlValidation.valid}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next: Review & Confirm →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Submit */}
        {step === 3 && (
          <div className="p-6 space-y-4 text-sm">
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2.5 border border-gray-100 dark:border-gray-800 text-xs">
              <div className="flex justify-between py-1 border-b border-gray-200/60 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400">Title</span>
                <span className="font-semibold text-gray-900 dark:text-white">{title}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-200/60 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400">Destination URL</span>
                <span className="font-mono text-gray-900 dark:text-white max-w-[280px] truncate">
                  {externalUrl}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-200/60 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400">Reward / Quota</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {rewardPerResponse} pts / response ({expectedCompletions} slots)
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-200/60 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400">Thời gian dự kiến</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {estimatedMinutes} phút
                </span>
              </div>
              <div className="flex justify-between gap-3 py-1 border-b border-gray-200/60 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400 shrink-0">Khung giá thưởng</span>
                <span
                  className={`text-right ${
                    pricingBand.tone === "error"
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-900 dark:text-white"
                  }`}
                >
                  {pricingBand.range
                    ? `${pricingBand.range.min}–${pricingBand.range.max} điểm`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between py-1 items-center">
                <span className="text-gray-500 dark:text-gray-400">Gửi kiểm duyệt ngay</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoPublish}
                    onChange={(e) => setAutoPublish(e.target.checked)}
                    aria-label="Gửi kiểm duyệt ngay sau khi tạo"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>

            {/* AC4.1 Step 3: Escrow budget summary */}
            <div className="bg-indigo-50/60 dark:bg-indigo-950/30 rounded-xl p-4 space-y-2 border border-indigo-100 dark:border-indigo-900 text-xs">
              <p className="font-semibold text-indigo-950 dark:text-indigo-100">
                Ngân sách Escrow
              </p>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Thưởng thực tế / phản hồi</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {escrow.effectiveRewardPerResponse} điểm
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">
                  Chiết khấu ({escrow.discountPercent}%)
                </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  −{escrow.discountAmount} điểm
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-indigo-100 dark:border-indigo-900">
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  Tổng Escrow ({escrow.expectedCompletions} × {escrow.effectiveRewardPerResponse})
                </span>
                <span className="font-bold text-indigo-700 dark:text-indigo-300">
                  {escrow.effectiveCost} điểm
                </span>
              </div>
              {pricingBlocksSubmit && (
                <p role="alert" className="text-[11px] text-red-600 dark:text-red-400 leading-relaxed">
                  {pricingBand.message} Hoặc tắt “Gửi kiểm duyệt ngay” để lưu bản nháp.
                </p>
              )}
              <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                {autoPublish
                  ? `${escrow.effectiveCost} điểm sẽ được tạm giữ trong Escrow ngay khi bạn xác nhận (khảo sát được gửi kiểm duyệt). Phần chưa dùng được hoàn lại khi khảo sát đóng.`
                  : "Bản nháp chưa tạm giữ điểm. Escrow chỉ được tạm giữ khi bạn gửi kiểm duyệt."}
              </p>
            </div>

            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl text-blue-900 dark:text-blue-200 text-xs flex gap-2">
              <span className="text-base">🔐</span>
              <p>
                A cryptographically secure 6-digit Completion Code will be generated and bound via HMAC verifier.
                The code will be revealed on the next screen.
              </p>
            </div>

            <div className="pt-3 flex justify-between gap-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setStep(2);
                }}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleCreateSurvey}
                disabled={isSubmitting || pricingBlocksSubmit}
                className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Generating Code...</span>
                  </>
                ) : (
                  <span>Create & Reveal Code →</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Completion Code Reveal */}
        {step === 4 && (
          <div className="p-6 space-y-5 text-sm">
            {/* Warning Alert */}
            <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl flex items-start gap-3 text-amber-900 dark:text-amber-200 text-xs">
              <span className="text-lg shrink-0">⚠️</span>
              <div>
                <p className="font-bold text-amber-950 dark:text-amber-100 uppercase tracking-wide">
                  Copy this code now — Shown only once!
                </p>
                <p className="mt-0.5 text-amber-800 dark:text-amber-300 leading-relaxed">
                  For your security, RESCOM persists only a keyed HMAC cryptographic verifier and will <strong>never disclose or display this plaintext code again</strong>.
                </p>
              </div>
            </div>

            {/* Large Code Display Box */}
            <div className="bg-gray-900 text-white rounded-2xl p-6 text-center border border-gray-800 shadow-inner">
              <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-2">
                Your Completion Code
              </p>
              <div className="flex items-center justify-center gap-2 my-2">
                {plaintextCode?.split("").map((digit, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center justify-center w-11 h-14 bg-gray-800 border border-gray-700 rounded-xl text-3xl font-mono font-bold text-indigo-400 shadow-sm"
                  >
                    {digit}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-md ${
                    isCopied
                      ? "bg-emerald-600 text-white"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white"
                  }`}
                >
                  {isCopied ? (
                    <>
                      <span>✓</span>
                      <span>Copied to Clipboard!</span>
                    </>
                  ) : (
                    <>
                      <span>📋</span>
                      <span>Copy 6-Digit Code</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Setup Instructions */}
            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 border border-gray-100 dark:border-gray-800 text-xs space-y-2 text-gray-700 dark:text-gray-300">
              <p className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <span>📌</span>
                <span>Google Form Setup Instructions:</span>
              </p>
              <ol className="list-decimal list-inside space-y-1.5 pl-1 leading-relaxed">
                <li>
                  Open your survey in <strong>Google Forms</strong> editor.
                </li>
                <li>
                  Click the <strong>Settings</strong> tab at the top.
                </li>
                <li>
                  Expand <strong>Presentation</strong> and locate <strong>Confirmation message</strong>.
                </li>
                <li>
                  Click <strong>Edit</strong> and paste:
                  <div className="my-1 p-2 rounded bg-gray-100 dark:bg-gray-900 font-mono text-indigo-600 dark:text-indigo-400 select-all border border-gray-200 dark:border-gray-800">
                    Thank you! Your RESCOM Completion Code is: {plaintextCode}
                  </div>
                </li>
                <li>
                  Click <strong>Save</strong>. Respondents will copy this code upon finishing the Google Form and enter it on RESCOM to receive their reward!
                </li>
              </ol>
            </div>

            {/* Final Action Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={handleFinish}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-colors text-center"
              >
                I Have Copied the Code → Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
