"use client";

import React from "react";
import type { DateBlock } from "@rescom/schemas";

interface RespondentDateBlockProps {
  block: DateBlock;
  value: string;
  onChange: (val: string) => void;
  error?: string;
  disabled?: boolean;
}

export function RespondentDateBlock({
  block,
  value,
  onChange,
  error,
  disabled,
}: RespondentDateBlockProps) {
  return (
    <div className="w-full">
      <div className="relative max-w-xs">
        <input
          type={block.includeTime ? "datetime-local" : "date"}
          disabled={disabled}
          min={block.minDate}
          max={block.maxDate}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-4 py-3 rounded-xl border text-sm transition-all focus:outline-none focus:ring-2 ${
            error
              ? "border-red-400 dark:border-red-600 bg-red-50/20 focus:ring-red-400"
              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:border-indigo-500 focus:ring-indigo-500/20"
          } text-gray-900 dark:text-white`}
        />
      </div>

      <div className="flex items-center justify-between mt-1.5 px-1 text-xs text-gray-400 dark:text-gray-500">
        {error ? (
          <span className="text-red-500 dark:text-red-400 font-medium">{error}</span>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {block.minDate && <span>From: {block.minDate}</span>}
          {block.maxDate && <span>To: {block.maxDate}</span>}
        </div>
      </div>
    </div>
  );
}
