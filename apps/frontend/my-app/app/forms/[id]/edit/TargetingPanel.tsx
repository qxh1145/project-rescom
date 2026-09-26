"use client";

import React, { useState, KeyboardEvent } from "react";
import type { SurveyTargetingCriteria, Gender } from "@rescom/schemas";
import { GENDER_OPTIONS } from "@rescom/schemas";

interface TargetingPanelProps {
  targeting: SurveyTargetingCriteria | null;
  onChange: (targeting: SurveyTargetingCriteria | null) => void;
  readOnly?: boolean;
  errors?: Record<string, string>;
}

interface TagInputProps {
  label: string;
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (index: number) => void;
  disabled?: boolean;
  placeholder?: string;
  maxTags?: number;
  error?: string;
}

function TagInput({
  label,
  tags,
  onAddTag,
  onRemoveTag,
  disabled,
  placeholder = "Type and press Enter...",
  maxTags = 50,
  error,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (trimmed && tags.length < maxTags) {
        onAddTag(trimmed);
        setInputValue("");
      }
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      onRemoveTag(tags.length - 1);
    }
  }

  function handleBlur() {
    const trimmed = inputValue.trim();
    if (trimmed && tags.length < maxTags) {
      onAddTag(trimmed);
      setInputValue("");
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <span className="text-[10px] text-gray-400">
          {tags.length}/{maxTags}
        </span>
      </div>

      <div
        className={`min-h-[42px] p-1.5 flex flex-wrap items-center gap-1.5 bg-gray-50 dark:bg-gray-800 border rounded-lg transition-colors ${
          error
            ? "border-red-500 dark:border-red-500 ring-1 ring-red-500/30"
            : "border-gray-200 dark:border-gray-700 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500"
        } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {tags.map((tag, idx) => (
          <span
            key={`${tag}-${idx}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
          >
            <span>{tag}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemoveTag(idx)}
                className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200 focus:outline-none"
                aria-label={`Remove ${tag}`}
              >
                &times;
              </button>
            )}
          </span>
        ))}

        {!disabled && tags.length < maxTags && (
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            disabled={disabled}
            placeholder={tags.length === 0 ? placeholder : "Add another..."}
            className="flex-1 min-w-[120px] bg-transparent text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none px-1 py-0.5"
          />
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}

export function TargetingPanel({
  targeting,
  onChange,
  readOnly = false,
  errors = {},
}: TargetingPanelProps) {
  // Safe extraction of current values
  const ageMin = targeting?.ageRange?.min ?? "";
  const ageMax = targeting?.ageRange?.max ?? "";
  const hasAgeFilter = targeting?.ageRange !== undefined;
  const [ageMinDraft, setAgeMinDraft] = useState<string | null>(null);
  const [ageMaxDraft, setAgeMaxDraft] = useState<string | null>(null);
  const ageMinInput = ageMinDraft ?? String(ageMin);
  const ageMaxInput = ageMaxDraft ?? String(ageMax);

  const locations = targeting?.locations ?? [];
  const genders: Gender[] = targeting?.genders ?? [];
  const occupations = targeting?.occupations ?? [];
  const fieldOfStudy = targeting?.fieldOfStudy ?? [];

  // Helper to commit updates, preserving empty as null if all dimensions cleared
  function commitUpdates(updated: Partial<SurveyTargetingCriteria>) {
    const next: SurveyTargetingCriteria = {
      ...(targeting ?? {}),
      ...updated,
    };

    // Clean up empty fields
    if (next.locations && next.locations.length === 0) delete next.locations;
    if (next.genders && next.genders.length === 0) delete next.genders;
    if (next.occupations && next.occupations.length === 0) delete next.occupations;
    if (next.fieldOfStudy && next.fieldOfStudy.length === 0) delete next.fieldOfStudy;
    if (next.ageRange === undefined) delete next.ageRange;

    // Check if any targeting criteria remains
    const hasAnyCriteria =
      Boolean(next.ageRange) ||
      (next.locations && next.locations.length > 0) ||
      (next.genders && next.genders.length > 0) ||
      (next.occupations && next.occupations.length > 0) ||
      (next.fieldOfStudy && next.fieldOfStudy.length > 0);

    onChange(hasAnyCriteria ? next : null);
  }

  // Age range handlers
  function handleToggleAgeFilter(enabled: boolean) {
    if (readOnly) return;
    setAgeMinDraft(null);
    setAgeMaxDraft(null);
    if (enabled) {
      commitUpdates({ ageRange: { min: 18, max: 65 } });
    } else {
      const copy = { ...(targeting ?? {}) };
      delete copy.ageRange;
      const hasAny =
        (copy.locations && copy.locations.length > 0) ||
        (copy.genders && copy.genders.length > 0) ||
        (copy.occupations && copy.occupations.length > 0) ||
        (copy.fieldOfStudy && copy.fieldOfStudy.length > 0);
      onChange(hasAny ? copy : null);
    }
  }

  function handleAgeMinChange(val: string) {
    if (readOnly) return;
    if (val === "") {
      setAgeMinDraft("");
      return;
    }
    const num = Number(val);
    if (!Number.isFinite(num)) return;
    setAgeMinDraft(null);
    const curMax = typeof ageMax === "number" ? ageMax : 65;
    commitUpdates({ ageRange: { min: num, max: curMax } });
  }

  function handleAgeMaxChange(val: string) {
    if (readOnly) return;
    if (val === "") {
      setAgeMaxDraft("");
      return;
    }
    const num = Number(val);
    if (!Number.isFinite(num)) return;
    setAgeMaxDraft(null);
    const curMin = typeof ageMin === "number" ? ageMin : 18;
    commitUpdates({ ageRange: { min: curMin, max: num } });
  }

  // Location handlers
  function handleAddLocation(loc: string) {
    if (readOnly || !loc || locations.includes(loc)) return;
    commitUpdates({ locations: [...locations, loc] });
  }

  function handleRemoveLocation(idx: number) {
    if (readOnly) return;
    commitUpdates({ locations: locations.filter((_, i) => i !== idx) });
  }

  // Gender checkbox toggle
  function handleToggleGender(gender: Gender) {
    if (readOnly) return;
    let nextGenders: Gender[];
    if (genders.includes(gender)) {
      nextGenders = genders.filter((g) => g !== gender);
    } else {
      nextGenders = [...genders, gender];
    }
    commitUpdates({ genders: nextGenders.length > 0 ? nextGenders : undefined });
  }

  // Occupation handlers
  function handleAddOccupation(occ: string) {
    if (readOnly || !occ || occupations.includes(occ)) return;
    commitUpdates({ occupations: [...occupations, occ] });
  }

  function handleRemoveOccupation(idx: number) {
    if (readOnly) return;
    commitUpdates({ occupations: occupations.filter((_, i) => i !== idx) });
  }

  // Field of Study handlers
  function handleAddFieldOfStudy(field: string) {
    if (readOnly || !field || fieldOfStudy.includes(field)) return;
    commitUpdates({ fieldOfStudy: [...fieldOfStudy, field] });
  }

  function handleRemoveFieldOfStudy(idx: number) {
    if (readOnly) return;
    commitUpdates({ fieldOfStudy: fieldOfStudy.filter((_, i) => i !== idx) });
  }

  function handleClearAll() {
    if (readOnly) return;
    onChange(null);
  }

  // Local age range validation check
  const ageRangeValidationError =
    errors.ageRange ||
    (hasAgeFilter && typeof ageMin === "number" && typeof ageMax === "number" && ageMin > ageMax
      ? "Minimum age cannot be greater than maximum age"
      : undefined);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Marketplace Audience Targeting
          </h4>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Only respondents matching all criteria will see this survey in the feed.
          </p>
        </div>

        {!readOnly && targeting && (
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 underline"
          >
            Clear all targeting
          </button>
        )}
      </div>

      {/* 1. Age Range */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Age Range
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={hasAgeFilter}
              onChange={(e) => handleToggleAgeFilter(e.target.checked)}
              disabled={readOnly}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Enable age restriction</span>
          </label>
        </div>

        {hasAgeFilter ? (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] text-gray-400 block mb-1">Min Age (13–100)</span>
                <input
                  type="number"
                  min={13}
                  max={100}
                  step={1}
                  value={ageMinInput}
                  onChange={(e) => handleAgeMinChange(e.target.value)}
                  onBlur={() => {
                    if (ageMinDraft === "") setAgeMinDraft(null);
                  }}
                  disabled={readOnly}
                  className={`w-full px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border rounded-lg text-gray-900 dark:text-white ${
                    ageRangeValidationError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                      : "border-gray-200 dark:border-gray-700 focus:border-indigo-500"
                  } disabled:opacity-60`}
                />
              </div>
              <div>
                <span className="text-[11px] text-gray-400 block mb-1">Max Age (13–100)</span>
                <input
                  type="number"
                  min={13}
                  max={100}
                  step={1}
                  value={ageMaxInput}
                  onChange={(e) => handleAgeMaxChange(e.target.value)}
                  onBlur={() => {
                    if (ageMaxDraft === "") setAgeMaxDraft(null);
                  }}
                  disabled={readOnly}
                  className={`w-full px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border rounded-lg text-gray-900 dark:text-white ${
                    ageRangeValidationError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                      : "border-gray-200 dark:border-gray-700 focus:border-indigo-500"
                  } disabled:opacity-60`}
                />
              </div>
            </div>
            {ageRangeValidationError && (
              <p className="text-xs text-red-600 dark:text-red-400">{ageRangeValidationError}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No age restriction (any age 13+ eligible)</p>
        )}
      </div>

      {/* 2. Gender Checkboxes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Gender
          </label>
          <span className="text-[10px] text-gray-400">
            {genders.length === 0 ? "All Genders" : `${genders.length} selected`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {GENDER_OPTIONS.map((option) => {
            const isChecked = genders.includes(option.value);
            return (
              <label
                key={option.value}
                className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                  isChecked
                    ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200"
                    : "bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                } ${readOnly ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggleGender(option.value)}
                  disabled={readOnly}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
        {errors.genders && (
          <p className="text-xs text-red-600 dark:text-red-400">{errors.genders}</p>
        )}
      </div>

      {/* 3. Locations */}
      <TagInput
        label="Geographic Locations (Cities/Provinces)"
        tags={locations}
        onAddTag={handleAddLocation}
        onRemoveTag={handleRemoveLocation}
        disabled={readOnly}
        placeholder="e.g. Hanoi, Ho Chi Minh City, Da Nang..."
        maxTags={50}
        error={errors.locations}
      />

      {/* 4. Occupations */}
      <TagInput
        label="Target Occupations"
        tags={occupations}
        onAddTag={handleAddOccupation}
        onRemoveTag={handleRemoveOccupation}
        disabled={readOnly}
        placeholder="e.g. Student, Software Engineer, Nurse..."
        maxTags={50}
        error={errors.occupations}
      />

      {/* 5. Field of Study */}
      <TagInput
        label="Target Field of Study"
        tags={fieldOfStudy}
        onAddTag={handleAddFieldOfStudy}
        onRemoveTag={handleRemoveFieldOfStudy}
        disabled={readOnly}
        placeholder="e.g. Computer Science, Economics, Medicine..."
        maxTags={50}
        error={errors.fieldOfStudy}
      />
    </div>
  );
}
