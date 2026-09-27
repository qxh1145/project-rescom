import {
  escrowDrawPerCompletion,
  EXTERNAL_COMPLETION_REVIEW_HOURS,
  listFormsQuerySchema,
  MAX_EXPECTED_COMPLETIONS,
  RESERVATION_EXPIRY_MS,
  reopenSurveySchema,
} from "@rescom/schemas";
import { http, type RequestHandler } from "msw";
import { z } from "zod";
import { apiUrl } from "@/lib/api/config";
import { reopenRefusalOf } from "@/lib/forms/manage-status";
import { activeReservationCount } from "../data/attempts";
import { refundSurveyEscrow, reserveSurveyEscrow } from "../data/economy";
import { ensureDemoRunningForm, findFormDraft, formDrafts, nextUpdatedAt, saveFormDraft } from "../data/form-drafts";
import { ensureFormActivity } from "../data/form-activity";
import { versionsOf } from "../data/form-versions";
import { findPublisherForm, publisherForms, updatePublisherForm, type MockPublisherForm } from "../data/forms";
import { trackingOf, updateTracking, type OpensRange } from "../data/forms-manage";
import { findSurvey, updateSurvey } from "../data/surveys";
import { getMockSessionUser, type MockSessionUser } from "../db/session";
import { mockId, nowIso } from "../db/store";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";
import { createdFormExtras } from "./forms-create";

/**
 * Phase 5B — publisher survey management (Figma page 10). Mirrors
 * `forms.controller.ts`: `GET /forms`, `GET /forms/:id`, `POST /forms/:id/close`,
 * `POST /forms/:id/reopen`, `POST /forms/:id/versions`, `DELETE /forms/:id`, `GET /forms/:id/in-progress-attempts` (VERIFIED);
 * progress, pause/resume and attempt disputes are ASSUMED API CONTRACTS.
 */

const DOMAIN = "forms-manage";
const REVIEW_MS = EXTERNAL_COMPLETION_REVIEW_HOURS * 3_600_000;

const notFound = (id: string) => fail(404, "FORM_NOT_FOUND", `Form "${id}" was not found.`);
const forbidden = () => fail(403, "FORM_FORBIDDEN", "You do not have access to this form.");

type Guarded = { user: MockSessionUser; form: MockPublisherForm } | { response: Response };

/** Scenario, session, (CSRF), form lookup and ownership — Admins may read any form. */
async function guard(request: Request, id: string, options: { mutate: boolean }): Promise<Guarded> {
  const forced = await applyScenario(DOMAIN);
  if (forced) return { response: forced };
  const user = await getMockSessionUser();
  if (!user) return { response: unauthorized() };
  if (options.mutate) {
    const csrf = missingCsrf(request);
    if (csrf) return { response: csrf };
  }
  const form = findPublisherForm(id);
  if (!form) return { response: notFound(id) };
  const owner = form.ownerEmail === user.email;
  if (!owner && (options.mutate || user.role !== "ADMIN")) return { response: forbidden() };
  return { user, form };
}

function managementFields(form: MockPublisherForm) {
  return {
    completedCompletions: form.completedCompletions,
    escrowLocked: form.escrowLocked,
    submittedAt: form.submittedAt,
    publishedAt: form.publishedAt,
    deadlineAt: form.deadlineAt,
    closedAt: form.closedAt,
    hiddenFromMarketplace: form.hiddenFromMarketplace,
    pausedAt: form.pausedAt ?? null,
    rejection: form.rejection,
    closeKind: form.closeKind ?? null,
  };
}

const lastUpdate = (form: MockPublisherForm) =>
  form.pausedAt ?? form.closedAt ?? form.publishedAt ?? form.submittedAt ?? form.createdAt;

/** VERIFIED `FormSummaryDto` + ASSUMED management fields. */
function toSummary(form: MockPublisherForm, publisherId: string) {
  return {
    id: form.id,
    publisherId,
    type: form.type,
    status: form.status,
    title: form.title,
    description: null,
    rewardPerResponse: form.rewardPerResponse,
    expectedCompletions: form.expectedCompletions,
    estimatedDurationMinutes: Math.round(form.estimatedEffortSeconds / 60),
    latestVersionNumber: form.versionNumber,
    createdAt: form.createdAt,
    updatedAt: lastUpdate(form),
    ...managementFields(form),
  };
}

/**
 * Whether the current version went live (backend `FormVersion.isPublished`):
 * the version history when it has the form, else approval (`publishedAt`) —
 * a rejected or withdrawn submission never did, so a CLOSED form is not
 * published by itself.
 */
function currentVersionPublished(form: MockPublisherForm): boolean {
  const version = versionsOf(form.id).find((item) => item.versionNumber === form.versionNumber);
  if (version) return version.isPublished;
  return (form.status === "PUBLISHED" || form.status === "CLOSED") && form.publishedAt !== null && form.closeKind !== "MODERATION";
}

/** Backend `existing.versions.some(isPublished)`: any version of the form went live. */
function hasPublishedVersion(form: MockPublisherForm): boolean {
  const versions = versionsOf(form.id);
  if (versions.length > 0) return versions.some((version) => version.isPublished);
  return form.publishedAt !== null && form.closeKind !== "MODERATION";
}

/** What the Google Forms wizard stored for a survey it created (MOCK-ONLY store, backend columns). */
function createdFieldsOf(form: MockPublisherForm) {
  const extras = createdFormExtras.get()[form.id];
  if (!extras) return { description: null, targetingJson: null, estimatedDurationMinutes: undefined };
  // The backend stores the strict targeting only (the UI-only `schools` never reaches it).
  const targeting = extras.targeting ? { ...extras.targeting } : null;
  if (targeting) delete targeting.schools;
  return {
    description: extras.description,
    targetingJson: targeting,
    estimatedDurationMinutes: extras.estimatedDurationMinutes ?? undefined,
  };
}

/**
 * VERIFIED `FormDetailDto` + ASSUMED management fields. Exported so another
 * `GET /forms/:id` handler (e.g. the Form Builder's, registered earlier) can
 * spread it and keep the survey header fields.
 */
export function toDetail(form: MockPublisherForm, publisherId: string) {
  const created = createdFieldsOf(form);
  const summary = toSummary(form, publisherId);
  return {
    ...summary,
    description: created.description ?? summary.description,
    estimatedDurationMinutes: created.estimatedDurationMinutes ?? summary.estimatedDurationMinutes,
    currentVersion: {
      id: `${form.id.slice(0, -4)}${String(form.versionNumber).padStart(4, "0")}`,
      formId: form.id,
      versionNumber: form.versionNumber,
      schemaJson: { schemaVersion: 1, title: form.title, blocks: [] },
      targetingJson: created.targetingJson,
      isPublished: currentVersionPublished(form),
      externalUrl: form.externalUrl,
      publishedAt: form.publishedAt,
      createdAt: form.createdAt,
    },
    questionCount: form.questionCount ?? null,
    audienceLabel: form.audienceLabel ?? null,
  };
}

const RANGES: readonly OpensRange[] = ["hour", "day", "week", "month"];

const disputeBodySchema = z
  .object({
    reason: z.enum(["LOW_EFFORT", "NO_MATCHING_RESPONSE", "DUPLICATE_RESPONDENT", "OTHER"]),
    description: z.string().trim().min(10).max(1000),
  })
  .strict();

export const formsManageHandlers: RequestHandler[] = [
  // VERIFIED: GET /forms — the caller's surveys (FormSummaryDto page).
  http.get(apiUrl("/forms"), async ({ request }) => {
    const forced = await applyScenario(DOMAIN);
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    // MOCK-ONLY: a running Form Builder survey to try "Chỉnh sửa" on.
    ensureDemoRunningForm(user.email);
    // MOCK-ONLY: charts, ratings and responses for the caller's Form Builder surveys.
    for (const form of publisherForms.get()) {
      if (form.ownerEmail !== user.email) continue;
      try {
        ensureFormActivity(form.id, user);
      } catch (error) {
        // One malformed survey must not take the whole list down.
        console.warn("[msw] form activity skipped", form.id, error);
      }
    }
    const query = listFormsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: query.error.format() });
    const { page, limit, status, type } = query.data;
    const mine = publisherForms
      .get()
      .filter((form) => form.ownerEmail === user.email)
      .filter((form) => (!status || form.status === status) && (!type || form.type === type));
    return ok({
      forms: mine.slice((page - 1) * limit, page * limit).map((form) => toSummary(form, user.id)),
      total: mine.length,
      page,
      limit,
      totalPages: Math.ceil(mine.length / limit) || 1,
    });
  }),

  // VERIFIED: GET /forms/:id — owner or Admin.
  http.get(apiUrl("/forms/:id"), async ({ request, params }) => {
    const guarded = await guard(request, String(params.id), { mutate: false });
    if ("response" in guarded) return guarded.response;
    ensureFormActivity(guarded.form.id, guarded.user);
    return ok(toDetail(findPublisherForm(guarded.form.id) ?? guarded.form, guarded.user.id));
  }),

  // ASSUMED API CONTRACT: GET /forms/:id/progress?range=hour|day|week|month (Figma 10a).
  http.get(apiUrl("/forms/:id/progress"), async ({ request, params }) => {
    const guarded = await guard(request, String(params.id), { mutate: false });
    if ("response" in guarded) return guarded.response;
    const range = (new URL(request.url).searchParams.get("range") ?? "day") as OpensRange;
    if (!RANGES.includes(range)) return fail(400, "VALIDATION_ERROR", "range must be hour, day, week or month.");
    ensureFormActivity(guarded.form.id, guarded.user);
    const form = findPublisherForm(guarded.form.id) ?? guarded.form;
    const tracking = trackingOf(form.id);
    const now = Date.now();
    const buckets = tracking.opens[range];
    return ok({
      formId: form.id,
      completed: form.completedCompletions,
      expected: form.expectedCompletions,
      pointsSpent: form.completedCompletions * escrowDrawPerCompletion(form),
      escrowRemaining: form.escrowLocked,
      deadlineAt: form.deadlineAt,
      opens: { range, total: buckets.reduce((sum, bucket) => sum + bucket.count, 0), buckets },
      started: tracking.started,
      abandoned: tracking.abandoned,
      averageDurationSeconds: tracking.averageDurationSeconds,
      pendingAttempts: tracking.pendingAttempts
        .map((attempt) => ({
          attemptId: attempt.attemptId,
          respondentCode: attempt.respondentCode,
          codeVerifiedAt: attempt.codeVerifiedAt,
          reviewEndsAt: new Date(Date.parse(attempt.codeVerifiedAt) + REVIEW_MS).toISOString(),
          dispute: attempt.dispute
            ? { id: attempt.dispute.id, status: attempt.dispute.status, reason: attempt.dispute.reason, createdAt: attempt.dispute.createdAt }
            : null,
        }))
        // A disputed attempt stays listed (its reward is held until the Admin decides).
        .filter((attempt) => attempt.dispute !== null || Date.parse(attempt.reviewEndsAt) > now),
      feedback: tracking.feedback,
    });
  }),

  // VERIFIED: GET /forms/:id/in-progress-attempts (decision E5-D4).
  http.get(apiUrl("/forms/:id/in-progress-attempts"), async ({ request, params }) => {
    const guarded = await guard(request, String(params.id), { mutate: false });
    if ("response" in guarded) return guarded.response;
    return ok({
      formId: guarded.form.id,
      status: guarded.form.status,
      inProgressAttempts: activeReservationCount(guarded.form.id),
      reservationWindowMinutes: Math.round(RESERVATION_EXPIRY_MS / 60_000),
    });
  }),

  // VERIFIED: POST /forms/:id/close — refunds the unused Escrow.
  http.post(apiUrl("/forms/:id/close"), async ({ request, params }) => {
    const guarded = await guard(request, String(params.id), { mutate: true });
    if ("response" in guarded) return guarded.response;
    const { user, form } = guarded;
    if (form.status === "CLOSED") return fail(409, "FORM_ALREADY_CLOSED", `Form "${form.id}" is already closed.`);
    // Backend `closeForm` (decision D2, Phase 5 M7): a draft closes only when one of
    // its versions was published (a re-versioned draft still holding Escrow); a
    // never-published draft is deleted instead — 400 INVALID_STATUS_TRANSITION.
    // A queued survey (MODERATION_QUEUE / legacy ESCROW_LOCKED) is withdrawn by its owner.
    if (form.status === "DRAFT" && !hasPublishedVersion(form)) {
      return fail(400, "INVALID_STATUS_TRANSITION", "A never-published draft is deleted, not closed.");
    }
    // Shared wallet helper (Ký quỹ → Khả dụng, capped at the wallet's Escrow).
    refundSurveyEscrow(user, { amount: form.escrowLocked, surveyId: form.id, title: form.title });
    const updated = updatePublisherForm(form.id, (draft) => {
      draft.status = "CLOSED";
      draft.closedAt = nowIso();
      draft.closeKind = "OWNER";
      draft.escrowLocked = 0;
      draft.hiddenFromMarketplace = true;
      draft.pausedAt = null;
    });
    if (findSurvey(form.id)) updateSurvey(form.id, (survey) => void (survey.status = "CLOSED"));
    return ok(toDetail(updated ?? form, user.id));
  }),

  // VERIFIED: POST /forms/:id/reopen { additionalCompletions } — owner only, locks new Escrow.
  http.post(apiUrl("/forms/:id/reopen"), async ({ request, params }) => {
    const guarded = await guard(request, String(params.id), { mutate: true });
    if ("response" in guarded) return guarded.response;
    const { user, form } = guarded;
    const body = reopenSurveySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "VALIDATION_ERROR", "Invalid reopen request.", { details: body.error.format() });
    // Same order as the backend `reopenForm`: CLOSED, closed by its owner (E8-D1), approved current version (Story 8.1).
    const refusal = reopenRefusalOf({
      status: form.status,
      closeKind: form.closeKind ?? null,
      currentVersion: { isPublished: currentVersionPublished(form) },
    });
    if (refusal === "NOT_CLOSED") {
      return fail(409, "FORM_EDIT_CONFLICT", "Only CLOSED surveys can be reopened with additional quota.");
    }
    if (refusal) {
      const message =
        refusal === "VERSION_NOT_APPROVED"
          ? "The current version was never approved for the Marketplace."
          : "This survey was closed by an Admin or moderation.";
      return fail(409, "FORM_NOT_REOPENABLE", message, {
        details: { reason: refusal, closeKind: form.closeKind ?? null },
      });
    }
    const added = body.data.additionalCompletions;
    if (form.expectedCompletions + added > MAX_EXPECTED_COMPLETIONS) {
      return fail(400, "FORM_VALIDATION_ERROR", "Expected completions cannot exceed 100,000 after reopening.");
    }
    const cost = added * escrowDrawPerCompletion(form);
    try {
      // Shared wallet helper (Khả dụng → Ký quỹ), same journal as the backend `coordinateReopen`.
      if (cost > 0) reserveSurveyEscrow(user, { amount: cost, surveyId: form.id, title: form.title });
    } catch (error) {
      if (error instanceof Error && error.message === "INSUFFICIENT_AVAILABLE") {
        return fail(409, "INSUFFICIENT_BALANCE", "Transaction rejected: account balance is insufficient and cannot overdraft.");
      }
      throw error;
    }
    const updated = updatePublisherForm(form.id, (draft) => {
      draft.status = "PUBLISHED";
      draft.expectedCompletions += added;
      draft.escrowLocked += cost;
      draft.closedAt = null;
      draft.hiddenFromMarketplace = false;
    });
    if (findSurvey(form.id)) {
      updateSurvey(form.id, (survey) => {
        survey.status = "PUBLISHED";
        survey.expectedCompletions += added;
      });
    }
    return ok(toDetail(updated ?? form, user.id));
  }),

  // VERIFIED: DELETE /forms/:id — backend `deleteDraft`: a DRAFT that never had a published version.
  http.delete(apiUrl("/forms/:id"), async ({ request, params }) => {
    const guarded = await guard(request, String(params.id), { mutate: true });
    if ("response" in guarded) return guarded.response;
    const { form } = guarded;
    if (form.status !== "DRAFT") {
      return fail(409, "FORM_NOT_IN_DRAFT_STATUS", `Form is in ${form.status} status and cannot be deleted.`);
    }
    if (hasPublishedVersion(form)) {
      return fail(409, "FORM_HAS_PUBLISHED_VERSIONS", `Form with ID "${form.id}" cannot be deleted because it has published version history.`);
    }
    publisherForms.update((all) => all.filter((item) => item.id !== form.id));
    if (findFormDraft(form.id)) {
      formDrafts.update((all) => {
        delete all[form.id];
      });
    }
    return ok({ id: form.id });
  }),

  // VERIFIED: POST /forms/:id/versions — "Chỉnh sửa" a running survey: vN+1 cloned
  // from the newest version, survey back to DRAFT (backend `createNewVersion`).
  http.post(apiUrl("/forms/:id/versions"), async ({ request, params }) => {
    const guarded = await guard(request, String(params.id), { mutate: true });
    if ("response" in guarded) return guarded.response;
    const { user, form } = guarded;
    if (form.status !== "PUBLISHED") {
      return fail(
        409,
        "FORM_NOT_PUBLISHED",
        `Cannot create a new version of form "${form.id}": form must be in PUBLISHED status, but current status is "${form.status}".`,
      );
    }
    const interruptedAttempts = activeReservationCount(form.id);
    const versionNumber = form.versionNumber + 1;
    // The Escrow stays held (a later publish locks only the shortfall); off Khám phá until approved.
    const updated = updatePublisherForm(form.id, (draft) => {
      draft.status = "DRAFT";
      draft.versionNumber = versionNumber;
      draft.pausedAt = null;
      draft.hiddenFromMarketplace = true;
      draft.submittedAt = null;
    });
    // The builder answers `GET /forms/:id` from its own draft: move it to vN+1 too.
    const builderDraft = findFormDraft(form.id);
    if (builderDraft) {
      saveFormDraft({
        ...builderDraft,
        status: "DRAFT",
        versionNumber,
        escrowLocked: form.escrowLocked,
        submittedAt: null,
        updatedAt: nextUpdatedAt(builderDraft.updatedAt),
      });
    }
    // Khám phá lists PUBLISHED catalog entries only; approval of vN+1 puts it back.
    if (findSurvey(form.id)) updateSurvey(form.id, (survey) => void (survey.status = "CLOSED"));
    return ok({ ...toDetail(updated ?? form, user.id), interruptedAttempts }, 201);
  }),

  // ASSUMED API CONTRACT: POST /forms/:id/pause and /resume ("Tạm dừng", Figma 10a).
  ...(["pause", "resume"] as const).map((action) =>
    http.post(apiUrl(`/forms/:id/${action}`), async ({ request, params }) => {
      const guarded = await guard(request, String(params.id), { mutate: true });
      if ("response" in guarded) return guarded.response;
      const { user, form } = guarded;
      if (form.status !== "PUBLISHED") return fail(409, "FORM_NOT_PUBLISHED", "Only a running survey can be paused.");
      // Khám phá keeps its own catalog (`surveys.ts`, PUBLISHED | CLOSED only); pausing only hides it here.
      const updated = updatePublisherForm(form.id, (draft) => {
        draft.pausedAt = action === "pause" ? nowIso() : null;
      });
      return ok(toDetail(updated ?? form, user.id));
    }),
  ),

  // ASSUMED API CONTRACT: POST /forms/:id/attempts/:attemptId/disputes (Figma 10c, FR-24).
  http.post(apiUrl("/forms/:id/attempts/:attemptId/disputes"), async ({ request, params }) => {
    const guarded = await guard(request, String(params.id), { mutate: true });
    if ("response" in guarded) return guarded.response;
    const { form } = guarded;
    const body = disputeBodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "VALIDATION_ERROR", "Invalid dispute.", { details: body.error.format() });
    const attemptId = String(params.attemptId);
    const attempt = trackingOf(form.id).pendingAttempts.find((item) => item.attemptId === attemptId);
    if (form.type !== "EXTERNAL" || !attempt) {
      return fail(404, "ATTEMPT_NOT_DISPUTABLE", "No completion of this survey is waiting for review.");
    }
    if (attempt.dispute) return fail(409, "DISPUTE_ALREADY_OPEN", "This attempt is already disputed.");
    if (Date.parse(attempt.codeVerifiedAt) + REVIEW_MS <= Date.now()) {
      return fail(409, "DISPUTE_WINDOW_CLOSED", "The 48-hour review window has ended.");
    }
    const dispute = { id: mockId(), status: "OPEN" as const, ...body.data, createdAt: nowIso() };
    updateTracking(form.id, (tracking) => {
      const target = tracking.pendingAttempts.find((item) => item.attemptId === attemptId);
      if (target) target.dispute = dispute;
    });
    return ok(
      { attemptId, dispute: { id: dispute.id, status: dispute.status, reason: dispute.reason, createdAt: dispute.createdAt } },
      201,
    );
  }),
];
