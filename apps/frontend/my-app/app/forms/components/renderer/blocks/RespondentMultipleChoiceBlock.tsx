"use client";

import React, { useState } from "react";
import type { MultipleChoiceBlock } from "@rescom/schemas";

interface RespondentMultipleChoiceBlockProps {
  block: MultipleChoiceBlock;
  value: string[];
  onChange: (val: string[]) => void;
  error?: string;
  disabled?: boolean;
}

export function RespondentMultipleChoiceBlock({
  block,
  value,
  onChange,
  error,
  disabled,
}: RespondentMultipleChoiceBlockProps) {
  const currentSelection: string[] = Array.isArray(value) ? value : [];

  const knownValues = new Set(block.options.map((opt) => opt.value));
  const customValues = currentSelection.filter((v) => !knownValues.has(v));
  const hasCustom = customValues.length > 0;
  const [otherText, setOtherText] = useState(hasCustom ? customValues[0] : "");
  const [showOtherInput, setShowOtherInput] = useState(hasCustom);

  function toggleOption(optVal: string) {
    if (disabled) return;
    if (currentSelection.includes(optVal)) {
      onChange(currentSelection.filter((v) => v !== optVal));
    } else {
      if (
        block.maxSelections !== undefined &&
        currentSelection.length >= block.maxSelections
      ) {
        return;
      }
      onChange([...currentSelection, optVal]);
    }
  }

  function handleToggleOther() {
    if (disabled) return;
    if (showOtherInput) {
      // Uncheck other
      setShowOtherInput(false);
      onChange(currentSelection.filter((v) => knownValues.has(v)));
    } else {
      setShowOtherInput(true);
      if (otherText.trim()) {
        onChange([...currentSelection, otherText.trim()]);
      }
    }
  }

  function handleOtherTextChange(text: string) {
    setOtherText(text);
    const withoutCustom = currentSelection.filter((v) => knownValues.has(v));
    if (text.trim()) {
      onChange([...withoutCustom, text.trim()]);
    } else {
      onChange(withoutCustom);
    }
  }

  return (
    <div className="w-full space-y-2.5">
      {block.options.map((option) => {
        const isChecked = currentSelection.includes(option.value);
        return (
          <label
            key={option.id}
            onClick={() => toggleOption(option.value)}
            className={`flex items-center gap-3.5 p-3.5 rounded-xl border cursor-pointer transition-all ${
              isChecked
                ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-1 ring-indigo-500 text-indigo-900 dark:text-indigo-200"
                : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-700 dark:text-gray-300"
            } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              disabled={disabled}
              onChange={() => toggleOption(option.value)}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
            />
            <span className="text-sm font-medium">{option.label}</span>
          </label>
        );
      })}

      {block.allowOther && (
        <div
          onClick={handleToggleOther}
          className={`flex flex-col gap-2 p-3.5 rounded-xl border cursor-pointer transition-all ${
            showOtherInput
              ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-1 ring-indigo-500"
              : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 bg-white dark:bg-gray-800/60"
          } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          <label className="flex items-center gap-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showOtherInput}
              disabled={disabled}
              onChange={handleToggleOther}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Other...
            </span>
          </label>

          {showOtherInput && (
            <input
              type="text"
              disabled={disabled}
              value={otherText}
              onChange={(e) => handleOtherTextChange(e.target.value)}
              placeholder="Please specify..."
              className="mt-1 w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 px-1">
        {error ? (
          <span className="text-red-500 dark:text-red-400 font-medium">{error}</span>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {block.minSelections && <span>Min: {block.minSelections}</span>}
          {block.maxSelections && <span>Max: {block.maxSelections}</span>}
        </div>
      </div>
    </div>
  );
}
