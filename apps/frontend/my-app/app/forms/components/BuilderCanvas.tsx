"use client";

import React, { useState } from "react";
import type { FormBlock, FormBlockType } from "@rescom/schemas";
import { QuestionBlockRenderer } from "./QuestionBlockRenderer";
import { resolveCanvasDrop } from "./drag-drop.mjs";

export interface BuilderCanvasProps {
  blocks: FormBlock[];
  onAddBlockAtIndex: (type: FormBlockType, index: number) => void;
  onUpdateBlock: (index: number, updated: FormBlock) => void;
  onDeleteBlock: (index: number) => void;
  onDuplicateBlock?: (index: number) => void;
  onMoveUpBlock?: (index: number) => void;
  onMoveDownBlock?: (index: number) => void;
  onReorderBlock?: (fromIndex: number, toIndex: number) => void;
  selectedIndex?: number | null;
  onSelectBlock?: (index: number) => void;
  onOpenSettings?: (index: number) => void;
  readOnly?: boolean;
}

export function BuilderCanvas({
  blocks,
  onAddBlockAtIndex,
  onUpdateBlock,
  onDeleteBlock,
  onDuplicateBlock,
  onMoveUpBlock,
  onMoveDownBlock,
  onReorderBlock,
  selectedIndex,
  onSelectBlock,
  onOpenSettings,
  readOnly = false,
}: BuilderCanvasProps) {
  const [activeDropIndex, setActiveDropIndex] = useState<number | null>(null);
  const [isOverCanvas, setIsOverCanvas] = useState<boolean>(false);

  function handleDragOver(e: React.DragEvent, index?: number) {
    if (readOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (index !== undefined) {
      setActiveDropIndex(index);
    }
  }

  function handleDrop(e: React.DragEvent, targetIndex: number) {
    if (readOnly) return;
    e.preventDefault();
    const reorderFromStr = e.dataTransfer.getData(
      "application/rescom-reorder-index",
    );

    const type = e.dataTransfer.getData(
      "application/rescom-block-type",
    ) as FormBlockType;
    const action = resolveCanvasDrop(
      blocks.length,
      targetIndex,
      reorderFromStr,
      type,
    );
    if (
      action.kind === "reorder" &&
      typeof action.fromIndex === "number" &&
      typeof action.toIndex === "number" &&
      onReorderBlock
    ) {
      onReorderBlock(action.fromIndex, action.toIndex);
    } else if (
      action.kind === "insert" &&
      typeof action.blockType === "string" &&
      typeof action.index === "number"
    ) {
      onAddBlockAtIndex(action.blockType as FormBlockType, action.index);
    }

    setActiveDropIndex(null);
    setIsOverCanvas(false);
  }

  return (
    <div
      onDragEnter={() => setIsOverCanvas(true)}
      onDragLeave={(e) => {
        // Only clear if leaving the canvas container itself
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsOverCanvas(false);
          setActiveDropIndex(null);
        }
      }}
      className="w-full space-y-4"
    >
      {/* Empty State */}
      {blocks.length === 0 ? (
        <div
          onDragOver={(e) => handleDragOver(e, 0)}
          onDrop={(e) => handleDrop(e, 0)}
          className={`p-12 text-center rounded-2xl border-2 border-dashed transition-all duration-200 ${
            isOverCanvas || activeDropIndex === 0
              ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/40 scale-[1.01]"
              : "border-gray-300 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50"
          }`}
        >
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Your survey canvas is empty
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
            {readOnly
              ? "This survey has no questions defined."
              : "Drag question blocks from the toolbox on the left, or click any block type in the toolbox to add your first question."}
          </p>

          {!readOnly && (
            <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">Quick add:</span>
              <button
                type="button"
                onClick={() => onAddBlockAtIndex("text", 0)}
                className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 text-xs font-medium text-gray-700 dark:text-gray-300 rounded-lg shadow-2xs"
              >
                + Short Text
              </button>
              <button
                type="button"
                onClick={() => onAddBlockAtIndex("single_choice", 0)}
                className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 text-xs font-medium text-gray-700 dark:text-gray-300 rounded-lg shadow-2xs"
              >
                + Choice
              </button>
              <button
                type="button"
                onClick={() => onAddBlockAtIndex("rating", 0)}
                className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 text-xs font-medium text-gray-700 dark:text-gray-300 rounded-lg shadow-2xs"
              >
                + Rating
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {blocks.map((block, idx) => (
            <React.Fragment key={block.id}>
              {/* Drop Target Indicator Above Each Block */}
              {!readOnly && (
                <div
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragLeave={() => {
                    if (activeDropIndex === idx) setActiveDropIndex(null);
                  }}
                  onDrop={(e) => handleDrop(e, idx)}
                  className={`transition-all duration-150 rounded-lg ${
                    activeDropIndex === idx
                      ? "h-10 bg-indigo-100/70 dark:bg-indigo-950/60 border-2 border-dashed border-indigo-500 flex items-center justify-center text-xs font-semibold text-indigo-600"
                      : "h-2 hover:h-4 bg-transparent"
                  }`}
                >
                  {activeDropIndex === idx && "Drop question here"}
                </div>
              )}

              {/* Rendered Block Card */}
              <QuestionBlockRenderer
                block={block}
                index={idx}
                totalBlocks={blocks.length}
                isSelected={selectedIndex === idx}
                onSelect={() => onSelectBlock && onSelectBlock(idx)}
                onOpenSettings={() => onOpenSettings && onOpenSettings(idx)}
                onDelete={() => onDeleteBlock(idx)}
                onDuplicate={() => onDuplicateBlock && onDuplicateBlock(idx)}
                onMoveUp={() => onMoveUpBlock && onMoveUpBlock(idx)}
                onMoveDown={() => onMoveDownBlock && onMoveDownBlock(idx)}
                onUpdate={(updated) => onUpdateBlock(idx, updated)}
                readOnly={readOnly}
              />
            </React.Fragment>
          ))}

          {/* Drop Target Indicator Below the Last Block */}
          {!readOnly && (
            <div
              onDragOver={(e) => handleDragOver(e, blocks.length)}
              onDragLeave={() => {
                if (activeDropIndex === blocks.length) setActiveDropIndex(null);
              }}
              onDrop={(e) => handleDrop(e, blocks.length)}
              className={`transition-all duration-150 rounded-xl border-2 border-dashed flex items-center justify-center text-xs font-medium ${
                activeDropIndex === blocks.length
                  ? "h-16 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 text-indigo-600 font-semibold"
                  : "h-14 border-gray-200 dark:border-gray-800 bg-white/40 dark:bg-gray-900/40 text-gray-400 hover:border-gray-300 hover:text-gray-500"
              }`}
            >
              {activeDropIndex === blocks.length
                ? "Release to drop at end of survey"
                : "+ Drag question here to append"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
