"use client";

import type { MultipleChoiceBlock } from "@rescom/schemas";

interface MultipleChoiceBlockPreviewProps {
  block: MultipleChoiceBlock;
}

export function MultipleChoiceBlockPreview({
  block,
}: MultipleChoiceBlockPreviewProps) {
  return (
    <div className="w-full space-y-2 mt-2">
      {block.options.map((opt) => (
        <label
          key={opt.id}
          className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/30 cursor-pointer"
        >
          <input
            type="checkbox"
            disabled
            className="h-4 w-4 rounded text-indigo-600 border-gray-300 dark:border-gray-600"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {opt.label}
          </span>
        </label>
      ))}

      {block.allowOther && (
        <label className="flex items-center gap-3 p-2.5 rounded-lg border border-dashed border-gray-200 dark:border-gray-800 bg-transparent cursor-pointer">
          <input
            type="checkbox"
            disabled
            className="h-4 w-4 rounded text-indigo-600 border-gray-300 dark:border-gray-600"
          />
          <span className="text-sm text-gray-400 dark:text-gray-500 italic">
            Other (please specify)...
          </span>
        </label>
      )}

      {(block.minSelections !== undefined || block.maxSelections !== undefined) && (
        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          {block.minSelections !== undefined && (
            <span>Min selections: {block.minSelections}</span>
          )}
          {block.maxSelections !== undefined && (
            <span>Max selections: {block.maxSelections}</span>
          )}
        </div>
      )}
    </div>
  );
}
