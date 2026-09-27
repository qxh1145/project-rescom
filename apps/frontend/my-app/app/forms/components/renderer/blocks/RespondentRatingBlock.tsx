"use client";

import React, { useState } from "react";
import type { RatingBlock } from "@rescom/schemas";

interface RespondentRatingBlockProps {
  block: RatingBlock;
  value: number;
  onChange: (val: number) => void;
  error?: string;
  disabled?: boolean;
}

export function RespondentRatingBlock({
  block,
  value,
  onChange,
  error,
  disabled,
}: RespondentRatingBlockProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = block.maxRating || 5;
  const ratingShape = block.ratingShape || "STAR";

  const ratingItems = Array.from({ length: max }, (_, idx) => idx + 1);

  function handleClick(rating: number) {
    if (disabled) return;
    onChange(rating);
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        {ratingItems.map((rating) => {
          const isActive = hovered !== null ? rating <= hovered : rating <= (value || 0);

          if (ratingShape === "NUMBER") {
            return (
              <button
                key={rating}
                type="button"
                disabled={disabled}
                onMouseEnter={() => !disabled && setHovered(rating)}
                onMouseLeave={() => !disabled && setHovered(null)}
                onClick={() => handleClick(rating)}
                className={`w-10 h-10 rounded-xl font-semibold text-sm transition-all ${
                  isActive
                    ? "bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-500/20"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
              >
                {rating}
              </button>
            );
          }

          if (ratingShape === "HEART") {
            return (
              <button
                key={rating}
                type="button"
                disabled={disabled}
                onMouseEnter={() => !disabled && setHovered(rating)}
                onMouseLeave={() => !disabled && setHovered(null)}
                onClick={() => handleClick(rating)}
                className={`p-1.5 transition-transform hover:scale-110 ${
                  disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                }`}
              >
                <svg
                  className={`w-7 h-7 transition-colors ${
                    isActive
                      ? "text-rose-500 fill-rose-500"
                      : "text-gray-300 dark:text-gray-700 fill-none"
                  }`}
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                  />
                </svg>
              </button>
            );
          }

          // Default: STAR
          return (
            <button
              key={rating}
              type="button"
              disabled={disabled}
              onMouseEnter={() => !disabled && setHovered(rating)}
              onMouseLeave={() => !disabled && setHovered(null)}
              onClick={() => handleClick(rating)}
              className={`p-1.5 transition-transform hover:scale-110 ${
                disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <svg
                className={`w-7 h-7 transition-colors ${
                  isActive
                    ? "text-amber-400 fill-amber-400"
                    : "text-gray-300 dark:text-gray-700 fill-none"
                }`}
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            </button>
          );
        })}

        {value > 0 && (
          <span className="ml-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
            {value} / {max}
          </span>
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
