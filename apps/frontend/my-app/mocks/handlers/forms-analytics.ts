import { http, type RequestHandler } from "msw";
import { apiUrl } from "@/lib/api/config";
import { qualitySnapshotOf } from "../data/form-activity";
import { buildFormAnalytics } from "../data/form-analytics";
import { responsesOf } from "../data/form-responses";
import { fail, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { ownedForm, pickVersion, questionsOf } from "./forms-results";

/**
 * Survey response analytics (Câu trả lời → Tóm tắt / Theo câu hỏi). Same
 * access, version selection and errors as `GET /forms/:id/responses`
 * (`forms-results.ts`); the aggregation is `mocks/data/form-analytics.ts`.
 */
export const formsAnalyticsHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /forms/:id/analytics[?versionNumber=]
  http.get(apiUrl("/forms/:id/analytics"), async ({ params, request }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    const owned = await ownedForm(String(params.id));
    if ("error" in owned) return owned.error;
    const { form } = owned;
    const version = pickVersion(form, new URL(request.url).searchParams.get("versionNumber"));
    if (!version) return fail(404, "FORM_VERSION_NOT_FOUND", "Form version not found.");
    const rows = responsesOf(form.id, version.versionNumber);
    return ok(
      buildFormAnalytics({
        form: { id: form.id, title: form.title, type: form.type, versionNumber: version.versionNumber },
        // Google Forms answers stay in Google: totals only.
        questions: form.type === "INTERNAL" ? questionsOf(version.blocks) : [],
        rows,
        startedCount: qualitySnapshotOf(form.id, version.versionNumber)?.started ?? null,
      }),
    );
  }),
];
