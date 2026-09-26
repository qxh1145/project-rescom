"use client";

import React from "react";
import type {
  FormBlock,
  SingleChoiceBlock,
  MultipleChoiceBlock,
  RatingBlock,
  LinearScaleBlock,
  DateBlock,
  FileUploadBlock,
  NumberBlock,
  TextBlock,
  TextareaBlock,
  ChoiceOption,
} from "@rescom/schemas";
import { generateOptionId } from "@rescom/schemas";
import { BLOCK_METADATA_MAP } from "./block-definitions";

export interface BlockPropertiesPanelProps {
  block: FormBlock | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedBlock: FormBlock) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

export function BlockPropertiesPanel({
  block,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
  onDuplicate,
}: BlockPropertiesPanelProps) {
  if (!isOpen || !block) {
    return null;
  }

  const meta = BLOCK_METADATA_MAP[block.type] || {
    label: block.type,
    category: "input",
    description: "",
  };

  function updateField<K extends keyof FormBlock>(key: K, value: FormBlock[K]) {
    if (!block) return;
    onUpdate({
      ...block,
      [key]: value,
    });
  }

  // Common updates
  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    updateField("title", e.target.value);
  }

  function handleDescriptionChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    updateField("description", e.target.value || undefined);
  }

  function handleRequiredToggle(e: React.ChangeEvent<HTMLInputElement>) {
    updateField("required", e.target.checked);
  }

  return (
    <aside
      aria-label="Block Properties Panel"
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col transition-transform duration-200 ease-in-out"
    >
      {/* Panel Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-950/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
            {meta.label}
          </span>
          <span className="text-xs text-gray-400">Settings</span>
        </div>

        <div className="flex items-center gap-1">
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              title="Duplicate block"
              className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Delete block"
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            title="Close panel"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ml-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* General Settings */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            General
          </h4>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Question Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={block.title}
              onChange={handleTitleChange}
              placeholder="e.g., What is your primary role?"
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Help Text / Description (Optional)
            </label>
            <textarea
              value={block.description || ""}
              onChange={handleDescriptionChange}
              placeholder="Additional context or instructions for the respondent..."
              rows={2}
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
            <div>
              <span className="text-sm font-medium text-gray-900 dark:text-white block">
                Required
              </span>
              <span className="text-xs text-gray-400 block">
                Respondent must answer this question to submit
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={block.required}
                onChange={handleRequiredToggle}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
            </label>
          </div>
        </div>

        {/* Type-Specific Settings */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-800 space-y-4">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            {meta.label} Settings
          </h4>

          {/* TEXT BLOCK SETTINGS */}
          {block.type === "text" && (
            <TextBlockSettings
              block={block as TextBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}

          {/* TEXTAREA BLOCK SETTINGS */}
          {block.type === "textarea" && (
            <TextareaBlockSettings
              block={block as TextareaBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}

          {/* NUMBER BLOCK SETTINGS */}
          {block.type === "number" && (
            <NumberBlockSettings
              block={block as NumberBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}

          {/* SINGLE CHOICE SETTINGS */}
          {block.type === "single_choice" && (
            <SingleChoiceBlockSettings
              block={block as SingleChoiceBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}

          {/* MULTIPLE CHOICE SETTINGS */}
          {block.type === "multiple_choice" && (
            <MultipleChoiceBlockSettings
              block={block as MultipleChoiceBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}

          {/* RATING BLOCK SETTINGS */}
          {block.type === "rating" && (
            <RatingBlockSettings
              block={block as RatingBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}

          {/* LINEAR SCALE SETTINGS */}
          {block.type === "linear_scale" && (
            <LinearScaleBlockSettings
              block={block as LinearScaleBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}

          {/* DATE BLOCK SETTINGS */}
          {block.type === "date" && (
            <DateBlockSettings
              block={block as DateBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}

          {/* FILE UPLOAD BLOCK SETTINGS */}
          {block.type === "file_upload" && (
            <FileUploadBlockSettings
              block={block as FileUploadBlock}
              onUpdate={(updated) => onUpdate(updated)}
            />
          )}
        </div>
      </div>

      {/* Panel Footer */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 flex items-center justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
        >
          Done
        </button>
      </div>
    </aside>
  );
}

// -------------------------------------------------------------
// Type-Specific Settings Components
// -------------------------------------------------------------

function TextBlockSettings({
  block,
  onUpdate,
}: {
  block: TextBlock;
  onUpdate: (b: TextBlock) => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Placeholder
        </label>
        <input
          type="text"
          value={block.placeholder || ""}
          onChange={(e) =>
            onUpdate({ ...block, placeholder: e.target.value || undefined })
          }
          placeholder="e.g., Enter your answer here..."
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Min Length
          </label>
          <input
            type="number"
            min={0}
            value={block.minLength !== undefined ? block.minLength : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                minLength: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Max Length
          </label>
          <input
            type="number"
            min={1}
            value={block.maxLength !== undefined ? block.maxLength : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                maxLength: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
      </div>

      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Pattern (Regex)
        </label>
        <input
          type="text"
          value={block.pattern || ""}
          onChange={(e) =>
            onUpdate({ ...block, pattern: e.target.value || undefined })
          }
          placeholder="e.g., ^[A-Za-z0-9]+$"
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        />
      </div>
    </div>
  );
}

function TextareaBlockSettings({
  block,
  onUpdate,
}: {
  block: TextareaBlock;
  onUpdate: (b: TextareaBlock) => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Placeholder
        </label>
        <input
          type="text"
          value={block.placeholder || ""}
          onChange={(e) =>
            onUpdate({ ...block, placeholder: e.target.value || undefined })
          }
          placeholder="e.g., Provide as much detail as possible..."
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Min Characters
          </label>
          <input
            type="number"
            min={0}
            value={block.minLength !== undefined ? block.minLength : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                minLength: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Max Characters
          </label>
          <input
            type="number"
            min={1}
            value={block.maxLength !== undefined ? block.maxLength : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                maxLength: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
      </div>
    </div>
  );
}

function NumberBlockSettings({
  block,
  onUpdate,
}: {
  block: NumberBlock;
  onUpdate: (b: NumberBlock) => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Placeholder
        </label>
        <input
          type="text"
          value={block.placeholder || ""}
          onChange={(e) =>
            onUpdate({ ...block, placeholder: e.target.value || undefined })
          }
          placeholder="0"
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Minimum
          </label>
          <input
            type="number"
            value={block.min !== undefined ? block.min : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                min: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Maximum
          </label>
          <input
            type="number"
            value={block.max !== undefined ? block.max : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                max: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 items-center">
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Step Interval
          </label>
          <input
            type="number"
            min={0.01}
            value={block.step !== undefined ? block.step : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                step: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            placeholder="1"
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2 pt-4">
          <input
            type="checkbox"
            id="num-integer-only"
            checked={block.integerOnly ?? false}
            onChange={(e) =>
              onUpdate({ ...block, integerOnly: e.target.checked })
            }
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label
            htmlFor="num-integer-only"
            className="text-gray-700 dark:text-gray-300 cursor-pointer"
          >
            Integer Only
          </label>
        </div>
      </div>
    </div>
  );
}

function ChoiceOptionsEditor({
  options,
  onChange,
}: {
  options: ChoiceOption[];
  onChange: (options: ChoiceOption[]) => void;
}) {
  function handleAddOption() {
    const nextIdx = options.length + 1;
    const newOpt: ChoiceOption = {
      id: generateOptionId(),
      label: `Option ${nextIdx}`,
      value: `opt_${Date.now().toString(36)}_${nextIdx}`,
    };
    onChange([...options, newOpt]);
  }

  function handleUpdateOption(idx: number, patch: Partial<ChoiceOption>) {
    const next = [...options];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function handleDeleteOption(idx: number) {
    if (options.length <= 2) return;
    const next = options.filter((_, i) => i !== idx);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Choices ({options.length})
        </label>
        <span className="text-[11px] text-gray-400">Min 2 options</span>
      </div>

      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
        {options.map((opt, idx) => (
          <div key={opt.id} className="flex items-center gap-2">
            <span className="text-gray-400 text-xs w-4 text-center">
              {idx + 1}.
            </span>
            <div className="flex-1 grid grid-cols-2 gap-1.5">
              <input
                type="text"
                value={opt.label}
                onChange={(e) =>
                  handleUpdateOption(idx, { label: e.target.value })
                }
                aria-label={`Choice ${idx + 1} label`}
                placeholder="Label"
                className="min-w-0 px-2.5 py-1 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
              />
              <input
                type="text"
                value={opt.value}
                onChange={(e) =>
                  handleUpdateOption(idx, { value: e.target.value })
                }
                aria-label={`Choice ${idx + 1} value`}
                placeholder="Stored value"
                className="min-w-0 px-2.5 py-1 text-xs font-mono bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
              />
            </div>
            <button
              type="button"
              disabled={options.length <= 2}
              onClick={() => handleDeleteOption(idx)}
              title={
                options.length <= 2
                  ? "At least 2 options required"
                  : "Delete option"
              }
              className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleAddOption}
        className="mt-1 w-full py-1.5 border border-dashed border-gray-300 dark:border-gray-700 hover:border-indigo-500 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-medium transition-colors"
      >
        + Add Option
      </button>
    </div>
  );
}

function SingleChoiceBlockSettings({
  block,
  onUpdate,
}: {
  block: SingleChoiceBlock;
  onUpdate: (b: SingleChoiceBlock) => void;
}) {
  return (
    <div className="space-y-4 text-xs">
      <ChoiceOptionsEditor
        options={block.options}
        onChange={(options) => onUpdate({ ...block, options })}
      />

      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        <input
          type="checkbox"
          id="sc-allow-other"
          checked={block.allowOther ?? false}
          onChange={(e) => onUpdate({ ...block, allowOther: e.target.checked })}
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label
          htmlFor="sc-allow-other"
          className="text-gray-700 dark:text-gray-300 cursor-pointer"
        >
          Include &quot;Other&quot; write-in option
        </label>
      </div>
    </div>
  );
}

function MultipleChoiceBlockSettings({
  block,
  onUpdate,
}: {
  block: MultipleChoiceBlock;
  onUpdate: (b: MultipleChoiceBlock) => void;
}) {
  return (
    <div className="space-y-4 text-xs">
      <ChoiceOptionsEditor
        options={block.options}
        onChange={(options) => onUpdate({ ...block, options })}
      />

      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        <input
          type="checkbox"
          id="mc-allow-other"
          checked={block.allowOther ?? false}
          onChange={(e) => onUpdate({ ...block, allowOther: e.target.checked })}
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label
          htmlFor="mc-allow-other"
          className="text-gray-700 dark:text-gray-300 cursor-pointer"
        >
          Include &quot;Other&quot; write-in option
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2">
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Min Selections
          </label>
          <input
            type="number"
            min={1}
            max={block.options.length + (block.allowOther ? 1 : 0)}
            value={block.minSelections !== undefined ? block.minSelections : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                minSelections: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Max Selections
          </label>
          <input
            type="number"
            min={1}
            max={block.options.length + (block.allowOther ? 1 : 0)}
            value={block.maxSelections !== undefined ? block.maxSelections : ""}
            onChange={(e) =>
              onUpdate({
                ...block,
                maxSelections: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
      </div>
    </div>
  );
}

function RatingBlockSettings({
  block,
  onUpdate,
}: {
  block: RatingBlock;
  onUpdate: (b: RatingBlock) => void;
}) {
  const shapes: Array<"STAR" | "NUMBER" | "HEART"> = ["STAR", "NUMBER", "HEART"];
  const maxValues = [3, 5, 7, 10];

  return (
    <div className="space-y-4 text-xs">
      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1.5">
          Rating Scale Maximum
        </label>
        <div className="grid grid-cols-4 gap-2">
          {maxValues.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => onUpdate({ ...block, maxRating: val })}
              className={`py-1.5 rounded-lg border text-center font-medium transition-colors ${
                block.maxRating === val
                  ? "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-600 dark:text-indigo-400"
                  : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300"
              }`}
            >
              1 to {val}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1.5">
          Rating Shape
        </label>
        <div className="grid grid-cols-3 gap-2">
          {shapes.map((shape) => (
            <button
              key={shape}
              type="button"
              onClick={() => onUpdate({ ...block, ratingShape: shape })}
              className={`py-2 rounded-lg border text-center font-medium transition-colors ${
                block.ratingShape === shape
                  ? "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-600 dark:text-indigo-400"
                  : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300"
              }`}
            >
              {shape === "STAR" && "⭐ Star"}
              {shape === "NUMBER" && "🔢 Number"}
              {shape === "HEART" && "❤️ Heart"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LinearScaleBlockSettings({
  block,
  onUpdate,
}: {
  block: LinearScaleBlock;
  onUpdate: (b: LinearScaleBlock) => void;
}) {
  const range = block.max - block.min;
  const validSteps = Array.from({ length: range }, (_, index) => index + 1).filter(
    (step) => range % step === 0,
  );

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Min Value
          </label>
          <select
            value={block.min}
            onChange={(e) => {
              const min = Number(e.target.value) as 0 | 1;
              const nextRange = block.max - min;
              onUpdate({
                ...block,
                min,
                step: nextRange % block.step === 0 ? block.step : 1,
              });
            }}
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          >
            <option value={0}>0</option>
            <option value={1}>1</option>
          </select>
        </div>
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Max Value
          </label>
          <select
            value={block.max}
            onChange={(e) => {
              const max = Number(e.target.value);
              const nextRange = max - block.min;
              onUpdate({
                ...block,
                max,
                step: nextRange % block.step === 0 ? block.step : 1,
              });
            }}
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          >
            {[3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Step Interval
        </label>
        <select
          value={block.step}
          onChange={(e) => onUpdate({ ...block, step: Number(e.target.value) })}
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        >
          {validSteps.map((step) => (
            <option key={step} value={step}>
              {step}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Min Boundary Label
        </label>
        <input
          type="text"
          value={block.minLabel || ""}
          onChange={(e) =>
            onUpdate({ ...block, minLabel: e.target.value || undefined })
          }
          placeholder="e.g., Strongly Disagree"
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        />
      </div>

      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Max Boundary Label
        </label>
        <input
          type="text"
          value={block.maxLabel || ""}
          onChange={(e) =>
            onUpdate({ ...block, maxLabel: e.target.value || undefined })
          }
          placeholder="e.g., Strongly Agree"
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        />
      </div>
    </div>
  );
}

function DateBlockSettings({
  block,
  onUpdate,
}: {
  block: DateBlock;
  onUpdate: (b: DateBlock) => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-gray-800">
        <input
          type="checkbox"
          id="date-include-time"
          checked={block.includeTime ?? false}
          onChange={(e) =>
            onUpdate({ ...block, includeTime: e.target.checked })
          }
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label
          htmlFor="date-include-time"
          className="text-gray-700 dark:text-gray-300 cursor-pointer"
        >
          Include Time Picker
        </label>
      </div>

      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Earliest Allowed Date (minDate)
        </label>
        <input
          type="date"
          value={block.minDate || ""}
          onChange={(e) =>
            onUpdate({ ...block, minDate: e.target.value || undefined })
          }
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        />
      </div>

      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1">
          Latest Allowed Date (maxDate)
        </label>
        <input
          type="date"
          value={block.maxDate || ""}
          onChange={(e) =>
            onUpdate({ ...block, maxDate: e.target.value || undefined })
          }
          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        />
      </div>
    </div>
  );
}

function FileUploadBlockSettings({
  block,
  onUpdate,
}: {
  block: FileUploadBlock;
  onUpdate: (b: FileUploadBlock) => void;
}) {
  const mimeCatalog = [
    { label: "PDF Documents", value: "application/pdf" },
    { label: "PNG Images", value: "image/png" },
    { label: "JPEG Images", value: "image/jpeg" },
    { label: "WebP Images", value: "image/webp" },
    { label: "Word Documents", value: "application/msword" },
    { label: "ZIP Archives", value: "application/zip" },
  ];

  function toggleMime(mime: string) {
    const current = block.allowedMimeTypes || [];
    if (current.includes(mime)) {
      if (current.length <= 1) return; // Keep at least one
      onUpdate({
        ...block,
        allowedMimeTypes: current.filter((m) => m !== mime),
      });
    } else {
      onUpdate({
        ...block,
        allowedMimeTypes: [...current, mime],
      });
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Max File Size (MB)
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={block.maxFileSizeMb ?? 10}
            onChange={(e) =>
              onUpdate({
                ...block,
                maxFileSizeMb: Number(e.target.value) || 10,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-gray-700 dark:text-gray-300 mb-1">
            Max Files Allowed
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={block.maxFiles ?? 1}
            onChange={(e) =>
              onUpdate({
                ...block,
                maxFiles: Number(e.target.value) || 1,
              })
            }
            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
      </div>

      <div>
        <label className="block text-gray-700 dark:text-gray-300 mb-1.5 font-medium">
          Allowed File Types
        </label>
        <div className="space-y-1.5">
          {mimeCatalog.map((item) => {
            const isChecked = (block.allowedMimeTypes || []).includes(
              item.value,
            );
            return (
              <label
                key={item.value}
                className="flex items-center gap-2 cursor-pointer text-gray-700 dark:text-gray-300 hover:text-gray-900"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleMime(item.value)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{item.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
