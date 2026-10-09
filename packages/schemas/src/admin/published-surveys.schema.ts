import { z } from "zod";

/**
 * Admin · published surveys and Marketplace pinning.
 *
 * `GET /admin/surveys/published?limit&offset&search`: PUBLISHED surveys,
 * pinned first, then most recently updated. `search` matches the title
 * (case-insensitive).
 *
 * `PUT /admin/surveys/:formId/pin` `{ pinned }`: pins or unpins one survey.
 * Pinning needs a PUBLISHED survey; unpinning works in any status.
 */

export const PUBLISHED_SURVEYS_MAX_LIMIT = 100;
export const PUBLISHED_SURVEYS_DEFAULT_LIMIT = 50;

export const listPublishedSurveysQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PUBLISHED_SURVEYS_MAX_LIMIT)
      .default(PUBLISHED_SURVEYS_DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().trim().max(200).optional(),
  })
  .strict();
export type ListPublishedSurveysQuery = z.infer<typeof listPublishedSurveysQuerySchema>;

export const publishedSurveySchema = z
  .object({
    formId: z.string().uuid(),
    title: z.string(),
    publisherEmail: z.string().nullable(),
    updatedAt: z.string().datetime(),
    isPinned: z.boolean(),
  })
  .strict();
export type PublishedSurvey = z.infer<typeof publishedSurveySchema>;

export const publishedSurveyPageSchema = z
  .object({
    items: z.array(publishedSurveySchema).max(PUBLISHED_SURVEYS_MAX_LIMIT),
    total: z.number().int().nonnegative(),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    hasMore: z.boolean(),
  })
  .strict();
export type PublishedSurveyPage = z.infer<typeof publishedSurveyPageSchema>;

export const setSurveyPinnedSchema = z.object({ pinned: z.boolean() }).strict();
export type SetSurveyPinnedInput = z.infer<typeof setSurveyPinnedSchema>;

export const surveyPinResultSchema = z
  .object({ formId: z.string().uuid(), isPinned: z.boolean() })
  .strict();
export type SurveyPinResult = z.infer<typeof surveyPinResultSchema>;
