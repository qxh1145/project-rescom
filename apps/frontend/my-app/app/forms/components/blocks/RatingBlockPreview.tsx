"use client";

import type { RatingBlock } from "@rescom/schemas";

interface RatingBlockPreviewProps {
  block: RatingBlock;
}

export function RatingBlockPreview({ block }: RatingBlockPreviewProps) {
  const count = block.maxRating || 5;
  const items = Array.from({ length: count }, (_, i) => i + 1);

  return (
    <div className="w-full mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        {items.map((num) => (
          <button
            key={num}
            type="button"
            disabled
            className={`flex items-center justify-center transition-all ${
              block.ratingShape === "NUMBER"
                ? "w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-300"
                : "w-8 h-8 text-amber-400 hover:text-amber-500"
            }`}
          >
            {block.ratingShape === "STAR" && (
              <svg
                className="w-7 h-7 fill-amber-400 stroke-amber-400"
                viewBox="0 0 24 24"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            )}
            {block.ratingShape === "HEART" && (
              <svg
                className="w-7 h-7 fill-rose-400 stroke-rose-400"
                viewBox="0 0 24 24"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            )}
            {block.ratingShape === "NUMBER" && <span>{num}</span>}
          </button>
        ))}
      </div>
      <div className="mt-2 text-xs text-gray-400 dark:text-gray-500">
        Scale: 1 to {count} ({block.ratingShape.toLowerCase()})
      </div>
    </div>
  );
}
