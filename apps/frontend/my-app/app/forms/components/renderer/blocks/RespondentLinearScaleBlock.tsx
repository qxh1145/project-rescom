"use client";

import React from "react";
import type { LinearScaleBlock } from "@rescom/schemas";

interface RespondentLinearScaleBlockProps {
  block: LinearScaleBlock;
  value: number;
  onChange: (val: number) => void;
  error?: string;
  disabled?: boolean;
}

export function RespondentLinearScaleBlock({
  block,
  value,
  onChange,
  error,
  disabled,
}: RespondentLinearScaleBlockProps) {
  const min = block.min ?? 1;
  const max = block.max ?? 5;
  const step = block.step || 1;

  const points: number[] = [];
  for (let i = min; i <= max; i += step) {
    points.push(i);
  }

  return (
    <div className="w-full">
      <div className="flex flex-col gap-3">
        {/* Scale Numbers and Radio Options */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto py-2">
          {points.map((point) => {
            const isSelected = value === point;
            return (
              <button
                key={point}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onChange(point)}
                className={`flex-1 min-w-[36px] py-3 rounded-xl flex flex-col items-center gap-1.5 transition-all ${
                  isSelected
                    ? "bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-500/20 font-bold"
                    : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/80 font-medium"
                } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <span className="text-xs">{point}</span>
                <span
                  className={`w-2.5 h-2.5 rounded-full border ${
                    isSelected
                      ? "bg-white border-white"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Min and Max boundary labels */}
        {(block.minLabel || block.maxLabel) && (
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 px-1">
            <span>{block.minLabel || `${min}`}</span>
            <span>{block.maxLabel || `${max}`}</span>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 font-medium mt-1.5 px-1">
          {error}
        </p>
      )}
    </div>
  );
}
