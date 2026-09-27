import { http, type RequestHandler } from "msw";
import {
  approveSurveyModerationSchema,
  listModerationQueueQuerySchema,
  rejectSurveyModerationSchema,
  type SurveyModerationOutcome,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  approveModeration,
  ensureModerationSeed,
  formVersionIdOf,
  moderationDecisions,
  moderationQueue,
  rejectModeration,
  toModerationPreview,
  toModerationQueueItem,
  toModerationResult,
} from "../data/admin-moderation";
import { findPublisherForm, type MockPublisherForm } from "../data/forms";
import type { MockSessionUser } from "../db/session";
import { fail, missingCsrf, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/**
 * Mirrors `apps/backend/src/modules/moderation/presentation/admin-moderation.controller.ts`
 * (+ `survey-moderation.service.ts`). All routes VERIFIED; the queue items
 * carry the ASSUMED display extensions of `lib/admin/moderation-service.ts`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function guard(): Promise<MockSessionUser | Response> {
  const forced = await applyScenario("admin");
  if (forced) return forced;
  return requireMockAdmin();
}

function formOrFail(formId: string): MockPublisherForm | Response {
  if (!UUID.test(formId)) return fail(400, "VALIDATION_ERROR", "formId must be a valid UUID");
  ensureModerationSeed();
  const form = findPublisherForm(formId);
  return form ?? fail(404, "FORM_NOT_FOUND", `Form "${formId}" not found`);
}

/**
 * Shared checks of approve/reject (`replayOrConflict`, `loadQueued`): same
 * decision → replay, opposite → 409, then self-review, status and version.
 */
function precheck(
  form: MockPublisherForm,
  admin: MockSessionUser,
  formVersionId: string,
  intended: SurveyModerationOutcome,
): Response | undefined {
  const existing = moderationDecisions.get()[formVersionId];
  if (existing) {
    if (existing.formId !== form.id) {
      return fail(409, "MODERATION_VERSION_MISMATCH", "The version awaiting moderation changed.");
    }
    if (existing.outcome !== intended) {
      return fail(409, "MODERATION_ALREADY_DECIDED", `Survey "${form.id}" was already moderated (${existing.outcome}).`);
    }
    return ok(toModerationResult(existing, form, true));
  }
  if (form.ownerEmail === admin.email) {
    return fail(403, "MODERATION_SELF_REVIEW_FORBIDDEN", "Administrators cannot moderate their own surveys.");
  }
  if (form.status !== "MODERATION_QUEUE") {
    return fail(409, "FORM_NOT_IN_MODERATION_QUEUE", `Survey "${form.id}" is not awaiting moderation.`);
  }
  if (formVersionIdOf(form) !== formVersionId) {
    return fail(409, "MODERATION_VERSION_MISMATCH", "The version awaiting moderation changed.");
  }
  return undefined;
}

export const adminModerationHandlers: RequestHandler[] = [
  // VERIFIED: GET /admin/moderation/surveys?limit&offset → moderationQueueListSchema (oldest first)
  http.get(apiUrl("/admin/moderation/surveys"), async ({ request }) => {
    const admin = await guard();
    if (admin instanceof Response) return admin;
    const query = listModerationQueueQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!query.success) {
      return fail(400, "VALIDATION_ERROR", query.error.errors[0]?.message ?? "Invalid query", {
        details: query.error.format(),
      });
    }
    const { limit, offset } = query.data;
    const queue = moderationQueue();
    const items = queue.slice(offset, offset + limit).map(toModerationQueueItem);
    return ok({ items, total: queue.length, limit, offset, hasMore: offset + items.length < queue.length });
  }),

  // VERIFIED: GET /admin/moderation/surveys/:formId → moderationSurveyPreviewSchema
  http.get(apiUrl("/admin/moderation/surveys/:formId"), async ({ params }) => {
    const admin = await guard();
    if (admin instanceof Response) return admin;
    const form = formOrFail(String(params.formId));
    if (form instanceof Response) return form;
    return ok(toModerationPreview(form));
  }),

  // VERIFIED: POST /admin/moderation/surveys/:formId/approve { formVersionId, note? } → surveyModerationResultSchema
  http.post(apiUrl("/admin/moderation/surveys/:formId/approve"), async ({ request, params }) => {
    const admin = await guard();
    if (admin instanceof Response) return admin;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const body = approveSurveyModerationSchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Invalid body", {
        details: body.error.format(),
      });
    }
    const form = formOrFail(String(params.formId));
    if (form instanceof Response) return form;
    const stop = precheck(form, admin, body.data.formVersionId, "APPROVED");
    if (stop) return stop;
    const result = approveModeration(form, admin);
    return ok(toModerationResult(result.decision, result.form, false));
  }),

  // VERIFIED: POST /admin/moderation/surveys/:formId/reject { formVersionId, reason } → surveyModerationResultSchema
  http.post(apiUrl("/admin/moderation/surveys/:formId/reject"), async ({ request, params }) => {
    const admin = await guard();
    if (admin instanceof Response) return admin;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const body = rejectSurveyModerationSchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Invalid body", {
        details: body.error.format(),
      });
    }
    const form = formOrFail(String(params.formId));
    if (form instanceof Response) return form;
    const stop = precheck(form, admin, body.data.formVersionId, "REJECTED");
    if (stop) return stop;
    const result = rejectModeration(form, admin, body.data.reason);
    return ok(toModerationResult(result.decision, result.form, false));
  }),
];
