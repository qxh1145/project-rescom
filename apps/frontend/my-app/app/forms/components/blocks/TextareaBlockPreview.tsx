"use client";

import type { TextareaBlock } from "@rescom/schemas";

interface TextareaBlockPreviewProps {
  block: TextareaBlock;
}

export function TextareaBlockPreview({ block }: TextareaBlockPreviewProps) {
  return (
    <div className="w-full">
      <div className="mt-2">
        <textarea
          rows={3}
          disabled
          readOnly
          placeholder={block.placeholder || "Enter detailed response..."}
          className="w-full px-3.5 py-2 text-sm bg-gray-50/70 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-400 placeholder:text-gray-400 dark:placeholder:text-gray-500 cursor-not-allowed resize-none"
        />
      </div>
      {(block.minLength !== undefined || block.maxLength !== undefined) && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          {block.minLength !== undefined && <span>Min: {block.minLength} chars</span>}
          {block.maxLength !== undefined && <span>Max: {block.maxLength} chars</span>}
        </div>
      )}
    </div>
  );
}
