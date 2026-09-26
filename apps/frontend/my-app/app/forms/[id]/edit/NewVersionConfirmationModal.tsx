"use client";

import React from "react";
import { describeNewVersionImpact } from "../../attempt-window";

export interface NewVersionConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  currentVersionNumber: number;
  isCreating: boolean;
  error: string | null;
  /**
   * Decision E5-D4: respondents currently taking the live survey (they are
   * cut off); null while loading or when the count could not be loaded.
   */
  inProgressAttempts?: number | null;
  isLoadingImpact?: boolean;
}

export function NewVersionConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  currentVersionNumber,
  isCreating,
  error,
  inProgressAttempts = null,
  isLoadingImpact = false,
}: NewVersionConfirmationModalProps) {
  if (!isOpen) return null;

  const nextVersionNumber = currentVersionNumber + 1;
  const impact = describeNewVersionImpact(
    isLoadingImpact ? null : inProgressAttempts,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold text-sm">
              ✨
            </span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Create New Version
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl font-bold p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4 text-sm text-gray-600 dark:text-gray-300">
          {/* Versioning Explanation Banner */}
          <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-xl flex gap-3 text-blue-900 dark:text-blue-200 text-xs">
            <span className="text-base shrink-0">ℹ️</span>
            <div>
              <p className="font-semibold text-blue-950 dark:text-blue-100">
                Safe Versioning & Data Protection
              </p>
              <p className="mt-0.5 text-blue-800 dark:text-blue-300">
                Creating a new version copies all existing questions into an editable <strong>DRAFT (v{nextVersionNumber})</strong>.
                Historical survey submissions and telemetry remain strictly pinned to <strong>v{currentVersionNumber}</strong>.
              </p>
            </div>
          </div>

          {/* Decision E5-D4: in-progress respondents are cut off */}
          <div
            role={impact.tone === "warning" ? "alert" : "status"}
            aria-live="polite"
            className={`p-3.5 rounded-xl flex gap-3 text-xs border ${
              impact.tone === "warning"
                ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200"
                : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
            }`}
          >
            <span className="text-base shrink-0" aria-hidden="true">
              {impact.tone === "warning" ? "⚠️" : "ℹ️"}
            </span>
            <div>
              <p className="font-semibold">
                {isLoadingImpact
                  ? "Đang kiểm tra người đang làm khảo sát…"
                  : "Người đang làm khảo sát sẽ bị dừng"}
              </p>
              <p className="mt-0.5">{impact.message}</p>
            </div>
          </div>

          {/* Version Details */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2 border border-gray-100 dark:border-gray-800 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500 dark:text-gray-400">Current Live Version</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                Version {currentVersionNumber} (PUBLISHED - Immutable)
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500 dark:text-gray-400">New Target Version</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                Version {nextVersionNumber} (DRAFT)
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500 dark:text-gray-400">Form Status After Action</span>
              <span className="font-mono font-bold text-amber-600 dark:text-amber-400 text-xs">
                DRAFT (Unlocked for editing)
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Once confirmed, your editor canvas will unlock, allowing you to add, edit, or remove questions before publishing version {nextVersionNumber}.
          </p>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-xl text-xs">
              <p className="font-semibold">Failed to Create Version</p>
              <p className="mt-0.5">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isCreating}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl shadow-sm transition-colors disabled:opacity-50"
          >
            {isCreating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Creating Version...</span>
              </>
            ) : (
              <>
                <span>Create Version {nextVersionNumber}</span>
                <span>&rarr;</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
