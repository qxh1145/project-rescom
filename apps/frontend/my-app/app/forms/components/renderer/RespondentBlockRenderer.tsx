"use client";

import React from "react";
import type { FormBlock, FormBlockType } from "@rescom/schemas";
import { RespondentTextBlock } from "./blocks/RespondentTextBlock";
import { RespondentTextareaBlock } from "./blocks/RespondentTextareaBlock";
import { RespondentNumberBlock } from "./blocks/RespondentNumberBlock";
import { RespondentSingleChoiceBlock } from "./blocks/RespondentSingleChoiceBlock";
import { RespondentMultipleChoiceBlock } from "./blocks/RespondentMultipleChoiceBlock";
import { RespondentRatingBlock } from "./blocks/RespondentRatingBlock";
import { RespondentLinearScaleBlock } from "./blocks/RespondentLinearScaleBlock";
import { RespondentDateBlock } from "./blocks/RespondentDateBlock";
import { RespondentFileUploadBlock } from "./blocks/RespondentFileUploadBlock";

interface RespondentBlockRendererProps {
  block: FormBlock;
  index: number;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  disabled?: boolean;
  attemptId?: string;
}

interface RespondentInputProps {
  block: FormBlock;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  disabled?: boolean;
  attemptId?: string;
}

export const RESPONDENT_REGISTRY: Record<
  FormBlockType,
  React.ComponentType<RespondentInputProps>
> = {
  text: RespondentTextBlock as unknown as React.ComponentType<RespondentInputProps>,
  textarea: RespondentTextareaBlock as unknown as React.ComponentType<RespondentInputProps>,
  number: RespondentNumberBlock as unknown as React.ComponentType<RespondentInputProps>,
  single_choice:
    RespondentSingleChoiceBlock as unknown as React.ComponentType<RespondentInputProps>,
  multiple_choice:
    RespondentMultipleChoiceBlock as unknown as React.ComponentType<RespondentInputProps>,
  rating: RespondentRatingBlock as unknown as React.ComponentType<RespondentInputProps>,
  linear_scale:
    RespondentLinearScaleBlock as unknown as React.ComponentType<RespondentInputProps>,
  date: RespondentDateBlock as unknown as React.ComponentType<RespondentInputProps>,
  file_upload:
    RespondentFileUploadBlock as unknown as React.ComponentType<RespondentInputProps>,
};

export function RespondentBlockRenderer({
  block,
  index,
  value,
  onChange,
  error,
  disabled,
  attemptId,
}: RespondentBlockRendererProps) {
  const Component = RESPONDENT_REGISTRY[block.type];

  return (
    <div
      id={`question-${block.id}`}
      className={`rounded-2xl border p-6 transition-all duration-150 bg-white dark:bg-gray-900 shadow-sm ${
        error
          ? "border-red-300 dark:border-red-800 ring-1 ring-red-400/20"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      {/* Question Header */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
            {index + 1}.
          </span>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {block.title || "Untitled Question"}
            {block.required && (
              <span className="ml-1 text-rose-500 font-bold" title="Required">
                *
              </span>
            )}
          </h3>
        </div>

        {block.description && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ml-5 leading-relaxed">
            {block.description}
          </p>
        )}
      </div>

      {/* Interactive Input Block */}
      <div className="ml-0 sm:ml-5">
        {Component ? (
          <Component
            block={block}
            value={value}
            onChange={onChange}
            error={error}
            disabled={disabled}
            attemptId={attemptId}
          />
        ) : (
          <div className="text-xs text-gray-400 italic">
            Unsupported question type: {block.type}
          </div>
        )}
      </div>
    </div>
  );
}
