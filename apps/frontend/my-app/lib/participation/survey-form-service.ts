import { formSectionSchema, formStatusEnum, publicFormDetailsSchema } from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Question definitions of an in-Rescom survey.
 *
 * VERIFIED: `GET /public/forms/:id` (`public-forms.controller.ts`) →
 * `publicFormDetailsSchema` — the only read route that returns a published
 * version's blocks to a respondent. Caveat: the backend refuses it for forms
 * with `requireAuth` / `allowPublicAccess: false`; a respondent read route is
 * still missing there.
 *
 * The optional `sections` field is stored in the versioned form definition.
 * Without it the survey is one unnamed section.
 */
export const surveySectionSchema = formSectionSchema;

export const surveyFormSchema = publicFormDetailsSchema;
export type SurveyForm = z.infer<typeof surveyFormSchema>;

export function getSurveyForm(formId: string, signal?: AbortSignal): Promise<SurveyForm> {
  return apiRequest(`/public/forms/${encodeURIComponent(formId)}`, { schema: surveyFormSchema, signal });
}

/**
 * ASSUMED API CONTRACT: `GET /surveys/:id` — public facts about one survey,
 * the single summary route for screens reached without the feed: the consent
 * screen (Figma 14: title, "Trong Rescom", "5 phút", "+12 điểm") and 18.7
 * "Khảo sát đã đủ người" (responses / quota). The backend only lists surveys
 * through `GET /marketplace/feed`. Public (no session needed: 18.7 is a
 * public page); 404 `SURVEY_NOT_FOUND`. Unknown keys are ignored.
 */
export const surveySummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  type: z.enum(["INTERNAL", "EXTERNAL"]),
  status: formStatusEnum,
  rewardPerResponse: z.number().int().nonnegative(),
  estimatedEffortSeconds: z.number().int().nonnegative(),
  expectedCompletions: z.number().int().nonnegative(),
  completedCompletions: z.number().int().nonnegative(),
  publisherName: z.string().optional(),
});
export type SurveySummary = z.infer<typeof surveySummarySchema>;

export function getSurveySummary(surveyId: string, signal?: AbortSignal): Promise<SurveySummary> {
  return apiRequest(`/surveys/${encodeURIComponent(surveyId)}`, { schema: surveySummarySchema, signal });
}
