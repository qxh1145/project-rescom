import { z } from "zod";
import { removeLoneSurrogates } from "../common/unicode-text";
import {
  DEMOGRAPHIC_AGE_MAX,
  DEMOGRAPHIC_AGE_MIN,
} from "./demographic-profile.schema";

/**
 * FR-9 user profile, `GET/PATCH /users/me/profile` (Story IR.4b part A).
 *
 * The onboarding answers that are not FR-6 matching fields: display name,
 * birth year, school, school year and goal. `school` is the PRD's
 * "university" and `schoolYear` its "academic year" (FR-6/FR-9 amendments of
 * 2026-09-26); neither is used for targeting. `birthYear` is kept for display
 * and prefill only: the demographic `age` stays the matching field and is
 * never rewritten from it.
 */

/** Must equal the Prisma `UserGoal` enum. Intent only: never a role or permission. */
export const USER_GOALS = ["EARN", "COLLECT", "BOTH"] as const;
export const userGoalSchema = z.enum(USER_GOALS);
export type UserGoal = z.infer<typeof userGoalSchema>;

export const USER_PROFILE_DISPLAY_NAME_MAX = 50;
export const USER_PROFILE_SCHOOL_MAX = 200;

/** Figma 12.7 options: what `schoolYear` stores. */
export const SCHOOL_YEAR_VALUES = [
  "Năm 1",
  "Năm 2",
  "Năm 3",
  "Năm 4",
  "Năm 5+",
] as const;
export const schoolYearSchema = z.enum(SCHOOL_YEAR_VALUES);
export type SchoolYear = z.infer<typeof schoolYearSchema>;

export const USER_PROFILE_BIRTH_YEAR_MESSAGE = `Birth year must give an age between ${DEMOGRAPHIC_AGE_MIN} and ${DEMOGRAPHIC_AGE_MAX}`;

/**
 * Whether `birthYear` gives an age (`currentYear - birthYear`) within the
 * demographic bounds (`DEMOGRAPHIC_AGE_MIN..DEMOGRAPHIC_AGE_MAX`). The backend
 * passes the year of its own clock.
 */
export function isBirthYearAllowed(
  birthYear: number,
  currentYear: number,
): boolean {
  if (!Number.isInteger(birthYear) || !Number.isInteger(currentYear)) {
    return false;
  }
  const age = currentYear - birthYear;
  return age >= DEMOGRAPHIC_AGE_MIN && age <= DEMOGRAPHIC_AGE_MAX;
}

// C0 controls (tab and line breaks included: both fields are single-line),
// DEL, C1 controls, the line/paragraph separators and the bidi marks,
// embeddings, overrides and isolates that can reorder how a name displays.
const PROFILE_TEXT_CONTROL_CHARACTERS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

/** True when `value` holds a character the profile text fields reject. */
export function hasProfileControlCharacters(value: string): boolean {
  return PROFILE_TEXT_CONTROL_CHARACTERS.test(value);
}

/**
 * Free-text profile field: lone surrogates removed (the database rejects
 * them), trimmed, control characters rejected, at most `max` characters, and
 * blank stored as `null`.
 */
function profileTextSchema(label: string, max: number) {
  return z
    .string({ invalid_type_error: `${label} must be a string` })
    .transform((value) => removeLoneSurrogates(value).trim())
    .refine(
      (value) => !hasProfileControlCharacters(value),
      `${label} cannot contain control characters`,
    )
    .refine(
      (value) => value.length <= max,
      `${label} cannot exceed ${max} characters`,
    )
    .transform((value) => (value === "" ? null : value));
}

/**
 * `GET/PATCH /users/me/profile` payload. A user with no stored profile gets
 * every field `null`. `schoolYear` is a plain string so a value stored before
 * a catalog change still parses.
 */
export const userProfileSchema = z
  .object({
    displayName: z.string().nullable(),
    birthYear: z.number().int().nullable(),
    school: z.string().nullable(),
    schoolYear: z.string().nullable(),
    goal: userGoalSchema.nullable(),
  })
  .strict();
export type UserProfileDto = z.infer<typeof userProfileSchema>;

/**
 * `PATCH /users/me/profile` body, a partial update: an absent key keeps the
 * stored value, `null` clears it, and blank text is stored as `null`. Strict:
 * an unknown key is a validation error. The birth-year age bound depends on
 * the current year, so the backend checks it with `isBirthYearAllowed`.
 */
export const updateUserProfileSchema = z
  .object({
    displayName: profileTextSchema(
      "Display name",
      USER_PROFILE_DISPLAY_NAME_MAX,
    )
      .nullable()
      .optional(),
    birthYear: z
      .number({ invalid_type_error: "Birth year must be a number" })
      .int("Birth year must be an integer")
      .nullable()
      .optional(),
    school: profileTextSchema("School", USER_PROFILE_SCHOOL_MAX)
      .nullable()
      .optional(),
    schoolYear: schoolYearSchema.nullable().optional(),
    goal: userGoalSchema.nullable().optional(),
  })
  .strict();
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
