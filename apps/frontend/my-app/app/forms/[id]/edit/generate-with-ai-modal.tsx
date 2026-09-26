"use client";

import { useState } from "react";
import type {
  AiPromptSubmissionInput,
  AiGatewayPromptPayload,
  FormBlockType,
} from "@rescom/schemas";
import { formMutationFetch } from "../../forms-api";

interface GenerateWithAiModalProps {
  isOpen: boolean;
  onClose: () => void;
  formId?: string;
  onSuccess?: (payload: AiGatewayPromptPayload) => void;
}

const AVAILABLE_BLOCK_TYPES: { type: FormBlockType; label: string }[] = [
  { type: "single_choice", label: "Single Choice" },
  { type: "multiple_choice", label: "Multiple Choice" },
  { type: "rating", label: "Rating Scale" },
  { type: "linear_scale", label: "Likert Scale" },
  { type: "text", label: "Short Text" },
  { type: "textarea", label: "Long Text" },
  { type: "number", label: "Numeric" },
  { type: "date", label: "Date" },
];

export function GenerateWithAiModal({
  isOpen,
  onClose,
  formId,
  onSuccess,
}: GenerateWithAiModalProps) {
  const [prompt, setPrompt] = useState("");
  const [targetQuestionCount, setTargetQuestionCount] = useState<number>(5);
  const [selectedTypes, setSelectedTypes] = useState<FormBlockType[]>([
    "single_choice",
    "rating",
    "textarea",
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successPayload, setSuccessPayload] =
    useState<AiGatewayPromptPayload | null>(null);

  if (!isOpen) return null;

  const promptLength = prompt.trim().length;
  const isPromptValid = promptLength >= 10 && promptLength <= 4000;

  function toggleBlockType(type: FormBlockType) {
    if (selectedTypes.includes(type)) {
      setSelectedTypes(selectedTypes.filter((t) => t !== type));
    } else {
      setSelectedTypes([...selectedTypes, type]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isPromptValid || loading) return;

    setLoading(true);
    setError(null);
    setSuccessPayload(null);

    const payloadInput: AiPromptSubmissionInput = {
      prompt: prompt.trim(),
      targetQuestionCount:
        targetQuestionCount > 0 ? targetQuestionCount : undefined,
      preferredBlockTypes:
        selectedTypes.length > 0 ? selectedTypes : undefined,
    };

    try {
      const endpoint = formId
        ? `/api/forms/ai/prepare-prompt`
        : `/api/forms/ai/prepare-prompt`;

      const res = await formMutationFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadInput),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          json?.error?.message ||
            `Failed to prepare AI prompt (HTTP ${res.status})`,
        );
      }

      const prepared: AiGatewayPromptPayload = json.data;
      setSuccessPayload(prepared);

      if (onSuccess) {
        onSuccess(prepared);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-lg">
              ✨
            </span>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Generate Survey with AI
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Describe your research objectives and let AI formulate the questions.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900 text-sm">
              {error}
            </div>
          )}

          {successPayload && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 text-sm flex items-center justify-between">
              <div>
                <p className="font-semibold">Prompt payload prepared successfully!</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                  Structured prompt with Form Definition rules is ready for AI Gateway execution.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium"
              >
                Done
              </button>
            </div>
          )}

          {/* Prompt Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="ai-prompt-input"
                className="text-sm font-medium text-gray-800 dark:text-gray-200"
              >
                Survey Description & Objectives *
              </label>
              <span
                className={`text-xs ${
                  promptLength < 10
                    ? "text-amber-500"
                    : promptLength > 4000
                      ? "text-red-500"
                      : "text-gray-400"
                }`}
              >
                {promptLength} / 4000 (min 10 chars)
              </span>
            </div>
            <textarea
              id="ai-prompt-input"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., I want a 5-question customer feedback survey for our new food delivery service. Focus on delivery punctuality, food temperature, packaging quality, and app ease of use..."
              className="w-full px-3.5 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
            />
          </div>

          {/* Preferences Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label
                htmlFor="ai-question-count"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Target Question Count
              </label>
              <input
                id="ai-question-count"
                type="number"
                min={1}
                max={30}
                value={targetQuestionCount}
                onChange={(e) => setTargetQuestionCount(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Suggested range: 3 to 10 questions.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Preferred Question Types
              </label>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_BLOCK_TYPES.map(({ type, label }) => {
                  const isSelected = selectedTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleBlockType(type)}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                        isSelected
                          ? "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-medium"
                          : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isPromptValid || loading}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Preparing Prompt...
                </>
              ) : (
                "✨ Generate Survey Structure"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
