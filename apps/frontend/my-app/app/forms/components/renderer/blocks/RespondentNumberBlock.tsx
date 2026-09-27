"use client";

import React from "react";
import type { NumberBlock } from "@rescom/schemas";

interface RespondentNumberBlockProps {
  block: NumberBlock;
  value: number | string;
  onChange: (val: number | "") => void;
  error?: string;
  disabled?: boolean;
}

export function RespondentNumberBlock({
  block,
  value,
  onChange,
  error,
  disabled,
}: RespondentNumberBlockProps) {
  return (
    <div className="w-full">
      <input
        type="number"
        disabled={disabled}
        min={block.min}
        max={block.max}
        step={block.step || (block.integerOnly ? 1 : "any")}
        value={value === undefined || value === null ? "" : value}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val === "" ? "" : Number(val));
        }}
        placeholder={block.placeholder || "Enter a number..."}
        className={`w-full max-w-xs px-4 py-3 rounded-xl border text-sm transition-all focus:outline-none focus:ring-2 ${
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
        <div className="flex gap-2">
          {block.min !== undefined && <span>Min: {block.min}</span>}
          {block.max !== undefined && <span>Max: {block.max}</span>}
        </div>
      </div>
    </div>
  );
}
