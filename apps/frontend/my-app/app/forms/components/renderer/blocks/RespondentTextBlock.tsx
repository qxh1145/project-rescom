"use client";

import React from "react";
import type { TextBlock } from "@rescom/schemas";

interface RespondentTextBlockProps {
  block: TextBlock;
  value: string;
  onChange: (val: string) => void;
  error?: string;
  disabled?: boolean;
}

export function RespondentTextBlock({
  block,
  value,
  onChange,
  error,
  disabled,
}: RespondentTextBlockProps) {
  const currentLength = (value || "").length;

  return (
    <div className="w-full">
      <input
        type="text"
        disabled={disabled}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={block.placeholder || "Your answer..."}
        className={`w-full px-4 py-3 rounded-xl border text-sm transition-all focus:outline-none focus:ring-2 ${
          error
            ? "border-red-400 dark:border-red-600 bg-red-50/20 focus:ring-red-400"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:border-indigo-500 focus:ring-indigo-500/20"
        } text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500`}
      />
      <div className="flex items-center justify-between mt-1.5 px-1 text-xs text-gray-400 dark:text-gray-500">
        {error ? (
          <span className="text-red-500 dark:text-red-400 font-medium">{error}</span>
        ) : (
          <span />
        )}
        {block.maxLength && (
          <span>
            {currentLength}/{block.maxLength}
          </span>
        )}
      </div>
    </div>
  );
}
