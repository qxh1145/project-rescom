"use client";

import type { NumberBlock } from "@rescom/schemas";

interface NumberBlockPreviewProps {
  block: NumberBlock;
}

export function NumberBlockPreview({ block }: NumberBlockPreviewProps) {
  return (
    <div className="w-full">
      <div className="mt-2">
        <input
          type="number"
          disabled
          readOnly
          placeholder={block.placeholder || "0"}
          className="w-full max-w-xs px-3.5 py-2 text-sm bg-gray-50/70 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-400 placeholder:text-gray-400 dark:placeholder:text-gray-500 cursor-not-allowed"
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
        {block.min !== undefined && <span>Min: {block.min}</span>}
        {block.max !== undefined && <span>Max: {block.max}</span>}
        {block.step !== undefined && <span>Step: {block.step}</span>}
        {block.integerOnly && (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] font-mono">
            Integers only
          </span>
        )}
      </div>
    </div>
  );
}
