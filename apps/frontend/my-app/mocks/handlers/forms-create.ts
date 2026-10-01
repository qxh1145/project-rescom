import { http, type RequestHandler } from "msw";
import {
  SURVEY_DURATION_EXCEEDS_RESERVATION_CODE,
  audienceEstimateInputSchema,
  calculateEscrowCost,
  checkPublishRewardBand,
  checkSurveyFitsReservationWindow,
  createExternalSurveySchema,
  checkFormDeadline,
  resolveRewardBandDurationOptions,
  toAudienceEstimate,
  type SurveyTargetingCriteria,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { reserveSurveyEscrow, walletOf } from "../data/economy";
import { addPublisherForm } from "../data/forms";
import { decideIdempotentRequest, idempotencyRecordKey, type IdempotencyRecord } from "../data/idempotency";
import { createCollection, mockId, nowIso } from "../db/store";
import { getMockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Mirrors `apps/backend/src/modules/forms/presentation/forms.controller.ts`
 * `POST /forms/external` (→ `forms.service.ts#createExternalSurvey`) for the
 * Google Forms wizard (Figma 9), plus the ASSUMED audience estimate.
 */

/** Wizard targeting plus the UI-only school filter (`SCHOOL_TARGETING_SUPPORTED`), kept in the extras. */
type WizardTargeting = SurveyTargetingCriteria & { schools?: string[] };
const createBodySchema = createExternalSurveySchema;

/** Wizard data `MockPublisherForm` has no field for, keyed by form id (MOCK-ONLY). */
export interface CreatedFormExtras {
  description: string | null;
  topic: string | null;
  targeting: WizardTargeting | null;
  estimatedDurationMinutes: number | null;
  /** Plaintext only in the mock; the backend stores a verifier. */
  completionCode: string;
}

/**
 * Decision C6 (a): `Idempotency-Key` of `POST /forms/external`, keyed by
 * `<userId>:<key>` — the same key and body replay the first 201; another body
 * is a 409 (ASSUMED code `IDEMPOTENCY_KEY_CONFLICT`, backend in progress).
 */
export const createIdempotencyRecords = createCollection<Record<string, IdempotencyRecord<unknown>>>(
  "publisher-form-create-idempotency",
  () => ({}),
);

export const createdFormExtras = createCollection<Record<string, CreatedFormExtras>>(
  "publisher-form-create-extras",
  () => ({}),
);

/** `CompletionCodePort.generateSixDigitCode` (uniform 000000–999999). */
function sixDigitCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Deterministic stand-in for the audience estimate (Figma 9b). */
/** MOCK-ONLY heuristic standing in for the backend count (`AudienceEstimateService`). */
function estimateRespondents(targeting: SurveyTargetingCriteria): number {
  let estimate = 2400;
  if (targeting.ageRange) {
    const span = targeting.ageRange.max - targeting.ageRange.min + 1;
    estimate *= Math.min(1, span / 12);
  }
  if (targeting.genders?.length) estimate *= 0.5 * Math.min(2, targeting.genders.length);
  if (targeting.fieldOfStudy?.length) estimate *= Math.min(1, 0.16 * targeting.fieldOfStudy.length);
  if (targeting.locations?.length) estimate *= 0.45;
  return Math.max(0, Math.round(estimate));
}

export const formsCreateHandlers: RequestHandler[] = [
  // VERIFIED: POST /forms/external → 201 externalSurveyResponseSchema (+ FormDetailDto fields)
  http.post(apiUrl("/forms/external"), async ({ request }) => {
    const forced = await applyScenario("forms-create");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const raw = await readJson(request);
    const recordKey = idempotencyRecordKey(user.id, request.headers.get("Idempotency-Key"));
    const fingerprint = JSON.stringify(raw);
    const replay = decideIdempotentRequest(recordKey ? createIdempotencyRecords.get()[recordKey] : undefined, fingerprint);
    if (replay.kind === "replay") return ok(replay.response, 201);
    if (replay.kind === "conflict") {
      return fail(409, "IDEMPOTENCY_KEY_CONFLICT", "This Idempotency-Key was already used with a different request body.");
    }
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Validation failed", { details: parsed.error.format() });
    }
    const dto = parsed.data;
    // Story IR.2b Q1 parity: a deadline is 1 h – 180 d ahead.
    if (dto.deadlineAt && checkFormDeadline(new Date(dto.deadlineAt), new Date())) {
      return fail(422, "FORM_DEADLINE_INVALID", "The collection deadline must be 1 hour to 180 days ahead.");
    }
    const definition = {
      metadata: {
        expectedEffortSeconds: dto.expectedEffortSeconds,
        minTimeBarrierSeconds: Math.min(15, dto.expectedEffortSeconds),
      },
    };
    const estimatedDurationMinutes = dto.estimatedDurationMinutes ?? null;

    if (dto.autoPublish) {
      // `assertSurveyFitsReservationWindow` (decision E5-D2) → 422.
      const window = checkSurveyFitsReservationWindow({ type: "EXTERNAL", definition, estimatedDurationMinutes });
      if (!window.fits) {
        return fail(422, SURVEY_DURATION_EXCEEDS_RESERVATION_CODE, "This survey cannot be published.", {
          details: window.violations,
        });
      }
      // `assertRewardWithinPricingBand` (FR-14, decision E6-D2).
      const band = checkPublishRewardBand(
        { type: "EXTERNAL", rewardPerResponse: dto.rewardPerResponse, estimatedDurationMinutes },
        resolveRewardBandDurationOptions("EXTERNAL", definition),
      );
      if (band.status === "DURATION_REQUIRED") {
        return fail(422, "ESTIMATED_DURATION_REQUIRED", "Set the estimated completion time before publishing.", {
          details: [],
        });
      }
      if (band.status === "OUT_OF_BAND") {
        return fail(400, "PRICING_REWARD_OUT_OF_BAND", "Reward is outside the pricing band.", {
          details: { min: band.range.min, max: band.range.max, suggested: band.range.suggested },
        });
      }
    }

    const escrow = calculateEscrowCost({
      type: "EXTERNAL",
      expectedCompletions: dto.expectedCompletions,
      rewardPerResponse: dto.rewardPerResponse,
    }).effectiveCost;
    const id = mockId();
    const now = nowIso();
    const status = dto.autoPublish ? "MODERATION_QUEUE" : "DRAFT";
    const completionCode = sixDigitCode();
    // AD-16: the escrow is reserved in the same unit of work; an unfunded
    // auto-publish creates nothing (409, `InsufficientEscrowBalanceException`).
    if (dto.autoPublish) {
      try {
        reserveSurveyEscrow(user, { amount: escrow, surveyId: id, title: dto.title });
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_AVAILABLE") {
          return fail(409, "INSUFFICIENT_ESCROW_BALANCE", "Insufficient balance to reserve the escrow.", {
            details: { availableBalance: walletOf(user).available, requiredAmount: escrow },
          });
        }
        throw error;
      }
    }
    addPublisherForm({
      id,
      ownerEmail: user.email,
      title: dto.title,
      type: "EXTERNAL",
      status,
      rewardPerResponse: dto.rewardPerResponse,
      expectedCompletions: dto.expectedCompletions,
      completedCompletions: 0,
      escrowLocked: dto.autoPublish ? escrow : 0,
      estimatedEffortSeconds: dto.expectedEffortSeconds,
      externalUrl: dto.externalUrl,
      createdAt: now,
      submittedAt: dto.autoPublish ? now : null,
      publishedAt: null,
      // Story IR.2b: the wizard's collection deadline.
      deadlineAt: dto.deadlineAt ?? null,
      closedAt: null,
      hiddenFromMarketplace: true,
      rejection: null,
      versionNumber: 1,
    });
    createdFormExtras.update((all) => {
      all[id] = {
        description: dto.description ?? null,
        topic: dto.topic ?? null,
        targeting: dto.targetingJson ?? null,
        estimatedDurationMinutes,
        completionCode,
      };
    });

    const response = {
      id,
      publisherId: user.id,
      type: "EXTERNAL",
      status,
      title: dto.title,
      description: dto.description ?? null,
      rewardPerResponse: dto.rewardPerResponse,
      expectedCompletions: dto.expectedCompletions,
      estimatedDurationMinutes,
      closeKind: null,
      topic: dto.topic ?? null,
      deadlineAt: dto.deadlineAt ?? null,
      createdAt: now,
      updatedAt: now,
      plaintextCompletionCode: completionCode,
      hasCompletionCode: true,
      externalUrl: dto.externalUrl,
      currentVersionNumber: 1,
    };
    if (recordKey) {
      createIdempotencyRecords.update((all) => {
        all[recordKey] = { fingerprint, response };
      });
    }
    return ok(response, 201);
  }),

  // VERIFIED: POST /forms/audience-estimate (`audience-estimate.controller.ts`, session + CSRF)
  // `audienceEstimateInputSchema` → `audienceEstimateSchema` (rounded, null below the minimum).
  http.post(apiUrl("/forms/audience-estimate"), async ({ request }) => {
    const forced = await applyScenario("forms-create");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = audienceEstimateInputSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid targeting.", { details: parsed.error.format() });
    }
    return ok(toAudienceEstimate(estimateRespondents(parsed.data.targeting)));
  }),
];
