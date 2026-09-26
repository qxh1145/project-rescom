"use client";

import type { LinearScaleBlock } from "@rescom/schemas";

interface LinearScaleBlockPreviewProps {
  block: LinearScaleBlock;
}

export function LinearScaleBlockPreview({ block }: LinearScaleBlockPreviewProps) {
  const min = block.min ?? 1;
  const max = block.max ?? 5;
  const step = block.step ?? 1;

  const points: number[] = [];
  for (let i = min; i <= max; i += step) {
    points.push(i);
  }

  return (
    <div className="w-full mt-2">
      <div className="flex items-center justify-between gap-3 overflow-x-auto py-2">
        {points.map((val) => (
          <div key={val} className="flex flex-col items-center gap-1.5 min-w-[36px]">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {val}
            </span>
            <div className="w-7 h-7 rounded-full border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 flex items-center justify-center cursor-pointer hover:border-indigo-500 transition-colors">
              <div className="w-2.5 h-2.5 rounded-full bg-transparent" />
            </div>
          </div>
        ))}
      </div>

      {(block.minLabel || block.maxLabel) && (
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mt-2 px-1">
          <span>{block.minLabel || `${min} (Min)`}</span>
          <span>{block.maxLabel || `${max} (Max)`}</span>
        </div>
      )}
    </div>
  );
}
