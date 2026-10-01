import { http, type RequestHandler } from "msw";
import { apiUrl } from "@/lib/api/config";
import {
  PUBLISHER_ANALYTICS_MAX_RESPONSES,
  publisherAnalyticsQuerySchema,
  publisherAnalyticsSchema,
} from "@rescom/schemas";
import { buildFormAnalytics } from "../data/form-analytics";
import { responsesOf } from "../data/form-responses";
import { fail, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { feedOrder, ownedForm, pickVersion, questionsOf } from "./forms-results";

/**
 * Survey response analytics (Câu trả lời → Tóm tắt / Theo câu hỏi). Same
 * access (owner only), version selection and errors as
 * `GET /forms/:id/responses` (`forms-results.ts`); the aggregation is the
 * shared `aggregateFormAnalytics` (`mocks/data/form-analytics.ts`).
 */
export const formsAnalyticsHandlers: RequestHandler[] = [
  // VERIFIED (Story IR.4a Q1): GET /forms/:id/analytics[?versionNumber=]
  http.get(apiUrl("/forms/:id/analytics"), async ({ params, request }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    const query = publisherAnalyticsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: query.error.format() });
    const owned = await ownedForm(String(params.id));
    if ("error" in owned) return owned.error;
    const { form } = owned;
    if (form.type === "EXTERNAL") {
      return ok(
        publisherAnalyticsSchema.parse({
          availability: "NOT_APPLICABLE",
          reason: "EXTERNAL_FORM",
          form: { id: form.id, title: form.title, type: "EXTERNAL", externalUrl: form.externalUrl },
        }),
      );
    }
    const version = pickVersion(form, query.data.versionNumber ? String(query.data.versionNumber) : null);
    if (!version) return fail(404, "FORM_VERSION_NOT_FOUND", "Form version not found.");
    const rows = feedOrder(responsesOf(form.id, version.versionNumber));
    if (rows.length > PUBLISHER_ANALYTICS_MAX_RESPONSES) {
      return fail(422, "PUBLISHER_ANALYTICS_LIMIT_EXCEEDED", "Too many responses to aggregate.", {
        details: { totalResponses: rows.length, limit: PUBLISHER_ANALYTICS_MAX_RESPONSES },
      });
    }
    return ok(
      publisherAnalyticsSchema.parse(
        buildFormAnalytics({
          form: { id: form.id, title: form.title, versionId: version.id, versionNumber: version.versionNumber },
          questions: questionsOf(version.blocks),
          rows,
        }),
      ),
    );
  }),
];
