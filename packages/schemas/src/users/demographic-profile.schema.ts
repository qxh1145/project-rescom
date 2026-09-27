import { z } from "zod";
import { genderEnum, Gender } from "../forms/form-targeting.schema";

export const DEMOGRAPHIC_AGE_MIN = 13;
export const DEMOGRAPHIC_AGE_MAX = 100;
export const DEMOGRAPHIC_INTERESTS_MAX = 30;
export const DEMOGRAPHIC_INTEREST_MAX_LENGTH = 100;

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

/**
 * Partial FR-9 profile edit (`PUT /demographics`). Strict: an unknown or
 * misspelled key is a validation error rather than a silently ignored field.
 * The interest list has the same bounds as the Mandatory Demographic Survey
 * (at most 30 non-blank items of at most 100 characters); the legacy record
 * shape stays accepted (AC1.1) and is bounded by the global JSON body limit.
 */
export const updateDemographicProfileSchema = z
  .object({
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
      .union([
        z
          .array(
            z
              .string()
              .trim()
              .min(1, "Interest cannot be blank")
              .max(
                DEMOGRAPHIC_INTEREST_MAX_LENGTH,
                `Interest cannot exceed ${DEMOGRAPHIC_INTEREST_MAX_LENGTH} characters`,
              ),
          )
          .max(
            DEMOGRAPHIC_INTERESTS_MAX,
            `Select at most ${DEMOGRAPHIC_INTERESTS_MAX} interests`,
          ),
        z.record(z.unknown()),
      ])
      .nullable()
      .optional(),
  })
  .strict();

export type DemographicProfileDto = z.infer<typeof demographicProfileSchema>;
export type UpdateDemographicProfileInput = z.infer<
  typeof updateDemographicProfileSchema
>;

/**
 * Domain error code returned when an earning feature (Marketplace feed,
 * survey attempt) is requested before the Mandatory Demographic Survey is
 * complete (Story 7.1, FR-6). Clients route to onboarding on this code.
 */
export const DEMOGRAPHIC_PROFILE_REQUIRED_CODE = "DEMOGRAPHIC_PROFILE_REQUIRED";

/**
 * Fields collected by the Mandatory Demographic Survey (PRD FR-6: age,
 * gender, region/province, occupation, academic major, income bracket and
 * interests). "All demographic fields are required."
 */
export const REQUIRED_DEMOGRAPHIC_FIELDS = [
  "age",
  "gender",
  "location",
  "occupation",
  "fieldOfStudy",
  "householdIncome",
  "specificInterests",
] as const;

export const demographicProfileFieldSchema = z.enum(
  REQUIRED_DEMOGRAPHIC_FIELDS,
);
export type DemographicProfileField = z.infer<
  typeof demographicProfileFieldSchema
>;


function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasInterests(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => hasText(item));
}

/**
 * Single definition of "complete" shared by backend and frontend (Story 7.1).
 * Returns the FR-6 fields that are absent or invalid, in canonical order.
 * Interests only count as a non-empty array of non-blank strings; the legacy
 * record shape never satisfies the requirement.
 */
export function getMissingDemographicFields(
  profile: Partial<DemographicProfileDto> | null | undefined,
): DemographicProfileField[] {
  if (!profile) return [...REQUIRED_DEMOGRAPHIC_FIELDS];

  const checks: Record<DemographicProfileField, boolean> = {
    age:
      typeof profile.age === "number" &&
      Number.isInteger(profile.age) &&
      profile.age >= DEMOGRAPHIC_AGE_MIN &&
      profile.age <= DEMOGRAPHIC_AGE_MAX,
    gender: genderEnum.safeParse(profile.gender).success,
    location: hasText(profile.location),
    occupation: hasText(profile.occupation),
    fieldOfStudy: hasText(profile.fieldOfStudy),
    householdIncome: hasText(profile.householdIncome),
    specificInterests: hasInterests(profile.specificInterests),
  };

  return REQUIRED_DEMOGRAPHIC_FIELDS.filter((field) => !checks[field]);
}

/**
 * Checks whether every Mandatory Demographic Survey field is populated
 * (FR-6). Gates the Marketplace feed and survey attempts.
 */
export function isProfileCompleted(
  profile: Partial<DemographicProfileDto> | null | undefined,
): boolean {
  return getMissingDemographicFields(profile).length === 0;
}

const requiredDemographicText = (label: string) =>
  z
    .string({
      required_error: `${label} is required`,
      invalid_type_error: `${label} is required`,
    })
    .trim()
    .min(1, `${label} is required`)
    .max(100, `${label} cannot exceed 100 characters`);

/**
 * Strict payload of the Mandatory Demographic Survey submission (Story 7.1).
 * Unlike `updateDemographicProfileSchema` (partial FR-9 edits), every FR-6
 * field is required.
 */
export const submitDemographicSurveySchema = z
  .object({
    age: z
      .number({
        required_error: "Age is required",
        invalid_type_error: "Age is required",
      })
      .int("Age must be an integer")
      .min(DEMOGRAPHIC_AGE_MIN, `Age must be at least ${DEMOGRAPHIC_AGE_MIN}`)
      .max(DEMOGRAPHIC_AGE_MAX, `Age cannot exceed ${DEMOGRAPHIC_AGE_MAX}`),
    gender: genderEnum,
    location: requiredDemographicText("Location"),
    occupation: requiredDemographicText("Occupation"),
    fieldOfStudy: requiredDemographicText("Field of study"),
    householdIncome: requiredDemographicText("Household income"),
    specificInterests: z
      .array(requiredDemographicText("Interest"), {
        required_error: "Select at least one interest",
        invalid_type_error: "Select at least one interest",
      })
      .min(1, "Select at least one interest")
      .max(
        DEMOGRAPHIC_INTERESTS_MAX,
        `Select at most ${DEMOGRAPHIC_INTERESTS_MAX} interests`,
      ),
  })
  .strict();

export type SubmitDemographicSurveyInput = z.infer<
  typeof submitDemographicSurveySchema
>;

/** `GET/PUT /demographics` payload: the profile plus its completeness. */
export const demographicProfileStatusSchema = z.object({
  profile: demographicProfileSchema,
  isComplete: z.boolean(),
  missingFields: z.array(demographicProfileFieldSchema),
});
export type DemographicProfileStatusDto = z.infer<
  typeof demographicProfileStatusSchema
>;

/**
 * Where the respondent goes after the mandatory survey: the Marketplace
 * activation step (complete one Marketplace survey, FR-7) or nothing left
 * when activation already happened.
 */
export const DEMOGRAPHIC_ONBOARDING_NEXT_STEPS = [
  "MARKETPLACE_ACTIVATION",
  "COMPLETED",
] as const;
export const demographicOnboardingNextStepSchema = z.enum(
  DEMOGRAPHIC_ONBOARDING_NEXT_STEPS,
);
export type DemographicOnboardingNextStep = z.infer<
  typeof demographicOnboardingNextStepSchema
>;

/** `POST /demographics/survey` payload. */
export const demographicSurveySubmissionResultSchema =
  demographicProfileStatusSchema.extend({
    nextStep: demographicOnboardingNextStepSchema,
  });
export type DemographicSurveySubmissionResultDto = z.infer<
  typeof demographicSurveySubmissionResultSchema
>;
