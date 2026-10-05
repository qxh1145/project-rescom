import { http, type RequestHandler } from "msw";
import {
  calculateEscrowCost,
  checkPublishRewardBand,
  checkSurveyFitsReservationWindow,
  createFormDraftSchema,
  escrowDrawPerCompletion,
  formDefinitionSchema,
  getRewardPricingRange,
  normalizeExpectedEffortSeconds,
  publishFormSchema,
  resolveEffectiveDurationMinutes,
  resolveRewardBandDurationOptions,
  SURVEY_DURATION_EXCEEDS_RESERVATION_CODE,
  updateFormDraftSchema,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { reserveSurveyEscrow } from "../data/economy";
import { ensureFormActivity } from "../data/form-activity";
import {
  createFormDraft,
  ensureDemoDraftListed,
  findFormDraft,
  nextUpdatedAt,
  saveFormDraft,
  syncPublisherForm,
  type MockFormDraft,
} from "../data/form-drafts";
import { findPublisherForm } from "../data/forms";
import { getMockSessionUser, type MockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";
import { toDetail } from "./forms-manage";
import { decideIdempotentRequest, idempotencyRecordKey, type IdempotencyRecord } from "../data/idempotency";
import { createCollection } from "../db/store";

/** `Idempotency-Key` of `POST /forms` → the draft id it created, by `<userId>:<key>`. */
const draftCreations = createCollection<Record<string, IdempotencyRecord<string>>>("builder-draft-creations", () => ({}));

/**
 * Phase 5D — Form Builder (Figma 13). VERIFIED routes mirror
 * `forms.controller.ts`; the AI chat routes live in `forms-ai.ts`. Only forms the builder owns (`form-drafts`)
 * are answered here: any other id / an EXTERNAL `POST /forms` falls through
 * to the next handler (Google Forms wizard, my-surveys…).
 */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * The builder's `FormDetailDto`, on top of the survey header fields of the
 * shared "Khảo sát của tôi" row (moderation outcome, `closeKind`, the ASSUMED
 * `rejection`, completions…) so `/forms/:id` shows an approved or rejected
 * builder survey correctly.
 */
function detailOf(draft: MockFormDraft, user: MockSessionUser) {
  const row = findPublisherForm(draft.id);
  // The row follows every builder save and also owner close / reopen after approval.
  const status = row?.status ?? draft.status;
  return {
    ...(row ? toDetail(row, user.id) : {}),
    id: draft.id,
    publisherId: user.id,
    type: "INTERNAL" as const,
    status,
    title: draft.title,
    description: draft.description,
    rewardPerResponse: draft.rewardPerResponse,
    expectedCompletions: row?.expectedCompletions ?? draft.expectedCompletions,
    estimatedDurationMinutes: draft.estimatedDurationMinutes,
    closeKind: row?.closeKind ?? null,
    topic: draft.topic ?? null,
    deadlineAt: draft.deadlineAt ?? null,
    currentVersion: {
      id: `${draft.id.slice(0, 24)}${String(draft.versionNumber).padStart(12, "0")}`,
      formId: draft.id,
      versionNumber: draft.versionNumber,
      schemaJson: draft.schema,
      targetingJson: draft.targetingJson ?? null,
      // Approval publishes the version; a rejected one never went live.
      isPublished: status === "PUBLISHED" || (status === "CLOSED" && Boolean(row?.publishedAt) && row?.closeKind !== "MODERATION"),
      publishedAt: row?.publishedAt ?? null,
      createdAt: draft.createdAt,
    },
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

type Access = { draft: MockFormDraft; user: MockSessionUser } | Response | undefined;

/** `undefined` = not a builder form (fall through); a Response = error to send. */
async function access(id: string, request: Request, mutating = false): Promise<Access> {
  ensureDemoDraftListed();
  const draft = findFormDraft(id);
  if (!draft) return undefined;
  const forced = await applyScenario("forms-builder");
  if (forced) return forced;
  const user = await getMockSessionUser();
  if (!user) return unauthorized();
  if (mutating) {
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
  }
  if (draft.ownerEmail !== user.email && user.role !== "ADMIN") {
    return fail(403, "FORM_FORBIDDEN", "You do not have access to this form.");
  }
  return { draft, user };
}

function pricingOf(draft: MockFormDraft) {
  const options = resolveRewardBandDurationOptions("INTERNAL", draft.schema);
  const duration = resolveEffectiveDurationMinutes({ estimatedDurationMinutes: draft.estimatedDurationMinutes, ...options });
  return {
    ...calculateEscrowCost({
      type: "INTERNAL",
      expectedCompletions: draft.expectedCompletions,
      rewardPerResponse: draft.rewardPerResponse,
    }),
    estimatedDurationMinutes: draft.estimatedDurationMinutes,
    pricingBand: duration != null ? getRewardPricingRange(duration) : null,
    bandCheck: checkPublishRewardBand(
      { type: "INTERNAL", rewardPerResponse: draft.rewardPerResponse, estimatedDurationMinutes: draft.estimatedDurationMinutes },
      options,
    ).status,
  };
}

/**
 * Escrow lock at publish (`publish:{formVersionId}` unit of work): Khả dụng →
 * Ký quỹ through the shared wallet mock.
 */
function reservePublishEscrow(user: MockSessionUser, draft: MockFormDraft, amount: number): Response | null {
  if (amount <= 0) return null;
  try {
    reserveSurveyEscrow(user, { amount, surveyId: draft.id, title: draft.title });
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_AVAILABLE") {
      return fail(409, "INSUFFICIENT_ESCROW_BALANCE", "Insufficient points for the survey escrow.", {
        details: { requiredAmount: amount },
      });
    }
    throw error;
  }
}

// The seeded Figma 13a draft appears in "Khảo sát của tôi" from the first load.
if (typeof window !== "undefined") ensureDemoDraftListed();

export const formsBuilderHandlers: RequestHandler[] = [
  // VERIFIED: POST /forms (createFormDraftSchema) → 201 FormDetailDto. EXTERNAL falls through (5A).
  http.post(apiUrl("/forms"), async ({ request }) => {
    const body = await readJson(request.clone());
    if (body && typeof body === "object" && (body as { type?: unknown }).type === "EXTERNAL") return undefined;
    const forced = await applyScenario("forms-builder");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = createFormDraftSchema.safeParse(body ?? {});
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid form draft.", { details: parsed.error.format() });
    // `Idempotency-Key` (Phase 6): a retry of the same creation returns the same draft.
    const recordKey = idempotencyRecordKey(user.id, request.headers.get("Idempotency-Key"));
    const fingerprint = JSON.stringify(parsed.data);
    const replay = decideIdempotentRequest(recordKey ? draftCreations.get()[recordKey] : undefined, fingerprint);
    if (replay.kind === "conflict") {
      return fail(409, "IDEMPOTENCY_KEY_CONFLICT", "This Idempotency-Key was already used with a different request body.");
    }
    if (replay.kind === "replay") {
      const existing = findFormDraft(replay.response);
      if (existing) return ok(detailOf(existing, user), 201);
    }
    const draft = createFormDraft({
      ownerEmail: user.email,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      rewardPerResponse: parsed.data.rewardPerResponse,
      expectedCompletions: parsed.data.expectedCompletions,
      estimatedDurationMinutes: parsed.data.estimatedDurationMinutes ?? null,
      schema: parsed.data.schema,
    });
    if (recordKey) {
      draftCreations.update((all) => {
        all[recordKey] = { fingerprint, response: draft.id };
      });
    }
    return ok(detailOf(draft, user), 201);
  }),

  // VERIFIED: GET /forms/:id → FormDetailDto; sections live in schemaJson.
  http.get(apiUrl("/forms/:id"), async ({ params, request }) => {
    const result = await access(String(params.id), request);
    if (!result || result instanceof Response) return result;
    // MOCK-ONLY: completions/responses of a published builder survey (form-activity.ts).
    ensureFormActivity(result.draft.id, result.user);
    return ok(detailOf(result.draft, result.user));
  }),

  // VERIFIED: PATCH /forms/:id/draft — optimistic lock on `clientUpdatedAt`.
  http.patch(apiUrl("/forms/:id/draft"), async ({ params, request }) => {
    const result = await access(String(params.id), request, true);
    if (!result || result instanceof Response) return result;
    const { draft, user } = result;
    const parsed = updateFormDraftSchema.safeParse((await readJson(request)) ?? {});
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid draft update.", { details: parsed.error.format() });
    if (draft.status !== "DRAFT") {
      return fail(409, "FORM_NOT_IN_DRAFT_STATUS", `Form is in ${draft.status} status and cannot be edited.`);
    }
    if (Date.parse(draft.updatedAt) > Date.parse(parsed.data.clientUpdatedAt)) {
      return fail(409, "FORM_EDIT_CONFLICT", "Autosave conflict: reload the latest version and retry.");
    }
    const input = parsed.data;
    const next: MockFormDraft = {
      ...draft,
      title: input.title ?? input.schema?.title ?? draft.title,
      description: input.description === undefined ? draft.description : input.description,
      rewardPerResponse: input.rewardPerResponse ?? draft.rewardPerResponse,
      expectedCompletions: input.expectedCompletions ?? draft.expectedCompletions,
      estimatedDurationMinutes:
        input.estimatedDurationMinutes === undefined ? draft.estimatedDurationMinutes : input.estimatedDurationMinutes,
      schema: input.schema ?? draft.schema,
      targetingJson: input.targetingJson === undefined ? draft.targetingJson : input.targetingJson,
      topic: input.topic === undefined ? draft.topic : input.topic,
      deadlineAt: input.deadlineAt === undefined ? draft.deadlineAt : input.deadlineAt,
      updatedAt: nextUpdatedAt(draft.updatedAt),
    };
    saveFormDraft(next);
    syncPublisherForm(next);
    return ok(detailOf(next, user));
  }),

  // VERIFIED: GET /forms/:id/pricing-quote → PricingQuoteDto.
  http.get(apiUrl("/forms/:id/pricing-quote"), async ({ params, request }) => {
    const result = await access(String(params.id), request);
    if (!result || result instanceof Response) return result;
    return ok(pricingOf(result.draft));
  }),

  // VERIFIED: POST /forms/:id/publish → escrow + MODERATION_QUEUE.
  http.post(apiUrl("/forms/:id/publish"), async ({ params, request }) => {
    const result = await access(String(params.id), request, true);
    if (!result || result instanceof Response) return result;
    const { draft, user } = result;
    const parsed = publishFormSchema.safeParse((await readJson(request)) ?? {});
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid publish request.", { details: parsed.error.format() });
    if (draft.status !== "DRAFT") return fail(409, "FORM_NOT_IN_DRAFT_STATUS", "Form is not a draft.");
    const estimatedDurationMinutes = parsed.data.estimatedDurationMinutes ?? draft.estimatedDurationMinutes;
    const schema = {
      ...draft.schema,
      metadata: {
        ...draft.schema.metadata,
        expectedEffortSeconds: normalizeExpectedEffortSeconds(draft.schema, estimatedDurationMinutes),
      },
    };
    const definition = formDefinitionSchema.safeParse(schema);
    if (!definition.success) {
      return fail(400, "INVALID_FORM_DRAFT", "The form is not valid for publishing.", { details: definition.error.format() });
    }
    // `assertSurveyFitsReservationWindow` (decision E5-D2) → 422.
    const reservation = checkSurveyFitsReservationWindow({ type: "INTERNAL", definition: schema, estimatedDurationMinutes });
    if (!reservation.fits) {
      return fail(422, SURVEY_DURATION_EXCEEDS_RESERVATION_CODE, "This survey cannot be published.", {
        details: reservation.violations,
      });
    }
    const candidate = { ...draft, schema, estimatedDurationMinutes };
    const band = pricingOf(candidate).bandCheck;
    if (band === "DURATION_REQUIRED") {
      return fail(422, "ESTIMATED_DURATION_REQUIRED", "estimatedDurationMinutes is required for a rewarded survey.", {
        details: [],
      });
    }
    if (band === "OUT_OF_BAND") {
      return fail(422, "PRICING_REWARD_OUT_OF_BAND", "Reward is outside the pricing band of this duration.");
    }
    // `coordinatePublish`: a new version of a survey that already ran ("Chỉnh sửa") keeps the
    // Escrow it still holds and locks only the shortfall (open slots × draw − held).
    const row = findPublisherForm(draft.id);
    const held = row?.publishedAt ? row.escrowLocked : 0;
    const openSlots = Math.max(0, (row?.expectedCompletions ?? draft.expectedCompletions) - (row?.completedCompletions ?? 0));
    const required = row?.publishedAt
      ? openSlots * escrowDrawPerCompletion({ type: "INTERNAL", rewardPerResponse: draft.rewardPerResponse })
      : calculateEscrowCost({
          type: "INTERNAL",
          expectedCompletions: draft.expectedCompletions,
          rewardPerResponse: draft.rewardPerResponse,
        }).effectiveCost;
    const shortfall = Math.max(0, required - held);
    const refused = reservePublishEscrow(user, draft, shortfall);
    if (refused) return refused;
    const published: MockFormDraft = {
      ...candidate,
      status: "MODERATION_QUEUE",
      escrowLocked: held + shortfall,
      submittedAt: new Date().toISOString(),
      updatedAt: nextUpdatedAt(draft.updatedAt),
    };
    saveFormDraft(published);
    syncPublisherForm(published);
    return ok(detailOf(published, user));
  }),
];
