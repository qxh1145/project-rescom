"use client";

import type { DateBlock } from "@rescom/schemas";

interface DateBlockPreviewProps {
  block: DateBlock;
}

export function DateBlockPreview({ block }: DateBlockPreviewProps) {
  return (
    <div className="w-full mt-2">
      <div className="flex items-center gap-3">
        <div className="relative max-w-xs w-full">
          <input
            type="text"
            disabled
            readOnly
            placeholder={block.includeTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD"}
            className="w-full pl-9 pr-3.5 py-2 text-sm bg-gray-50/70 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-400 placeholder:text-gray-400 dark:placeholder:text-gray-500 cursor-not-allowed"
          />
          <div className="absolute left-3 top-2.5 text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2" />
              <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" />
              <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" />
              <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" />
            </svg>
          </div>
        </div>
        {block.includeTime && (
          <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded font-medium">
            Time included
          </span>
        )}
      </div>

      {(block.minDate || block.maxDate) && (
        <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
          {block.minDate && <span>Earliest: {block.minDate}</span>}
          {block.maxDate && <span>Latest: {block.maxDate}</span>}
        </div>
      )}
    </div>
  );
}
