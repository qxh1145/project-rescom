import { publicFormDetailsSchema } from "@rescom/schemas";
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
 * ASSUMED API CONTRACT: the optional `sections` field. The backend form schema
 * has no sections; Figma 4 groups questions into "Phần 1 · Thông tin chung"…
 * Without it the survey is one unnamed section.
 */
export const surveySectionSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  blockIds: z.array(z.string().min(1).max(100)),
});

export const surveyFormSchema = publicFormDetailsSchema.extend({
  sections: z.array(surveySectionSchema).optional(),
});
export type SurveyForm = z.infer<typeof surveyFormSchema>;

export function getSurveyForm(formId: string, signal?: AbortSignal): Promise<SurveyForm> {
  return apiRequest(`/public/forms/${encodeURIComponent(formId)}`, { schema: surveyFormSchema, signal });
}

/**
 * ASSUMED API CONTRACT: `GET /surveys/:id` — survey card data for the consent
 * screen (Figma 14: title, "Trong Rescom", "5 phút", "+12 điểm"). The backend
 * only lists surveys through `GET /marketplace/feed`. Unknown keys are ignored
 * so a richer marketplace shape of the same route also parses.
 */
export const surveySummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  type: z.enum(["INTERNAL", "EXTERNAL"]),
  rewardPerResponse: z.number().int().nonnegative(),
  estimatedEffortSeconds: z.number().int().nonnegative(),
  publisherName: z.string().optional(),
});
export type SurveySummary = z.infer<typeof surveySummarySchema>;

export function getSurveySummary(surveyId: string, signal?: AbortSignal): Promise<SurveySummary> {
  return apiRequest(`/surveys/${encodeURIComponent(surveyId)}`, { schema: surveySummarySchema, signal });
}

/** "5 phút" (rounded up, at least 1). */
export function formatEffortMinutes(seconds: number): string {
  return `${Math.max(1, Math.ceil(seconds / 60))} phút`;
}
