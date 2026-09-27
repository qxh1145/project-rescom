import { formBlockTypeEnum, formTypeEnum } from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Phase 5C — publisher results (Figma 10d, 10d', 10e, 17, 17a).
 *
 * | Endpoint | Label |
 * |---|---|
 * | `GET /forms/:id/responses[?versionNumber=]` | ASSUMED API CONTRACT — every response of one version, newest first |
 * | `GET /forms/:id/quality[?versionNumber=]` | ASSUMED API CONTRACT — survey quality (policy `survey-quality-v1`) |
 * | `GET /forms/:id/versions` | VERIFIED (`forms.controller.ts` → `FormVersionSummaryDto[]`, ascending); the stats fields are ASSUMED optional extensions |
 * | `GET /forms/:id/versions/:versionId` | ASSUMED API CONTRACT — one version with its blocks (for "Thay đổi so với v1") |
 *
 * The backend has no read route for responses yet (only submit/verify in
 * `participation.controller.ts`). The list returns every row of the version
 * (publisher samples are small); filtering, search, pagination and the
 * CSV/.xlsx export are computed client-side (`results-view.ts`,
 * `results-export.ts`). Owner or ADMIN only: 404 `FORM_NOT_FOUND`, 403 `FORM_FORBIDDEN`.
 */

const isoDate = z.string().min(1);

export const resultQuestionSchema = z.object({
  id: z.string(),
  /** 1-based position in the version ("C3", "Câu 3"). */
  number: z.number().int().positive(),
  title: z.string(),
  /** ASSUMED: short column header ("Ngân sách/tháng"); null → the title is truncated. */
  shortLabel: z.string().nullable(),
  type: formBlockTypeEnum,
  required: z.boolean(),
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  /**
   * ASSUMED (Phase 5 M4): the choice question accepts a free "Khác" answer
   * (block `allowOther`); such an answer is stored as its text, not an option value.
   */
  allowOther: z.boolean().default(false),
  scale: z
    .object({
      min: z.number(),
      max: z.number(),
      minLabel: z.string().nullable(),
      maxLabel: z.string().nullable(),
    })
    .nullable(),
});
export type ResultQuestion = z.infer<typeof resultQuestionSchema>;

export const answerValueSchema = z.union([z.string(), z.number(), z.array(z.string()), z.null()]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

export const responseQualitySchema = z.enum(["PASSED", "NEEDS_REVIEW"]);
export type ResponseQuality = z.infer<typeof responseQualitySchema>;

const reasonSchema = z.object({
  code: z.string(),
  params: z.record(z.union([z.string(), z.number()])).default({}),
});
export type ReviewReason = z.infer<typeof reasonSchema>;

export const formResponseSchema = z.object({
  id: z.string(),
  /** Anonymous code shown as "#47AD" — never a name or email. */
  code: z.string(),
  submittedAt: isoDate,
  durationSeconds: z.number().int().nonnegative(),
  quality: responseQualitySchema,
  reviewReasons: z.array(reasonSchema).default([]),
  /** Keyed by question id; INTERNAL only (Google Forms answers stay in Google). */
  answers: z.record(answerValueSchema).default({}),
  /** EXTERNAL: the completion code was verified in Rescom. */
  codeVerified: z.boolean().nullable().default(null),
});
export type FormResponse = z.infer<typeof formResponseSchema>;

export const formResponsesSchema = z.object({
  form: z.object({
    id: z.string(),
    title: z.string(),
    type: formTypeEnum,
    /** Version the rows belong to (answers are tied to one version — 17a). */
    versionNumber: z.number().int().positive(),
    estimatedEffortSeconds: z.number().int().nonnegative(),
    externalUrl: z.string().nullable(),
  }),
  questions: z.array(resultQuestionSchema),
  /** Newest first. */
  responses: z.array(formResponseSchema),
});
export type FormResponses = z.infer<typeof formResponsesSchema>;

export const formQualitySchema = z.object({
  versionNumber: z.number().int().positive(),
  status: z.enum(["ENOUGH_DATA", "NOT_ENOUGH_DATA"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
  policyVersion: z.string(),
  basedOnResponses: z.number().int().nonnegative(),
  minimumResponses: z.number().int().nonnegative(),
  updatedAt: isoDate.nullable(),
  formType: formTypeEnum,
  questionCount: z.number().int().nonnegative(),
  started: z.number().int().nonnegative(),
  abandoned: z.number().int().nonnegative(),
  medianDurationSeconds: z.number().nonnegative().nullable(),
  declaredEffortSeconds: z.number().int().nonnegative(),
  technicalErrors: z.number().int().nonnegative(),
  feedback: z.object({ average: z.number().nullable(), count: z.number().int().nonnegative() }),
  passed: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  /** One entry per question of the version (INTERNAL); empty for Google Forms. */
  dropOff: z.array(
    z.object({
      questionNumber: z.number().int().positive(),
      questionType: formBlockTypeEnum,
      required: z.boolean(),
      count: z.number().int().nonnegative(),
    }),
  ),
  /** Codes + numbers; the copy lives in `results-quality.ts`. */
  suggestions: z.array(
    z.object({
      code: z.string(),
      params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
      /** Draft version that already addresses it ("Sửa ở v2"). */
      fixedInVersion: z.number().int().positive().nullable().default(null),
    }),
  ),
});
export type FormQuality = z.infer<typeof formQualitySchema>;

/** VERIFIED `FormVersionSummaryDto` + ASSUMED optional stats (absent on today's backend). */
export const formVersionSummarySchema = z.object({
  id: z.string(),
  formId: z.string(),
  versionNumber: z.number().int().positive(),
  isPublished: z.boolean(),
  publishedAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate.nullable().optional(),
  submittedForReviewAt: isoDate.nullable().optional(),
  collectedFrom: isoDate.nullable().optional(),
  collectedUntil: isoDate.nullable().optional(),
  responseCount: z.number().int().nonnegative().nullable().optional(),
  questionCount: z.number().int().nonnegative().nullable().optional(),
  qualityStatus: z.enum(["ENOUGH_DATA", "NOT_ENOUGH_DATA"]).nullable().optional(),
});
export type FormVersionSummary = z.infer<typeof formVersionSummarySchema>;

/** Loose block shape: a draft may still hold incomplete blocks. */
export const versionBlockSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    order: z.number().optional(),
    title: z.string().default(""),
    required: z.boolean().default(false),
    options: z.array(z.object({ label: z.string() }).passthrough()).optional(),
  })
  .passthrough();
export type VersionBlock = z.infer<typeof versionBlockSchema>;

export const formVersionDetailSchema = formVersionSummarySchema.extend({
  schemaJson: z.object({ blocks: z.array(versionBlockSchema) }).passthrough(),
});
export type FormVersionDetail = z.infer<typeof formVersionDetailSchema>;

const formPath = (formId: string): `/forms/${string}` => `/forms/${encodeURIComponent(formId)}`;
const versionQuery = (versionNumber?: number | null) =>
  versionNumber ? `?versionNumber=${encodeURIComponent(String(versionNumber))}` : "";

export function getFormResponses(
  formId: string,
  versionNumber?: number | null,
  signal?: AbortSignal,
): Promise<FormResponses> {
  return apiRequest(`${formPath(formId)}/responses${versionQuery(versionNumber)}`, {
    schema: formResponsesSchema,
    signal,
  });
}

export function getFormQuality(
  formId: string,
  versionNumber?: number | null,
  signal?: AbortSignal,
): Promise<FormQuality> {
  return apiRequest(`${formPath(formId)}/quality${versionQuery(versionNumber)}`, {
    schema: formQualitySchema,
    signal,
  });
}

export function getFormVersions(formId: string, signal?: AbortSignal): Promise<FormVersionSummary[]> {
  return apiRequest(`${formPath(formId)}/versions`, {
    schema: z.array(formVersionSummarySchema),
    signal,
  });
}

export function getFormVersion(formId: string, versionId: string, signal?: AbortSignal): Promise<FormVersionDetail> {
  return apiRequest(`${formPath(formId)}/versions/${encodeURIComponent(versionId)}`, {
    schema: formVersionDetailSchema,
    signal,
  });
}
