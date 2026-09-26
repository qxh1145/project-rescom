"use client";

import React from "react";
import type { FormTypeEnum } from "@rescom/schemas";
import { formStatusLabel, PUBLISH_TARGET_STATUS } from "../../form-status";

export interface PublishConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  formType: FormTypeEnum;
  blocksCount: number;
  rewardPerResponse: number;
  expectedCompletions: number;
  /** Decision E6-D2: the estimated duration picks the FR-14 pricing band. */
  estimatedDurationMinutes: number | null;
  pricingBandMessage: string;
  isPublishing: boolean;
  error: string | null;
}

export function PublishConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  formType,
  blocksCount,
  rewardPerResponse,
  expectedCompletions,
  estimatedDurationMinutes,
  pricingBandMessage,
  isPublishing,
  error,
}: PublishConfirmationModalProps) {
  if (!isOpen) return null;

  // Story 8.1: every publication (paid or free) is reviewed by an Admin first.
  const locksEscrow = rewardPerResponse > 0;
  const targetStatusLabel = formStatusLabel(PUBLISH_TARGET_STATUS);
  const estimatedTotalReward = rewardPerResponse * expectedCompletions;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold text-sm">
              🚀
            </span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Publish Survey
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl font-bold p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4 text-sm text-gray-600 dark:text-gray-300">
          {/* Immutability Warning Banner */}
          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl flex gap-3 text-amber-900 dark:text-amber-200 text-xs">
            <span className="text-base shrink-0">🔒</span>
            <div>
              <p className="font-semibold text-amber-950 dark:text-amber-100">
                Permanent Schema Lock
              </p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                Once published, this survey&apos;s questions, settings, and schema will
                be <strong>permanently locked from editing</strong> to protect respondent data integrity.
                Any adjustments later will require creating a new survey version.
              </p>
            </div>
          </div>

          {/* Survey Summary Details */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2 border border-gray-100 dark:border-gray-800 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500 dark:text-gray-400">Survey Title</span>
              <span className="font-semibold text-gray-900 dark:text-white max-w-[220px] truncate text-right">
                {title || "Untitled Survey"}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500 dark:text-gray-400">Distribution Type</span>
              <span className="font-semibold px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 uppercase text-[11px]">
                {formType}
              </span>
            </div>
            {formType !== "EXTERNAL" ? (
              <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400">Total Questions</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {blocksCount} {blocksCount === 1 ? "block" : "blocks"}
                </span>
              </div>
            ) : (
              <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400">Hosted Platform</span>
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                  Google Forms (External)
                </span>
              </div>
            )}
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500 dark:text-gray-400">Reward Per Completion</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {rewardPerResponse} points
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500 dark:text-gray-400">Thời gian dự kiến</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {estimatedDurationMinutes != null
                  ? `${estimatedDurationMinutes} phút`
                  : "Chưa đặt"}
              </span>
            </div>
            {rewardPerResponse > 0 && (
              <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
                <span className="text-gray-500 dark:text-gray-400">Total Escrow Budget</span>
                <span className="font-bold text-gray-900 dark:text-white">
                  {estimatedTotalReward} points ({expectedCompletions} completions)
                </span>
              </div>
            )}
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500 dark:text-gray-400">Target Lifecycle State</span>
              <span className="font-bold text-violet-700 dark:text-violet-300 text-xs">
                {targetStatusLabel}
              </span>
            </div>
          </div>

          {/* Decision E6-D2: FR-14 pricing band */}
          <p className="text-xs text-gray-500 dark:text-gray-400">{pricingBandMessage}</p>

          {/* Lifecycle state explanatory note */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {locksEscrow ? (
              <>
                Điểm thưởng sẽ được giữ trong ký quỹ và khảo sát chuyển sang trạng thái{" "}
                <strong>{targetStatusLabel}</strong>. Khảo sát chỉ xuất hiện trên Marketplace sau khi
                Admin phê duyệt; nếu bị từ chối, toàn bộ điểm ký quỹ được hoàn lại.
              </>
            ) : (
              <>
                Khảo sát sẽ chuyển sang trạng thái <strong>{targetStatusLabel}</strong> và chỉ xuất
                hiện trên Marketplace sau khi Admin phê duyệt.
              </>
            )}
          </p>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-xl text-xs">
              <p className="font-semibold">Publish Failed</p>
              <p className="mt-0.5">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="px-4 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPublishing}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-sm transition-colors disabled:opacity-50"
          >
            {isPublishing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Publishing...</span>
              </>
            ) : (
              <>
                <span>Confirm & Publish</span>
                <span>&rarr;</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
