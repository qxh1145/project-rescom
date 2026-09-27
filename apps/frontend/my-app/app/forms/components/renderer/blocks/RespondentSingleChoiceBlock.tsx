"use client";

import React, { useState } from "react";
import type { SingleChoiceBlock } from "@rescom/schemas";

interface RespondentSingleChoiceBlockProps {
  block: SingleChoiceBlock;
  value: string;
  onChange: (val: string) => void;
  error?: string;
  disabled?: boolean;
}

export function RespondentSingleChoiceBlock({
  block,
  value,
  onChange,
  error,
  disabled,
}: RespondentSingleChoiceBlockProps) {
  const isCustomOption =
    Boolean(value) && !block.options.some((opt) => opt.value === value);
  const [otherText, setOtherText] = useState(isCustomOption ? value : "");
  const isOtherSelected = isCustomOption || (value === "__OTHER__");

  function handleSelectOption(optVal: string) {
    if (disabled) return;
    onChange(optVal);
  }

  function handleSelectOther() {
    if (disabled) return;
    onChange(otherText || "__OTHER__");
  }

  function handleOtherTextChange(text: string) {
    setOtherText(text);
    onChange(text);
  }

  return (
    <div className="w-full space-y-2.5">
      {block.options.map((option) => {
        const isChecked = value === option.value;
        return (
          <label
            key={option.id}
            onClick={() => handleSelectOption(option.value)}
            className={`flex items-center gap-3.5 p-3.5 rounded-xl border cursor-pointer transition-all ${
              isChecked
                ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-1 ring-indigo-500 text-indigo-900 dark:text-indigo-200"
                : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 bg-white dark:bg-gray-800/60 text-gray-700 dark:text-gray-300"
            } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <input
              type="radio"
              name={`radio-${block.id}`}
              checked={isChecked}
              disabled={disabled}
              onChange={() => handleSelectOption(option.value)}
              className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
            />
            <span className="text-sm font-medium">{option.label}</span>
          </label>
        );
      })}

      {block.allowOther && (
        <div
          onClick={handleSelectOther}
          className={`flex flex-col gap-2 p-3.5 rounded-xl border cursor-pointer transition-all ${
            isOtherSelected
              ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-1 ring-indigo-500"
              : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 bg-white dark:bg-gray-800/60"
          } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          <label className="flex items-center gap-3.5 cursor-pointer">
            <input
              type="radio"
              name={`radio-${block.id}`}
              checked={isOtherSelected}
              disabled={disabled}
              onChange={handleSelectOther}
              className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Other...
            </span>
          </label>

          {isOtherSelected && (
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

      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 font-medium px-1">
          {error}
        </p>
      )}
    </div>
  );
}
