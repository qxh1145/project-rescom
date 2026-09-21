/**
 * Survey Targeting Criteria Schema
 *
 * Defines the demographic targeting criteria a Publisher can attach to a survey
 * (stored in `FormVersion.targetingJson`). Only respondents matching ALL specified
 * criteria are shown the survey in the Marketplace feed (enforced by Story 4.2).
 *
 * An empty object `{}` means the survey is open to everyone — no targeting applied.
 *
 * This contract is shared between frontend (UI validation) and backend (API
 * validation / Marketplace matching query). Both import from `@rescom/schemas`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Gender enum
// ---------------------------------------------------------------------------

export const genderEnum = z.enum(
  ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"],
  {
    errorMap: () => ({
      message:
        "gender values must be one of: MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY",
    }),
  },
);

export type Gender = z.infer<typeof genderEnum>;

export const GENDER_OPTIONS: { label: string; value: Gender }[] = [
  { label: "Male", value: "MALE" },
  { label: "Female", value: "FEMALE" },
  { label: "Other", value: "OTHER" },
  { label: "Prefer not to say", value: "PREFER_NOT_TO_SAY" },
];

// ---------------------------------------------------------------------------
// Age range sub-schema
// ---------------------------------------------------------------------------

const ageRangeSchema = z
  .object({
    min: z
      .number()
      .int("ageRange.min must be an integer")
      .min(13, "ageRange.min must be at least 13")
      .max(100, "ageRange.min cannot exceed 100"),
    max: z
      .number()
      .int("ageRange.max must be an integer")
      .min(13, "ageRange.max must be at least 13")
      .max(100, "ageRange.max cannot exceed 100"),
  })
  .refine((data) => data.min <= data.max, {
    message: "ageRange.min must be less than or equal to ageRange.max",
    path: ["min"],
  });

// ---------------------------------------------------------------------------
// Tag list helper
// ---------------------------------------------------------------------------

function tagList(label: string, maxEntries = 50) {
  return z
    .array(
      z
        .string()
        .trim()
        .min(1, `${label} entries cannot be empty`)
        .max(100, `Each ${label} entry cannot exceed 100 characters`),
    )
    .max(maxEntries, `${label} cannot have more than ${maxEntries} entries`);
}

// ---------------------------------------------------------------------------
// Main targeting schema
// ---------------------------------------------------------------------------

/**
 * `surveyTargetingSchema` — all fields are optional.
 * Omitting a field (or the entire object) means "no restriction on this dimension".
 * Empty arrays are treated the same as omitted fields by the Marketplace matcher.
 *
 * Stored as `FormVersion.targetingJson` (JSONB). No DB migration required.
 */
export const surveyTargetingSchema = z
  .object({
    /**
     * Age range requirement. Respondents whose age falls outside [min, max] are excluded.
     * min ≤ max, both integers in [13, 100].
     */
    ageRange: ageRangeSchema.optional(),

    /**
     * Allowlist of location strings (city/province/region level).
     * Max 50 entries, each max 100 characters.
     * Comparison is case-insensitive on the Marketplace side (Story 4.2).
     */
    locations: tagList("locations").optional(),

    /**
     * Gender allowlist. Respondents whose profile gender is not in this list are excluded.
     * If omitted or empty, all genders are included.
     */
    genders: z.array(genderEnum).optional(),

    /**
     * Occupation allowlist (free-text strings from demographic profile).
     * Max 50 entries.
     */
    occupations: tagList("occupations").optional(),

    /**
     * Field of study allowlist (free-text strings from demographic profile).
     * Max 50 entries.
     */
    fieldOfStudy: tagList("fieldOfStudy").optional(),
  })
  .strict();

export type SurveyTargetingCriteria = z.infer<typeof surveyTargetingSchema>;
