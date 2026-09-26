"use client";

import React from "react";
import type { SurveyTargetingCriteria } from "@rescom/schemas";
import { GENDER_OPTIONS } from "@rescom/schemas";

interface TargetingAudienceSummaryProps {
  targeting?: SurveyTargetingCriteria | null;
  className?: string;
}

export function formatTargetingSummary(targeting?: SurveyTargetingCriteria | null): string {
  if (!targeting) return "Open to all respondents (no targeting restrictions)";

  const parts: string[] = [];

  if (targeting.ageRange) {
    const { min, max } = targeting.ageRange;
    if (min !== undefined && max !== undefined) {
      if (min === max) {
        parts.push(`Age ${min}`);
      } else {
        parts.push(`Age ${min}–${max}`);
      }
    } else if (min !== undefined) {
      parts.push(`Age ≥ ${min}`);
    } else if (max !== undefined) {
      parts.push(`Age ≤ ${max}`);
    }
  }

  if (targeting.genders && targeting.genders.length > 0) {
    const genderLabels = targeting.genders.map((g) => {
      const opt = GENDER_OPTIONS.find((o) => o.value === g);
      return opt ? opt.label : g;
    });
    parts.push(genderLabels.join(", "));
  }

  if (targeting.locations && targeting.locations.length > 0) {
    if (targeting.locations.length <= 2) {
      parts.push(targeting.locations.join(", "));
    } else {
      parts.push(`${targeting.locations.slice(0, 2).join(", ")} +${targeting.locations.length - 2} more`);
    }
  }

  if (targeting.occupations && targeting.occupations.length > 0) {
    if (targeting.occupations.length <= 2) {
      parts.push(targeting.occupations.join(", "));
    } else {
      parts.push(`${targeting.occupations.slice(0, 2).join(", ")} +${targeting.occupations.length - 2} more`);
    }
  }

  if (targeting.fieldOfStudy && targeting.fieldOfStudy.length > 0) {
    if (targeting.fieldOfStudy.length <= 2) {
      parts.push(targeting.fieldOfStudy.join(", "));
    } else {
      parts.push(`${targeting.fieldOfStudy.slice(0, 2).join(", ")} +${targeting.fieldOfStudy.length - 2} more`);
    }
  }

  if (parts.length === 0) {
    return "Open to all respondents (no targeting restrictions)";
  }

  return `Targeted audience: ${parts.join(" • ")}`;
}

export function TargetingAudienceSummary({
  targeting,
  className = "",
}: TargetingAudienceSummaryProps) {
  const isTargeted =
    Boolean(targeting) &&
    (Boolean(targeting?.ageRange) ||
      (targeting?.locations && targeting.locations.length > 0) ||
      (targeting?.genders && targeting.genders.length > 0) ||
      (targeting?.occupations && targeting.occupations.length > 0) ||
      (targeting?.fieldOfStudy && targeting.fieldOfStudy.length > 0));

  if (!isTargeted) {
    return (
      <div className={`flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 ${className}`}>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
          Open to All
        </span>
        <span>No targeting restrictions configured</span>
      </div>
    );
  }

  const summary = formatTargetingSummary(targeting);

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300">
          Targeted Audience
        </span>
        <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">
          {summary}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {targeting?.ageRange && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            Age: {targeting.ageRange.min}–{targeting.ageRange.max}
          </span>
        )}

        {targeting?.genders && targeting.genders.length > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            Gender:{" "}
            {targeting.genders
              .map((g) => GENDER_OPTIONS.find((o) => o.value === g)?.label || g)
              .join(", ")}
          </span>
        )}

        {targeting?.locations && targeting.locations.length > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Location: {targeting.locations.join(", ")}
          </span>
        )}

        {targeting?.occupations && targeting.occupations.length > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Occupation: {targeting.occupations.join(", ")}
          </span>
        )}

        {targeting?.fieldOfStudy && targeting.fieldOfStudy.length > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800">
            Field: {targeting.fieldOfStudy.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}
