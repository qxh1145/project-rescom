import { z } from "zod";
import { genderEnum, Gender } from "../forms/form-targeting.schema";

/**
 * Demographic Profile Schema
 * Represents a respondent's self-reported demographic attributes in RESCOM.
 * Used for automated marketplace matching (Story 4.2).
 */
export const demographicProfileSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  age: z
    .number()
    .int("Age must be an integer")
    .min(13, "Age must be at least 13")
    .max(100, "Age cannot exceed 100")
    .nullable()
    .optional(),
  gender: genderEnum.nullable().optional(),
  location: z
    .string()
    .trim()
    .max(100, "Location cannot exceed 100 characters")
    .nullable()
    .optional(),
  occupation: z
    .string()
    .trim()
    .max(100, "Occupation cannot exceed 100 characters")
    .nullable()
    .optional(),
  fieldOfStudy: z
    .string()
    .trim()
    .max(100, "Field of study cannot exceed 100 characters")
    .nullable()
    .optional(),
  householdIncome: z
    .string()
    .trim()
    .max(100, "Household income cannot exceed 100 characters")
    .nullable()
    .optional(),
  specificInterests: z
    .union([z.array(z.string()), z.record(z.unknown())])
    .nullable()
    .optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const updateDemographicProfileSchema = z.object({
  age: z
    .number()
    .int("Age must be an integer")
    .min(13, "Age must be at least 13")
    .max(100, "Age cannot exceed 100")
    .nullable()
    .optional(),
  gender: genderEnum.nullable().optional(),
  location: z
    .string()
    .trim()
    .max(100, "Location cannot exceed 100 characters")
    .nullable()
    .optional(),
  occupation: z
    .string()
    .trim()
    .max(100, "Occupation cannot exceed 100 characters")
    .nullable()
    .optional(),
  fieldOfStudy: z
    .string()
    .trim()
    .max(100, "Field of study cannot exceed 100 characters")
    .nullable()
    .optional(),
  householdIncome: z
    .string()
    .trim()
    .max(100, "Household income cannot exceed 100 characters")
    .nullable()
    .optional(),
  specificInterests: z
    .union([z.array(z.string()), z.record(z.unknown())])
    .nullable()
    .optional(),
});

export type DemographicProfileDto = z.infer<typeof demographicProfileSchema>;
export type UpdateDemographicProfileInput = z.infer<
  typeof updateDemographicProfileSchema
>;

/**
 * Checks whether a demographic profile has core demographic values populated.
 */
export function isProfileCompleted(
  profile: Partial<DemographicProfileDto> | null | undefined,
): boolean {
  if (!profile) return false;
  return (
    typeof profile.age === "number" &&
    profile.age >= 13 &&
    Boolean(profile.gender) &&
    Boolean(profile.location && profile.location.trim().length > 0)
  );
}
