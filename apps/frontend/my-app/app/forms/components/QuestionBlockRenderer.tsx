"use client";

import React from "react";
import type { FormBlock, FormBlockType } from "@rescom/schemas";
import { BLOCK_METADATA_MAP } from "./block-definitions";
import { TextBlockPreview } from "./blocks/TextBlockPreview";
import { TextareaBlockPreview } from "./blocks/TextareaBlockPreview";
import { NumberBlockPreview } from "./blocks/NumberBlockPreview";
import { SingleChoiceBlockPreview } from "./blocks/SingleChoiceBlockPreview";
import { MultipleChoiceBlockPreview } from "./blocks/MultipleChoiceBlockPreview";
import { RatingBlockPreview } from "./blocks/RatingBlockPreview";
import { LinearScaleBlockPreview } from "./blocks/LinearScaleBlockPreview";
import { DateBlockPreview } from "./blocks/DateBlockPreview";
import { FileUploadBlockPreview } from "./blocks/FileUploadBlockPreview";

export interface QuestionBlockRendererProps {
  block: FormBlock;
  index: number;
  totalBlocks?: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onOpenSettings?: () => void;
  onUpdate?: (updated: FormBlock) => void;
  readOnly?: boolean;
}

export const QUESTION_REGISTRY: Record<
  FormBlockType,
  React.ComponentType<{ block: FormBlock }>
> = {
  text: TextBlockPreview as React.ComponentType<{ block: FormBlock }>,
  textarea: TextareaBlockPreview as React.ComponentType<{ block: FormBlock }>,
  number: NumberBlockPreview as React.ComponentType<{ block: FormBlock }>,
  single_choice: SingleChoiceBlockPreview as React.ComponentType<{ block: FormBlock }>,
  multiple_choice: MultipleChoiceBlockPreview as React.ComponentType<{ block: FormBlock }>,
  rating: RatingBlockPreview as React.ComponentType<{ block: FormBlock }>,
  linear_scale: LinearScaleBlockPreview as React.ComponentType<{ block: FormBlock }>,
  date: DateBlockPreview as React.ComponentType<{ block: FormBlock }>,
  file_upload: FileUploadBlockPreview as React.ComponentType<{ block: FormBlock }>,
};

export function QuestionBlockRenderer({
  block,
  index,
  totalBlocks,
  isSelected,
  onSelect,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onOpenSettings,
  onUpdate,
  readOnly = false,
}: QuestionBlockRendererProps) {
  const meta = BLOCK_METADATA_MAP[block.type] || {
    label: block.type,
    category: "input",
  };

  const Component = QUESTION_REGISTRY[block.type];

  return (
    <div
      onClick={readOnly ? undefined : onSelect}
      className={`group relative rounded-2xl border transition-all duration-150 p-6 bg-white dark:bg-gray-900 shadow-sm ${
        readOnly ? "cursor-default" : "cursor-pointer"
      } ${
        isSelected && !readOnly
          ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-md"
          : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
      }`}
    >
      {/* Top Header Bar with Drag Handle, Order, Type Badge, Reorder Buttons & Action Controls */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 flex items-start gap-3">
          {/* Reorder Drag Handle */}
          {!readOnly && (
            <div
              draggable={true}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData(
                  "application/rescom-reorder-index",
                  index.toString(),
                );
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={(e) => e.stopPropagation()}
              title="Drag to reorder question"
              className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors mt-0.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" />
              </svg>
            </div>
          )}

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="flex items-center justify-center text-xs font-bold w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                {index + 1}
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                {meta.label}
              </span>
              {block.required && (
                <span className="text-[11px] font-medium text-rose-500 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded">
                  Required
                </span>
              )}

              {/* Move Up / Move Down Arrow Buttons */}
              {!readOnly && (
                <div
                  className="flex items-center border border-gray-200 dark:border-gray-800 rounded-md overflow-hidden ml-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={onMoveUp}
                    title={index === 0 ? "Already at top" : "Move up"}
                    className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-20 disabled:hover:text-gray-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <div className="w-[1px] h-3 bg-gray-200 dark:bg-gray-800" />
                  <button
                    type="button"
                    disabled={totalBlocks !== undefined && index >= totalBlocks - 1}
                    onClick={onMoveDown}
                    title={
                      totalBlocks !== undefined && index >= totalBlocks - 1
                        ? "Already at bottom"
                        : "Move down"
                    }
                    className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-20 disabled:hover:text-gray-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Editable Question Title or Static View */}
            {readOnly ? (
              <h4 className="w-full text-base font-semibold text-gray-900 dark:text-white py-0.5">
                {block.title || "Untitled Question"}
              </h4>
            ) : (
              <input
                type="text"
                value={block.title}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  if (onUpdate) {
                    onUpdate({ ...block, title: e.target.value } as FormBlock);
                  }
                }}
                placeholder="Untitled Question..."
                className="w-full text-base font-semibold text-gray-900 dark:text-white bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-indigo-500 focus:outline-none transition-colors py-0.5"
              />
            )}

            {block.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {block.description}
              </p>
            )}
          </div>
        </div>

        {/* Quick Action Buttons (hidden in readOnly mode) */}
        {!readOnly && (
          <div
            className="flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Settings Trigger */}
            <button
              type="button"
              title="Edit block properties"
              onClick={onOpenSettings || onSelect}
              className={`p-1.5 rounded-lg transition-colors ${
                isSelected
                  ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400"
                  : "text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>

            {/* Duplicate Block */}
            {onDuplicate && (
              <button
                type="button"
                title="Duplicate block"
                onClick={onDuplicate}
                className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </button>
            )}

            {/* Toggle Required Button */}
            <button
              type="button"
              title="Toggle Required"
              onClick={() => {
                if (onUpdate) {
                  onUpdate({ ...block, required: !block.required } as FormBlock);
                }
              }}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                block.required
                  ? "bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-medium"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              {block.required ? "Required" : "Optional"}
            </button>

            {/* Delete Button */}
            {onDelete && (
              <button
                type="button"
                title="Delete question"
                onClick={onDelete}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Render the specialized preview component */}
      <div className="pt-2">
        {Component ? (
          <Component block={block} />
        ) : (
          <div className="text-xs text-gray-400 italic">Unknown block type</div>
        )}
      </div>
    </div>
  );
}
