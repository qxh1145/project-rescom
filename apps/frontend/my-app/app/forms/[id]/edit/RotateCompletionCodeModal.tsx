"use client";

import React, { useState } from "react";
import { formMutationFetch } from "../../forms-api";
import {
  CLIPBOARD_COPY_FAILED_MESSAGE,
  copyTextToClipboard,
} from "@/lib/clipboard.ts";

export interface RotateCompletionCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  formId: string;
  currentVersionNumber: number;
  /**
   * Called after a successful rotation. `updatedAt` is the form's new
   * optimistic-concurrency token (rotation bumps `Form.updatedAt`); the edit
   * page must hand it to autosave or the next autosave gets a 409.
   */
  onRotated: (newVersionNumber: number, updatedAt?: string) => void;
}

export function RotateCompletionCodeModal({
  isOpen,
  onClose,
  formId,
  currentVersionNumber,
  onRotated,
}: RotateCompletionCodeModalProps) {
  const [reason, setReason] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Once rotated, show code
  const [newCode, setNewCode] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  if (!isOpen) return null;

  async function handleRotate() {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const res = await formMutationFetch(`/api/forms/${formId}/rotate-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: reason.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.error?.message || "Failed to rotate completion code",
        );
      }

      const returnedCode = json.data?.plaintextCompletionCode;
      const nextVersion = json.data?.currentVersion?.versionNumber;
      const updatedAt: string | undefined = json.data?.updatedAt;

      if (!returnedCode) {
        throw new Error("Server did not return new completion code");
      }

      setNewCode(returnedCode);
      if (nextVersion) {
        onRotated(nextVersion, updatedAt);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to rotate completion code";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyCode() {
    if (!newCode) return;
    const copied = await copyTextToClipboard(newCode);
    if (!copied) {
      setIsCopied(false);
      setErrorMessage(CLIPBOARD_COPY_FAILED_MESSAGE);
      return;
    }
    setErrorMessage(null);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  }

  function handleClose() {
    setNewCode(null);
    setReason("");
    setErrorMessage(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 font-bold text-sm">
              🔄
            </span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {newCode ? "New Completion Code Generated" : "Rotate Completion Code"}
            </h3>
          </div>
          {!newCode && (
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl font-bold p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              &times;
            </button>
          )}
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-red-700 dark:text-red-400 text-xs">
            {errorMessage}
          </div>
        )}

        {!newCode ? (
          /* Pre-rotation confirmation */
          <div className="p-6 space-y-4 text-sm text-gray-600 dark:text-gray-300">
            <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-xl text-blue-900 dark:text-blue-200 text-xs">
              <p className="font-semibold text-blue-950 dark:text-blue-100">
                Safe Versioning & Verification
              </p>
              <p className="mt-1 text-blue-800 dark:text-blue-300 leading-relaxed">
                Rotating creates a new immutable version <strong>(v{currentVersionNumber + 1})</strong> with a brand new 6-digit completion code.
                Prior responses and in-flight submissions under <strong>v{currentVersionNumber}</strong> remain protected and will continue to validate correctly.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Rotation Reason (Optional)
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Periodic security rotation, or suspected code leak"
                className="w-full px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRotate}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Rotating...</span>
                  </>
                ) : (
                  <span>Rotate Code (v{currentVersionNumber + 1})</span>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Post-rotation code reveal */
          <div className="p-6 space-y-4 text-sm">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl text-amber-900 dark:text-amber-200 text-xs">
              <p className="font-bold uppercase tracking-wide">
                Copy this code now — Shown only once!
              </p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                Remember to update your Google Form confirmation message with this new code so new respondents receive it.
              </p>
            </div>

            <div className="bg-gray-900 text-white rounded-2xl p-5 text-center border border-gray-800">
              <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-2">
                New Completion Code
              </p>
              <div className="flex items-center justify-center gap-2 my-2">
                {newCode.split("").map((digit, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center justify-center w-10 h-13 bg-gray-800 border border-gray-700 rounded-xl text-2xl font-mono font-bold text-amber-400 shadow-sm"
                  >
                    {digit}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-md ${
                    isCopied
                      ? "bg-emerald-600 text-white"
                      : "bg-amber-600 hover:bg-amber-500 text-white"
                  }`}
                >
                  {isCopied ? "✓ Copied to Clipboard!" : "📋 Copy Code"}
                </button>
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-colors text-center"
              >
                I Have Copied the New Code → Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
